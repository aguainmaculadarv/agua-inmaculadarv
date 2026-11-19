-- =====================================================================
-- AGUA INMACULADA · PRECIO CON ENTREGA PARA EMPRESAS + CORREGIR PRECIO (19-nov-2026)
--  1) Cuando Javier entrega a una empresa, el relleno se cobra a su "precio con
--     entrega" (campo precio_especial del cliente), aunque tenga otro precio en planta.
--  2) Espinosa: precio con entrega $30 (en planta sigue $25).
--  3) "Corregir" entrega ahora también permite cambiar el precio del relleno.
--  4) Corrige las entregas a Espinosa de hoy que se cobraron a $25 → $30.
-- Se puede correr más de una vez sin problema.
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
  values (p_turno_id, auth.uid(), p_cliente_id,
          case when v_cli.id is not null and v_cli.tipo = 'distribuidor' then 'repartidor' else coalesce(p_canal,'planta') end,
          p_forma_pago)
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
    -- Entrega de Javier a empresa: el relleno va al precio con entrega del cliente (precio_especial)
    if v_cli.id is not null and p_canal = 'empresa' and v_prod.nombre = 'Relleno garrafón' and v_cli.precio_especial is not null then
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

drop function if exists public.corregir_entrega(bigint, int, int, int, text, text);
create or replace function public.corregir_entrega(
  p_entrega_id bigint, p_llenos int, p_nuevos int, p_vacios int, p_forma_pago text, p_motivo text,
  p_precio numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  e entregas%rowtype; v ventas%rowtype; c clientes%rowtype;
  v_rel productos%rowtype; v_nue productos%rowtype;
  v_pu_rel numeric; v_pu_nue numeric; v_venta bigint; v_total numeric;
begin
  if not es_dueno() then raise exception 'Solo los dueños pueden corregir entregas'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la corrección'; end if;
  if coalesce(p_llenos, -1) < 0 or coalesce(p_nuevos, -1) < 0 or coalesce(p_vacios, -1) < 0 then raise exception 'Las cantidades no pueden ser negativas'; end if;
  if p_forma_pago not in ('efectivo','transferencia','credito') then raise exception 'Forma de pago no válida'; end if;
  select * into e from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  select * into c from clientes where id = e.cliente_id;
  select * into v_rel from productos where nombre = 'Relleno garrafón';
  select * into v_nue from productos where nombre = 'Garrafón nuevo';
  if e.venta_id is not null then select * into v from ventas where id = e.venta_id; end if;

  -- precios: los que ya tenía la venta; si no, los del cliente / producto
  select precio_unitario into v_pu_rel from venta_detalle where venta_id = e.venta_id and producto_id = v_rel.id limit 1;
  select precio_unitario into v_pu_nue from venta_detalle where venta_id = e.venta_id and producto_id = v_nue.id limit 1;
  v_pu_rel := coalesce(p_precio, v_pu_rel, c.precio_especial, v_rel.precio);
  if v_pu_rel <= 0 then raise exception 'Precio no válido'; end if;
  v_pu_nue := coalesce(v_pu_nue, v_nue.precio);

  -- garrafones prestados: se quita lo anterior y se pone lo nuevo
  update clientes set garrafones_prestados = garrafones_prestados - (e.llenos - e.vacios) + (p_llenos - p_vacios) where id = e.cliente_id;

  -- venta
  v_venta := e.venta_id;
  if p_llenos + p_nuevos > 0 then
    if v_venta is null or v.cancelada then
      insert into ventas (turno_id, usuario_id, cliente_id, canal, forma_pago, fecha)
      values (e.turno_id, coalesce(e.usuario_id, auth.uid()), e.cliente_id, 'empresa', p_forma_pago, e.fecha)
      returning id into v_venta;
    else
      update ventas set forma_pago = p_forma_pago where id = v_venta;
    end if;
    delete from venta_detalle where venta_id = v_venta and producto_id in (v_rel.id, v_nue.id);
    if p_llenos > 0 then
      insert into venta_detalle (venta_id, producto_id, cantidad, precio_unitario, importe, litros_producto, litros_consumo, iva_tasa)
      values (v_venta, v_rel.id, p_llenos, v_pu_rel, v_pu_rel * p_llenos, v_rel.litros_producto * p_llenos, v_rel.litros_consumo * p_llenos, v_rel.iva_tasa);
    end if;
    if p_nuevos > 0 then
      insert into venta_detalle (venta_id, producto_id, cantidad, precio_unitario, importe, litros_producto, litros_consumo, iva_tasa)
      values (v_venta, v_nue.id, p_nuevos, v_pu_nue, v_pu_nue * p_nuevos, v_nue.litros_producto * p_nuevos, v_nue.litros_consumo * p_nuevos, v_nue.iva_tasa);
    end if;
    select coalesce(sum(importe), 0) into v_total from venta_detalle where venta_id = v_venta;
    update ventas set total = v_total where id = v_venta;
  elsif v_venta is not null and not v.cancelada then
    update ventas set cancelada = true, cancelada_por = auth.uid(), cancelada_en = now(),
      motivo_cancelacion = 'Corrección de entrega ' || p_entrega_id || ': ' || trim(p_motivo) where id = v_venta;
    v_venta := null;
  else
    v_venta := null;
  end if;

  update entregas set
    correcciones = correcciones || jsonb_build_array(jsonb_build_object(
      'fecha', now(), 'por', auth.uid(), 'motivo', trim(p_motivo),
      'antes', jsonb_build_object('llenos', e.llenos, 'nuevos', e.nuevos, 'vacios', e.vacios, 'forma_pago', v.forma_pago, 'total', v.total, 'precio', (select precio_unitario from venta_detalle where venta_id = e.venta_id and producto_id = v_rel.id limit 1)))),
    llenos = p_llenos, nuevos = p_nuevos, vacios = p_vacios, venta_id = v_venta,
    corregida_en = now(), corregida_por = auth.uid()
  where id = p_entrega_id;
end $$;
grant execute on function public.corregir_entrega to authenticated;

-- Espinosa: precio con entrega $30
do $$
declare v_cli bigint; v_n int; v_rel bigint; r record; v_fix int := 0;
begin
  select count(*), min(id) into v_n, v_cli from clientes where activo and (nombre ilike '%espinos%' or nombre ilike '%espinoz%');
  if v_n <> 1 then raise exception 'Encontré % clientes Espinosa; no se cambió nada', v_n; end if;
  update clientes set precio_especial = 30 where id = v_cli;
  select id into v_rel from productos where nombre = 'Relleno garrafón';
  -- entregas de Javier a Espinosa desde el 19-nov cobradas a $25
  for r in select distinct v.id from entregas e join ventas v on v.id = e.venta_id
           join venta_detalle d on d.venta_id = v.id and d.producto_id = v_rel and d.precio_unitario = 25
           where e.cliente_id = v_cli and not v.cancelada and e.fecha >= '2026-11-19 00:00 America/Mexico_City'
  loop
    update venta_detalle set precio_unitario = 30, importe = 30 * cantidad where venta_id = r.id and producto_id = v_rel;
    update ventas set total = (select sum(importe) from venta_detalle where venta_id = r.id) where id = r.id;
    v_fix := v_fix + 1;
  end loop;
  raise notice 'Entregas de Espinosa corregidas a $30: %', v_fix;
end $$;

select 'Precio con entrega listo' as resultado;
