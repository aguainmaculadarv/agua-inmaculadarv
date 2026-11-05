-- =====================================================================
-- AGUA INMACULADA · PRECIO DE REPARTIDOR
-- Cuando ventanilla cobra al repartidor (cliente tipo distribuidor),
-- cada producto se cobra a su precio A DOMICILIO (ej. alcalina $57).
-- El relleno sigue usando el precio especial del cliente ($25 / $28).
-- Solo reemplaza la función registrar_venta; no toca datos.
-- =====================================================================

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
