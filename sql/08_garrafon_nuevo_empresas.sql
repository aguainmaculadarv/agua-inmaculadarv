-- =====================================================================
-- AGUA INMACULADA · GARRAFÓN NUEVO EN ENTREGAS A EMPRESAS (05-nov-2026)
-- En la entrega, además de rellenos, Javier registra garrafones nuevos (envase con agua).
-- Se cobran a su precio en la misma venta (crédito o contado según la empresa),
-- no cuentan como prestados y sí se descuentan de la carga de la camioneta.
-- Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.entregas add column if not exists nuevos int not null default 0;

drop function if exists public.registrar_entrega_empresa(bigint, bigint, int, int, text, text, text, text);
drop function if exists public.registrar_entrega_empresa(bigint, bigint, int, int, text, text, text, text, int);
create or replace function public.registrar_entrega_empresa(
  p_turno_id bigint, p_cliente_id bigint, p_llenos int, p_vacios int,
  p_recibio text, p_firma text, p_notas text default null, p_forma_pago text default null, p_nuevos int default 0
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_t turnos%rowtype; v_c clientes%rowtype; v_venta bigint; v_prod bigint; v_nuevo bigint; v_id bigint; v_fp text; v_items jsonb := '[]'::jsonb;
begin
  select * into v_t from turnos where id = p_turno_id;
  if not found or v_t.estado <> 'abierto' then raise exception 'El turno no está abierto'; end if;
  if v_t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
  select * into v_c from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente no válido'; end if;
  if coalesce(trim(p_recibio), '') = '' then raise exception 'Escribe el nombre de quien recibe'; end if;
  if p_firma is null then raise exception 'Falta la firma de recibido'; end if;
  if coalesce(p_llenos, 0) = 0 and coalesce(p_vacios, 0) = 0 and coalesce(p_nuevos, 0) = 0 then raise exception 'Escribe cuántos garrafones entregas o recoges'; end if;
  if coalesce(p_nuevos, 0) < 0 then raise exception 'Cantidad de garrafones nuevos no válida'; end if;
  -- crédito si el cliente tiene días de crédito (o no tiene plazo definido); si es de contado, se cobra en la entrega
  v_fp := coalesce(p_forma_pago, case when v_c.dias_credito is null or v_c.dias_credito > 0 then 'credito'
                                      else coalesce(v_c.forma_pago_habitual, 'efectivo') end);
  if v_fp not in ('efectivo','transferencia','credito') then raise exception 'Forma de pago no válida'; end if;
  if coalesce(p_llenos, 0) > 0 then
    select id into v_prod from productos where nombre = 'Relleno garrafón';
    v_items := v_items || jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', p_llenos));
  end if;
  -- garrafón nuevo (envase con agua): se vende a su precio y queda como propiedad de la empresa
  if coalesce(p_nuevos, 0) > 0 then
    select id into v_nuevo from productos where nombre = 'Garrafón nuevo' and activo;
    if v_nuevo is null then raise exception 'No existe el producto activo "Garrafón nuevo"'; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('producto_id', v_nuevo, 'cantidad', p_nuevos));
  end if;
  if jsonb_array_length(v_items) > 0 then
    v_venta := registrar_venta(p_turno_id, v_fp, v_items, p_cliente_id, 'empresa');
  end if;
  insert into entregas (turno_id, cliente_id, llenos, nuevos, vacios, recibio, firma, venta_id, notas, usuario_id)
  values (p_turno_id, p_cliente_id, coalesce(p_llenos, 0), coalesce(p_nuevos, 0), coalesce(p_vacios, 0), p_recibio, p_firma, v_venta, p_notas, auth.uid())
  returning id into v_id;
  update clientes set garrafones_prestados = garrafones_prestados + coalesce(p_llenos, 0) - coalesce(p_vacios, 0) where id = p_cliente_id;
  return v_id;
end $$;

