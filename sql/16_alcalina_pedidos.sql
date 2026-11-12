-- =====================================================================
-- AGUA INMACULADA · AGUA ALCALINA EN PEDIDOS A DOMICILIO (12-nov-2026)
-- El cliente elige alcalina y la marca de su garrafón ("Ciel alcalina", etc.).
-- La alcalina se cobra al precio a domicilio del producto "Agua alcalina" ($57).
-- Se puede correr más de una vez sin problema.
-- =====================================================================
alter table public.pedidos add column if not exists alcalina int not null default 0;
alter table public.pedidos add column if not exists precio_alcalina numeric;

-- precios que ve la página pública
create or replace function public.precios_pedido_en_linea()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'purificada', (select coalesce(precio_domicilio, precio) from productos where nombre = 'Relleno garrafón' and activo limit 1),
    'alcalina',   (select coalesce(precio_domicilio, precio) from productos where nombre = 'Agua alcalina' and activo limit 1));
$$;
grant execute on function public.precios_pedido_en_linea to anon, authenticated;

create or replace function public.crear_pedido(
  p_nombre text, p_telefono text, p_domicilio text, p_maps text, p_producto_id bigint,
  p_cantidad int, p_forma_pago text, p_notas text default null, p_cliente_id bigint default null,
  p_asignado uuid default null, p_marcas jsonb default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_p productos%rowtype; v_id bigint; v_cant int; v_cli bigint := p_cliente_id; v_tel text; v_marcas jsonb; v_alc int := 0; v_pa numeric;
begin
  if mi_rol() not in ('dueno','ventanilla') then raise exception 'Solo dueños o ventanilla capturan pedidos'; end if;
  if p_producto_id is null then
    select * into v_p from productos where nombre = 'Relleno garrafón' and activo;
  else
    select * into v_p from productos where id = p_producto_id and activo;
  end if;
  if not found then raise exception 'Producto no válido'; end if;
  if coalesce(trim(p_domicilio), '') = '' then raise exception 'Escribe el domicilio'; end if;

  -- marcas: solo cantidades positivas
  select coalesce(jsonb_object_agg(key, (value)::int), '{}'::jsonb), coalesce(sum((value)::int), 0)
    into v_marcas, v_cant
  from jsonb_each_text(coalesce(p_marcas, '{}'::jsonb)) where (value)::int > 0;
  if v_cant = 0 then v_cant := coalesce(p_cantidad, 0); v_marcas := null; end if;
  -- agua alcalina: las marcas que terminan en " alcalina" se cobran al precio de Agua alcalina
  select coalesce(sum((value)::int), 0) into v_alc from jsonb_each_text(coalesce(v_marcas, '{}'::jsonb)) where key like '% alcalina';
  if v_alc > 0 then
    select coalesce(precio_domicilio, precio) into v_pa from productos where nombre = 'Agua alcalina' and activo;
    if v_pa is null then raise exception 'El producto Agua alcalina no está activo'; end if;
  end if;
  if v_cant <= 0 then raise exception 'Escribe cuántos garrafones'; end if;

  -- cliente: si no viene, se busca por teléfono; si no existe, se da de alta
  v_tel := nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), '');
  if v_tel is not null then v_tel := right(v_tel, 10); end if;
  if v_cli is null and v_tel is not null then
    select id into v_cli from clientes
     where tipo = 'domicilio' and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel
     order by id limit 1;
  end if;
  if v_cli is null and v_tel is not null then
    insert into clientes (tipo, nombre, telefono, domicilio, maps_url)
    values ('domicilio', coalesce(nullif(trim(p_nombre), ''), 'Cliente ' || v_tel), v_tel, p_domicilio, p_maps)
    returning id into v_cli;
  elsif v_cli is not null then
    update clientes set domicilio = coalesce(nullif(trim(p_domicilio), ''), domicilio),
                        maps_url = coalesce(nullif(trim(p_maps), ''), maps_url),
                        telefono = coalesce(telefono, v_tel)
     where id = v_cli and tipo = 'domicilio';
  end if;

  insert into pedidos (nombre, telefono, domicilio, maps_url, producto_id, cantidad, precio_unitario, forma_pago, notas,
                       cliente_id, asignado_a, creado_por, marcas, alcalina, precio_alcalina)
  values (coalesce(nullif(trim(p_nombre), ''), 'Cliente'), coalesce(v_tel, p_telefono), p_domicilio, p_maps, v_p.id, v_cant,
          coalesce(v_p.precio_domicilio, v_p.precio), coalesce(p_forma_pago, 'efectivo'), p_notas, v_cli, p_asignado, auth.uid(), v_marcas, v_alc, v_pa)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.crear_pedido to authenticated;

