-- =====================================================================
-- AGUA INMACULADA · VENTA RÁPIDA DE JAVIER (24-nov-2026)
-- Javier agrega una venta sin registrar cliente: garrafones, precio por
-- garrafón (25, 28, 30 u otro) o el total cobrado, forma de pago y nota opcional.
-- Queda como pedido entregado (origen 'ruta'): sale en "Pagar en caja",
-- en la pestaña Javier de ventanilla y en la de dueños.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
create or replace function public.agregar_venta_ruta(
  p_turno_id bigint, p_cantidad int, p_precio numeric, p_forma text, p_nota text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare t turnos%rowtype; v_rel productos%rowtype; v_id bigint;
begin
  select * into t from turnos where id = p_turno_id;
  if not found or t.estado <> 'abierto' or t.tipo not in ('camioneta','moto') then raise exception 'Abre tu turno de reparto primero'; end if;
  if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
  if coalesce(p_cantidad, 0) < 1 or p_cantidad > 200 then raise exception 'Escribe cuántos garrafones'; end if;
  if coalesce(p_precio, 0) < 5 or p_precio > 200 then raise exception 'Precio por garrafón no válido'; end if;
  if p_forma not in ('efectivo','transferencia') then raise exception 'Elige efectivo o transferencia'; end if;
  select * into v_rel from productos where nombre = 'Relleno garrafón';

  insert into pedidos (creado_por, nombre, domicilio, producto_id, cantidad, precio_unitario, forma_pago, notas,
                       asignado_a, estado, entregado_en, entregado_cantidad, forma_pago_real, monto_cobrado, turno_id, origen)
  values (auth.uid(), 'Venta en ruta', coalesce(nullif(trim(p_nota), ''), 'En ruta'), v_rel.id, p_cantidad, round(p_precio, 2), p_forma,
          'Agregada por el repartidor desde su app', t.usuario_id, 'entregado', now(), p_cantidad, p_forma,
          round(p_cantidad * p_precio, 2), p_turno_id, 'ruta')
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'total', round(p_cantidad * p_precio, 2));
end $$;
grant execute on function public.agregar_venta_ruta to authenticated;

-- Guardar solo visitas de prospección
create or replace function public.registrar_visitas(p_turno_id bigint, p_visitas int, p_lugar text default null)
returns json language plpgsql security definer set search_path = public as $$
declare t turnos%rowtype;
begin
  select * into t from turnos where id = p_turno_id;
  if not found or t.estado <> 'abierto' then raise exception 'Abre tu turno de reparto primero'; end if;
  if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
  if coalesce(p_visitas, 0) < 1 then raise exception 'Escribe cuántas visitas'; end if;
  insert into prospeccion (usuario_id, turno_id, visitas, lugar) values (t.usuario_id, p_turno_id, p_visitas, nullif(trim(p_lugar), ''));
  return json_build_object('ok', true);
end $$;
grant execute on function public.registrar_visitas to authenticated;

select 'Venta rápida lista' as resultado;