create or replace function public.cerrar_turno_reparto(
  p_turno_id bigint, p_regreso_llenos int, p_regreso_vacios int,
  p_efectivo_contado numeric, p_notas text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  t turnos%rowtype;
  v_cargados int; v_entregados int := 0; v_vacios int := 0;
  v_ef numeric := 0; v_tr numeric := 0; v_pagado numeric := 0; v_esperado numeric; v_pend int := 0;
  v_dif_llenos int; v_dif_vacios int;
begin
  select * into t from turnos where id = p_turno_id;
  if not found or t.estado <> 'abierto' or t.tipo not in ('camioneta','moto') then raise exception 'El turno de reparto no está abierto'; end if;
  if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;

  select coalesce(sum(garrafones), 0) into v_cargados from cargas where turno_id = p_turno_id;

  if t.tipo = 'camioneta' then
    select coalesce(sum(llenos + nuevos), 0), coalesce(sum(vacios), 0) into v_entregados, v_vacios from entregas where turno_id = p_turno_id;
    v_dif_vacios := coalesce(p_regreso_vacios, 0) - v_vacios;
    -- empresas de contado: lo que cobró en efectivo lo trae él
    select coalesce(sum(total) filter (where forma_pago = 'efectivo'), 0),
           coalesce(sum(total) filter (where forma_pago = 'transferencia'), 0)
      into v_ef, v_tr from ventas where turno_id = p_turno_id and canal = 'empresa' and not cancelada;
    v_esperado := t.caja_inicial + v_ef;
  else
    select coalesce(sum(entregado_cantidad), 0),
           coalesce(sum(monto_cobrado) filter (where forma_pago_real = 'efectivo'), 0),
           coalesce(sum(monto_cobrado) filter (where forma_pago_real = 'transferencia'), 0)
      into v_entregados, v_ef, v_tr
    from pedidos where turno_id = p_turno_id and estado = 'entregado';
    select coalesce(sum(v.total), 0) into v_pagado from ventas v
      where v.canal = 'repartidor' and not v.cancelada and v.fecha >= t.abierto_en and v.fecha <= now();
    select count(*) into v_pend from pedidos where estado = 'pendiente' and creado_en <= now();
    v_esperado := t.caja_inicial + v_ef - v_pagado;
  end if;
  v_dif_llenos := coalesce(p_regreso_llenos, 0) - (v_cargados - v_entregados);

  update turnos set cerrado_en = now(), estado = 'cerrado',
    regreso_llenos = p_regreso_llenos, regreso_vacios = p_regreso_vacios,
    entregados = v_entregados, vacios_recogidos = v_vacios,
    diferencia_llenos = v_dif_llenos, diferencia_vacios = v_dif_vacios,
    cobrado_efectivo = v_ef, cobrado_transferencia = v_tr, pagado_ventanilla = v_pagado,
    efectivo_contado = p_efectivo_contado, efectivo_esperado = v_esperado,
    diferencia_caja = p_efectivo_contado - v_esperado, pedidos_pendientes = v_pend,
    garrafones_vendidos = v_entregados, notas_cierre = p_notas
  where id = p_turno_id;

  return json_build_object('tipo', t.tipo, 'cargados', v_cargados, 'entregados', v_entregados,
    'regreso_llenos', p_regreso_llenos, 'diferencia_llenos', v_dif_llenos,
    'vacios_recogidos', v_vacios, 'regreso_vacios', p_regreso_vacios, 'diferencia_vacios', v_dif_vacios,
    'cobrado_efectivo', v_ef, 'cobrado_transferencia', v_tr, 'pagado_ventanilla', v_pagado,
    'caja_inicial', t.caja_inicial, 'efectivo_esperado', v_esperado, 'efectivo_contado', p_efectivo_contado,
    'diferencia_caja', p_efectivo_contado - v_esperado, 'pedidos_pendientes', v_pend);
end $$;

grant execute on function public.registrar_entrega_empresa, public.cerrar_turno_reparto to authenticated;
