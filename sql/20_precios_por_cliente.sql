-- =====================================================================
-- AGUA INMACULADA · PRECIO ESPECIAL POR CLIENTE EN CUALQUIER PRODUCTO (13-nov-2026)
-- Tabla cliente_precios: el dueño fija el precio de un producto para un cliente
-- (ej. Espinosa: relleno $25, hielo grande $33, hielo chico $28). Ventanilla y
-- entregas a empresas lo aplican solos al elegir al cliente.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
create table if not exists public.cliente_precios (
  cliente_id bigint not null references public.clientes(id) on delete cascade,
  producto_id bigint not null references public.productos(id) on delete cascade,
  precio numeric not null check (precio >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (cliente_id, producto_id)
);
alter table public.cliente_precios enable row level security;
drop policy if exists cliente_precios_ver on public.cliente_precios;
drop policy if exists cliente_precios_dueno on public.cliente_precios;
create policy cliente_precios_ver on public.cliente_precios for select to authenticated using (mi_rol() is not null);
create policy cliente_precios_dueno on public.cliente_precios for all to authenticated using (es_dueno()) with check (es_dueno());
revoke all on public.cliente_precios from anon;

create or replace function public.registrar_venta(
  p_turno_id bigint, p_forma_pago text, p_items jsonb,
  p_cliente_id bigint default null, p_canal text default 'planta'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_turno turnos%rowtype;
  v_venta bigint;
  v_item jsonb;
  v_prod productos%rowtype;
  v_cli clientes%rowtype;
  v_precio numeric;
  v_cant numeric;
  v_total numeric := 0;
  v_det bigint;
  v_esp numeric;
begin
  select * into v_turno from turnos where id = p_turno_id;
  if not found or v_turno.estado <> 'abierto' then raise exception 'El turno no está abierto'; end if;
  if v_turno.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
  if p_forma_pago not in ('efectivo','transferencia','credito') then raise exception 'Forma de pago no válida'; end if;
  if p_forma_pago = 'credito' and p_cliente_id is null then raise exception 'Una venta a crédito necesita cliente'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'La venta no tiene productos'; end if;

  if p_cliente_id is not null then
    select * into v_cli from clientes where id = p_cliente_id and activo;
  end if;

  insert into ventas (turno_id, usuario_id, cliente_id, canal, forma_pago)
  values (p_turno_id, auth.uid(), p_cliente_id, coalesce(p_canal,'planta'), p_forma_pago)
  returning id into v_venta;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad no válida'; end if;
    select * into v_prod from productos where id = (v_item->>'producto_id')::bigint and activo;
    if not found then raise exception 'Producto no válido'; end if;

    v_precio := case when p_canal = 'domicilio' then coalesce(v_prod.precio_domicilio, v_prod.precio)
                     else v_prod.precio end;
    -- Repartidor (cliente tipo distribuidor): paga en planta el precio a domicilio de cada producto
    if v_cli.id is not null and v_cli.tipo = 'distribuidor' then
      v_precio := coalesce(v_prod.precio_domicilio, v_prod.precio);
    end if;
    -- Precio especial por cliente (empresas y repartidores) en el relleno
    if v_cli.id is not null and v_cli.precio_especial is not null and v_prod.nombre = 'Relleno garrafón' then
      v_precio := v_cli.precio_especial;
    end if;
    -- Precio especial por cliente en cualquier producto (tabla cliente_precios): manda sobre todo lo anterior
    if v_cli.id is not null then
      v_esp := null;
      select precio into v_esp from cliente_precios where cliente_id = v_cli.id and producto_id = v_prod.id;
      if v_esp is not null then v_precio := v_esp; end if;
    end if;

    insert into venta_detalle (venta_id, producto_id, cantidad, precio_unitario, importe,
                               litros_producto, litros_consumo, iva_tasa)
    values (v_venta, v_prod.id, v_cant, v_precio, v_precio * v_cant,
            v_prod.litros_producto * v_cant, v_prod.litros_consumo * v_cant, v_prod.iva_tasa)
    returning id into v_det;

    insert into movimientos (articulo_id, tipo, cantidad, motivo, venta_id, turno_id, usuario_id)
    select pi.articulo_id, 'salida', pi.cantidad * v_cant, 'Venta ' || v_prod.nombre, v_venta, p_turno_id, auth.uid()
    from producto_insumos pi where pi.producto_id = v_prod.id;

    v_total := v_total + v_precio * v_cant;
  end loop;

  update ventas set total = v_total where id = v_venta;
  return v_venta;
end $$;
grant execute on function public.registrar_venta to authenticated;

-- Precios de Espinosa
do $$
declare v_cli bigint; v_n int;
begin
  select count(*), min(id) into v_n, v_cli from clientes where activo and (nombre ilike '%espinos%' or nombre ilike '%espinoz%');
  if v_n <> 1 then raise notice 'No se cargaron precios de Espinosa: se encontraron % clientes con ese nombre', v_n; return; end if;
  insert into cliente_precios (cliente_id, producto_id, precio)
  select v_cli, p.id, x.precio
  from (values ('Relleno garrafón', 25), ('Hielo grande', 33), ('Hielo chico', 28)) as x(nombre, precio)
  join productos p on p.nombre = x.nombre
  on conflict (cliente_id, producto_id) do update set precio = excluded.precio, actualizado_en = now();
end $$;

select c.nombre as cliente, p.nombre as producto, cp.precio
from cliente_precios cp join clientes c on c.id = cp.cliente_id join productos p on p.id = cp.producto_id order by 1, 2;