create or replace function public.pedido_en_linea(
  p_telefono text, p_marcas jsonb, p_forma_pago text default 'efectivo',
  p_comentario text default null, p_nombre text default null, p_domicilio text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_tel text; v_cli clientes%rowtype; v_p productos%rowtype; v_marcas jsonb; v_cant int; v_id bigint; v_nuevo boolean := false; v_alc int := 0; v_pa numeric;
  v_com text := nullif(left(trim(coalesce(p_comentario, '')), 500), '');
begin
  v_tel := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10);
  if length(v_tel) <> 10 then return json_build_object('ok', false, 'motivo', 'telefono'); end if;

  -- límite general anti-bromas
  if (select count(*) from pedidos where origen = 'cliente' and creado_en > now() - interval '1 hour') >= 40 then
    return json_build_object('ok', false, 'motivo', 'saturado');
  end if;
  -- un pedido pendiente por teléfono
  if exists (select 1 from pedidos where estado = 'pendiente' and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel) then
    return json_build_object('ok', false, 'motivo', 'pendiente');
  end if;

  -- marcas válidas, de 1 a 20 garrafones en total
  select coalesce(jsonb_object_agg(key, (value)::int), '{}'::jsonb), coalesce(sum((value)::int), 0)
    into v_marcas, v_cant
  from jsonb_each_text(coalesce(p_marcas, '{}'::jsonb))
  where (key in ('Ciel','Epura','Bluerock','Bonafont','Rositas')
         or key in ('Ciel alcalina','Epura alcalina','Bluerock alcalina','Bonafont alcalina','Rositas alcalina'))
    and value ~ '^\d{1,2}$' and (value)::int > 0;
  if v_cant < 1 or v_cant > 20 then return json_build_object('ok', false, 'motivo', 'cantidad'); end if;

  select * into v_p from productos where nombre = 'Relleno garrafón' and activo;
  if not found then return json_build_object('ok', false, 'motivo', 'cerrado'); end if;
  select coalesce(sum((value)::int), 0) into v_alc from jsonb_each_text(v_marcas) where key like '% alcalina';
  if v_alc > 0 then
    select coalesce(precio_domicilio, precio) into v_pa from productos where nombre = 'Agua alcalina' and activo;
    if v_pa is null then return json_build_object('ok', false, 'motivo', 'alcalina'); end if;
  end if;

  select * into v_cli from clientes
   where tipo = 'domicilio' and activo and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel
   order by id limit 1;

  if v_cli.id is null then
    -- cliente nuevo: hace falta su domicilio
    if coalesce(trim(p_domicilio), '') = '' then return json_build_object('ok', false, 'motivo', 'domicilio'); end if;
    v_nuevo := true;
  end if;

  insert into pedidos (nombre, telefono, domicilio, maps_url, producto_id, cantidad, precio_unitario, forma_pago, notas,
                       cliente_id, marcas, origen, revisar, alcalina, precio_alcalina)
  values (coalesce(v_cli.nombre, nullif(left(trim(coalesce(p_nombre, '')), 120), ''), 'Cliente nuevo'),
          v_tel,
          coalesce(v_cli.domicilio, left(trim(p_domicilio), 200)),
          v_cli.maps_url, v_p.id, v_cant, coalesce(v_p.precio_domicilio, v_p.precio),
          case when p_forma_pago = 'transferencia' then 'transferencia' else 'efectivo' end,
          case when v_nuevo then 'CLIENTE NUEVO · ' else '' end || coalesce(v_com, ''),
          v_cli.id, v_marcas, 'cliente', v_nuevo or v_com is not null, v_alc, v_pa)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'nuevo', v_nuevo, 'total', (v_cant - v_alc) * coalesce(v_p.precio_domicilio, v_p.precio) + v_alc * coalesce(v_pa, 0));
end $$;
grant execute on function public.pedido_en_linea to anon, authenticated;

create or replace function public.entregar_pedido(p_pedido_id bigint, p_turno_id bigint, p_cantidad int, p_forma_pago text)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_t turnos%rowtype; v_p pedidos%rowtype; v_monto numeric;
begin
  select * into v_t from turnos where id = p_turno_id;
  if not found or v_t.estado <> 'abierto' or v_t.tipo <> 'moto' then raise exception 'Abre tu turno de moto primero'; end if;
  if v_t.usuario_id <> auth.uid() then raise exception 'El turno no es tuyo'; end if;
  select * into v_p from pedidos where id = p_pedido_id for update;
  if not found or v_p.estado <> 'pendiente' then raise exception 'El pedido ya no está pendiente'; end if;
  if p_forma_pago not in ('efectivo','transferencia') then raise exception 'Forma de pago no válida'; end if;
  -- si hay alcalina, esos garrafones van a su precio; si Javier entrega menos, se descuenta primero de purificada
  v_monto := (coalesce(p_cantidad, v_p.cantidad) - least(coalesce(v_p.alcalina, 0), coalesce(p_cantidad, v_p.cantidad))) * v_p.precio_unitario
           + least(coalesce(v_p.alcalina, 0), coalesce(p_cantidad, v_p.cantidad)) * coalesce(v_p.precio_alcalina, v_p.precio_unitario);
  update pedidos set estado = 'entregado', entregado_en = now(), entregado_cantidad = coalesce(p_cantidad, v_p.cantidad),
    forma_pago_real = p_forma_pago, monto_cobrado = v_monto, turno_id = p_turno_id, asignado_a = auth.uid()
  where id = p_pedido_id;
  return v_monto;
end $$;

select 'Agua alcalina en pedidos lista' as resultado;
