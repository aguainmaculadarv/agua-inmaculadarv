-- =====================================================================
-- AGUA INMACULADA · CORREGIR UNA ENTREGA A EMPRESA (12-nov-2026)
-- Solo dueños. Cambia llenos / nuevos / vacíos y la forma de pago de una entrega
-- ya guardada: recalcula el cobro, ajusta los garrafones prestados y deja
-- anotado quién la corrigió, cuándo, por qué y qué tenía antes.
-- La firma original no se toca. Se puede correr más de una vez sin problema.
-- =====================================================================
alter table public.entregas add column if not exists corregida_en timestamptz;
alter table public.entregas add column if not exists corregida_por uuid references public.perfiles(id);
alter table public.entregas add column if not exists correcciones jsonb not null default '[]'::jsonb;

create or replace function public.corregir_entrega(
  p_entrega_id bigint, p_llenos int, p_nuevos int, p_vacios int, p_forma_pago text, p_motivo text
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
  v_pu_rel := coalesce(v_pu_rel, c.precio_especial, v_rel.precio);
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
      'antes', jsonb_build_object('llenos', e.llenos, 'nuevos', e.nuevos, 'vacios', e.vacios, 'forma_pago', v.forma_pago, 'total', v.total))),
    llenos = p_llenos, nuevos = p_nuevos, vacios = p_vacios, venta_id = v_venta,
    corregida_en = now(), corregida_por = auth.uid()
  where id = p_entrega_id;
end $$;
grant execute on function public.corregir_entrega to authenticated;

select 'Corregir entregas listo' as resultado;
