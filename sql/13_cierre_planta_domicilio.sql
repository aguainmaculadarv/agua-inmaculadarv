-- =====================================================================
-- AGUA INMACULADA · CIERRE DE PLANTA CUENTA EL AGUA DE DOMICILIO (08-nov-2026)
-- Desde el 7-nov Javier ya no paga en ventanilla por garrafón: lo de domicilio
-- solo queda en pedidos. Para que el cuadre de litros de ventanilla no marque
-- faltante, el cierre de planta suma los garrafones entregados a domicilio
-- durante ese turno (20 L c/u), igual que ya hace con la camioneta.
-- Se puede correr más de una vez sin problema.
-- =====================================================================

create or replace function public.cerrar_turno(
  p_turno_id bigint, p_medidor_fin numeric, p_garrafones_fin int,
  p_efectivo_contado numeric, p_foto_medidor text default null,
  p_foto_caja text default null, p_notas text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  t turnos%rowtype;
  v_ef numeric; v_tr numeric; v_gastos numeric; v_esperado numeric;
  v_litros_vend numeric; v_litros_med numeric; v_factor numeric := 1;
  v_garr int; v_nuevos int; v_dif_nuevos int;
begin
  select * into t from turnos where id = p_turno_id;
  if not found or t.estado <> 'abierto' then raise exception 'El turno no está abierto'; end if;
  if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;

  select coalesce(sum(total) filter (where forma_pago='efectivo'),0),
         coalesce(sum(total) filter (where forma_pago='transferencia'),0)
    into v_ef, v_tr from ventas where turno_id = p_turno_id and not cancelada;

  select coalesce(sum(monto),0) into v_gastos from gastos where turno_id = p_turno_id and pagado_de_caja;

  select coalesce(sum(d.litros_producto),0),
         coalesce(sum(d.cantidad) filter (where p.cuenta_garrafon),0),
         coalesce(sum(d.cantidad) filter (where p.nombre = 'Garrafón nuevo'),0)
    into v_litros_vend, v_garr, v_nuevos
  from venta_detalle d join ventas v on v.id = d.venta_id join productos p on p.id = d.producto_id
  where v.turno_id = p_turno_id and not v.cancelada;

  -- garrafones cargados a la camioneta durante este turno de planta también salen del medidor
  if t.tipo = 'planta' then
    select v_litros_vend + coalesce(sum(c.garrafones), 0) * 20 into v_litros_vend
    from cargas c join turnos tt on tt.id = c.turno_id
    where tt.tipo = 'camioneta' and c.fecha >= t.abierto_en and c.fecha <= now();
    -- pedidos a domicilio que Javier entregó durante este turno de planta (se llenan aquí)
    select v_litros_vend + coalesce(sum(pe.entregado_cantidad), 0) * 20 into v_litros_vend
    from pedidos pe join turnos tm on tm.id = pe.turno_id
    where tm.tipo = 'moto' and pe.estado = 'entregado' and pe.entregado_en >= t.abierto_en and pe.entregado_en <= now();
  end if;
  if (select texto from config where clave='medidor_unidad') = 'm3' then v_factor := 1000; end if;
  v_litros_med := case when p_medidor_fin is not null and t.medidor_inicial is not null
                       then (p_medidor_fin - t.medidor_inicial) * v_factor end;
  v_esperado := t.caja_inicial + v_ef - v_gastos;
  v_dif_nuevos := case when t.garrafones_nuevos_ini is not null and p_garrafones_fin is not null
                       then p_garrafones_fin - (t.garrafones_nuevos_ini - v_nuevos) end;

  update turnos set
    cerrado_en = now(), estado = 'cerrado',
    medidor_final = p_medidor_fin, garrafones_nuevos_fin = p_garrafones_fin,
    foto_medidor_fin = p_foto_medidor, foto_caja_fin = p_foto_caja, notas_cierre = p_notas,
    efectivo_contado = p_efectivo_contado, efectivo_esperado = v_esperado,
    diferencia_caja = p_efectivo_contado - v_esperado,
    ventas_efectivo = v_ef, ventas_transferencia = v_tr, gastos_caja = v_gastos,
    litros_medidor = v_litros_med, litros_vendidos = v_litros_vend,
    diferencia_litros = v_litros_med - v_litros_vend,
    garrafones_vendidos = v_garr, garrafones_nuevos_vendidos = v_nuevos,
    diferencia_garrafones_nuevos = v_dif_nuevos
  where id = p_turno_id;

  return json_build_object(
    'efectivo_esperado', v_esperado, 'efectivo_contado', p_efectivo_contado,
    'diferencia_caja', p_efectivo_contado - v_esperado,
    'ventas_efectivo', v_ef, 'ventas_transferencia', v_tr, 'gastos_caja', v_gastos,
    'litros_medidor', v_litros_med, 'litros_vendidos', v_litros_vend,
    'diferencia_litros', v_litros_med - v_litros_vend,
    'garrafones_vendidos', v_garr, 'garrafones_nuevos_vendidos', v_nuevos,
    'diferencia_garrafones_nuevos', v_dif_nuevos);
end $$;

select 'Cierre de planta con domicilio listo' as resultado;
