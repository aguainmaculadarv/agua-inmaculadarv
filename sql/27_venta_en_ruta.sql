-- =====================================================================
-- AGUA INMACULADA · VENTA EN RUTA Y PROSPECCIÓN (19-nov-2026)
-- Javier registra rápido lo que vendió en la calle sin pedido (sin teléfono ni
-- dirección): garrafones en efectivo y en transferencia, a precio domicilio,
-- y cuántos negocios/casas visitó para prospectar.
--  · Lo vendido queda como pedido entregado (origen 'ruta'), así aparece solo en
--    "Pagar en caja" / pestaña Javier y en el Resumen.
--  · En turno de camioneta, esos garrafones cuentan como entregados para que el
--    cuadre de llenos no salga con faltante.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
create table if not exists public.prospeccion (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  usuario_id uuid not null references public.perfiles(id) default auth.uid(),
  turno_id bigint references public.turnos(id),
  visitas int not null check (visitas >= 0),
  lugar text
);
alter table public.prospeccion enable row level security;
drop policy if exists prospeccion_ver on public.prospeccion;
create policy prospeccion_ver on public.prospeccion for select to authenticated
  using (es_dueno() or usuario_id = auth.uid());

create or replace function public.venta_en_ruta(
  p_turno_id bigint, p_efectivo int, p_transferencia int, p_visitas int, p_lugar text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  t turnos%rowtype; v_rel productos%rowtype; v_pu numeric; v_lugar text; f text; q int; v_n int := 0;
begin
  select * into t from turnos where id = p_turno_id;
  if not found or t.estado <> 'abierto' or t.tipo not in ('camioneta','moto') then raise exception 'Abre tu turno de reparto primero'; end if;
  if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
  if coalesce(p_efectivo, 0) < 0 or coalesce(p_transferencia, 0) < 0 or coalesce(p_visitas, 0) < 0 then raise exception 'Las cantidades no pueden ser negativas'; end if;
  if coalesce(p_efectivo, 0) + coalesce(p_transferencia, 0) + coalesce(p_visitas, 0) = 0 then raise exception 'Escribe al menos una cantidad'; end if;

  select * into v_rel from productos where nombre = 'Relleno garrafón';
  v_pu := coalesce(v_rel.precio_domicilio, v_rel.precio);
  v_lugar := coalesce(nullif(trim(p_lugar), ''), 'En ruta');

  foreach f in array array['efectivo','transferencia'] loop
    q := case f when 'efectivo' then coalesce(p_efectivo, 0) else coalesce(p_transferencia, 0) end;
    if q > 0 then
      insert into pedidos (creado_por, nombre, domicilio, producto_id, cantidad, precio_unitario, forma_pago, notas,
                           asignado_a, estado, entregado_en, entregado_cantidad, forma_pago_real, monto_cobrado, turno_id, origen)
      values (auth.uid(), 'Venta en ruta', v_lugar, v_rel.id, q, v_pu, f, 'Registrada por el repartidor al final de la ruta',
              t.usuario_id, 'entregado', now(), q, f, q * v_pu, p_turno_id, 'ruta');
      v_n := v_n + q;
    end if;
  end loop;

  if coalesce(p_visitas, 0) > 0 then
    insert into prospeccion (usuario_id, turno_id, visitas, lugar) values (t.usuario_id, p_turno_id, p_visitas, nullif(trim(p_lugar), ''));
  end if;
  return json_build_object('garrafones', v_n, 'precio', v_pu, 'total', v_n * v_pu, 'visitas', coalesce(p_visitas, 0));
end $$;
grant execute on function public.venta_en_ruta to authenticated;

-- Cierre de reparto: en camioneta, las ventas en ruta también salen de los llenos cargados
do $$
declare d text;
begin
  d := pg_get_functiondef('public.cerrar_turno_reparto(bigint,int,int,numeric,text)'::regprocedure);
  if position('origen = ''ruta''' in d) = 0 then
    d := replace(d,
      'select coalesce(sum(llenos + nuevos), 0), coalesce(sum(vacios), 0) into v_entregados, v_vacios from entregas where turno_id = p_turno_id;',
      'select coalesce(sum(llenos + nuevos), 0), coalesce(sum(vacios), 0) into v_entregados, v_vacios from entregas where turno_id = p_turno_id;
    v_entregados := v_entregados + (select coalesce(sum(entregado_cantidad), 0) from pedidos where turno_id = p_turno_id and estado = ''entregado'' and origen = ''ruta'');');
    if position('origen = ''ruta''' in d) = 0 then raise exception 'No pude ajustar cerrar_turno_reparto'; end if;
    execute d;
  end if;
end $$;

select 'Venta en ruta lista' as resultado;
