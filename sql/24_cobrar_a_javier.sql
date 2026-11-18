-- =====================================================================
-- AGUA INMACULADA · PESTAÑA "JAVIER" EN VENTANILLA (17-nov-2026)
-- Ventanilla ve lo que Javier debe pagar de domicilio (efectivo y transferencia),
-- según los pedidos que él marcó como Entregado, menos lo que ya pagó en planta.
-- Con un botón se registra el pago como venta al cliente "Javier (reparto)".
-- Cuenta desde la fecha en config 'javier_saldo_desde' (18-nov-2026).
-- Se puede correr más de una vez sin problema.
-- =====================================================================
insert into public.config (clave, texto, descripcion)
values ('javier_saldo_desde', '2026-11-18', 'Desde qué día se cuenta lo que Javier debe pagar en planta')
on conflict (clave) do nothing;

create or replace function public.saldo_javier()
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_desde timestamptz; v_cli bigint; r json;
begin
  if mi_rol() not in ('dueno','ventanilla') then raise exception 'Solo ventanilla o dueños'; end if;
  select ((coalesce(texto, '2026-11-18'))::date)::timestamp at time zone 'America/Mexico_City' into v_desde
    from config where clave = 'javier_saldo_desde';
  v_desde := coalesce(v_desde, '2026-11-18 00:00 America/Mexico_City'::timestamptz);
  select id into v_cli from clientes where nombre = 'Javier (reparto)' limit 1;

  with ent as (   -- lo que Javier entregó y cobró (solo pedidos entregados por el repartidor, no por dueños)
    select pe.forma_pago_real f,
           sum(coalesce(pe.monto_cobrado, 0)) m,
           sum(pe.entregado_cantidad - least(coalesce(pe.alcalina, 0), pe.entregado_cantidad)) pur,
           sum(least(coalesce(pe.alcalina, 0), pe.entregado_cantidad)) alc,
           count(*) n
    from pedidos pe join perfiles pf on pf.id = pe.asignado_a
    where pe.estado = 'entregado' and pf.rol = 'repartidor' and pe.entregado_en >= v_desde
      and pe.forma_pago_real in ('efectivo','transferencia')
    group by 1
  ), pag as (     -- lo que ya pagó en ventanilla
    select v.forma_pago f, sum(d.importe) m,
           sum(d.cantidad) filter (where p.nombre <> 'Agua alcalina') pur,
           sum(d.cantidad) filter (where p.nombre = 'Agua alcalina') alc
    from ventas v join venta_detalle d on d.venta_id = v.id join productos p on p.id = d.producto_id
    where v.cliente_id = v_cli and not v.cancelada and v.fecha >= v_desde
      and v.forma_pago in ('efectivo','transferencia')
    group by 1
  )
  select json_build_object(
    'desde', v_desde,
    'cliente_id', v_cli,
    'efectivo', json_build_object(
       'cobrado', coalesce((select m from ent where f='efectivo'), 0),
       'pagado',  coalesce((select m from pag where f='efectivo'), 0),
       'pedidos', coalesce((select n from ent where f='efectivo'), 0),
       'pur', coalesce((select pur from ent where f='efectivo'), 0) - coalesce((select pur from pag where f='efectivo'), 0),
       'alc', coalesce((select alc from ent where f='efectivo'), 0) - coalesce((select alc from pag where f='efectivo'), 0)),
    'transferencia', json_build_object(
       'cobrado', coalesce((select m from ent where f='transferencia'), 0),
       'pagado',  coalesce((select m from pag where f='transferencia'), 0),
       'pedidos', coalesce((select n from ent where f='transferencia'), 0),
       'pur', coalesce((select pur from ent where f='transferencia'), 0) - coalesce((select pur from pag where f='transferencia'), 0),
       'alc', coalesce((select alc from ent where f='transferencia'), 0) - coalesce((select alc from pag where f='transferencia'), 0))
  ) into r;
  return r;
end $$;
grant execute on function public.saldo_javier to authenticated;

-- Registra en el turno de ventanilla el pago de Javier por lo que debe en esa forma de pago.
create or replace function public.cobrar_a_javier(p_turno_id bigint, p_forma text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  s json; v_debe numeric; v_pur int; v_alc int; v_items jsonb := '[]'::jsonb;
  v_rel bigint; v_ap bigint; v_venta bigint; v_total numeric;
begin
  if p_forma not in ('efectivo','transferencia') then raise exception 'Forma de pago no válida'; end if;
  s := saldo_javier();
  if (s->>'cliente_id') is null then raise exception 'Falta el cliente "Javier (reparto)"'; end if;
  v_debe := (s->p_forma->>'cobrado')::numeric - (s->p_forma->>'pagado')::numeric;
  v_pur := greatest((s->p_forma->>'pur')::int, 0);
  v_alc := greatest((s->p_forma->>'alc')::int, 0);
  if v_debe < 1 then raise exception 'Javier no debe nada en %', p_forma; end if;
  if v_pur + v_alc = 0 then v_pur := 1; end if;  -- ajuste de dinero sin garrafones (por correcciones)

  select id into v_rel from productos where nombre = 'Relleno garrafón' limit 1;
  select id into v_ap  from productos where nombre = 'Agua alcalina' limit 1;
  if v_pur > 0 then v_items := v_items || jsonb_build_object('producto_id', v_rel, 'cantidad', v_pur); end if;
  if v_alc > 0 then v_items := v_items || jsonb_build_object('producto_id', v_ap,  'cantidad', v_alc); end if;

  v_venta := registrar_venta(p_turno_id, p_forma, v_items, (s->>'cliente_id')::bigint, 'repartidor');

  -- el total debe ser exactamente lo que Javier cobró (por si algún pedido tuvo otro precio)
  select total into v_total from ventas where id = v_venta;
  if abs(v_total - v_debe) >= 0.01 then
    update venta_detalle d set importe = round(d.importe * v_debe / nullif(v_total, 0), 2),
           precio_unitario = round(d.importe * v_debe / nullif(v_total, 0) / d.cantidad, 2)
     where d.venta_id = v_venta;
    update ventas set total = (select sum(importe) from venta_detalle where venta_id = v_venta) where id = v_venta;
  end if;
  return json_build_object('ok', true, 'venta_id', v_venta, 'monto', v_debe);
end $$;
grant execute on function public.cobrar_a_javier to authenticated;

select 'Pestaña Javier lista' as resultado;
