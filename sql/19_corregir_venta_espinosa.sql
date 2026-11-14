-- =====================================================================
-- CORRECCIÓN PUNTUAL · venta del 13-nov-2026 a las 7:27 p.m. por $641
-- (2 "Espinoza Hielo" + 23 "Espinoza Agua"). Se registró SIN cliente y como
-- transferencia; Espinosa compra a crédito. Se le asigna el cliente Espinosa
-- y se pasa a crédito para que entre en "Por cobrar".
-- Si no encuentra exactamente una venta y un cliente, no cambia nada.
-- (v3)
-- =====================================================================
do $$
declare v_n int; v_id bigint; v_nc int; v_cli bigint; v_lista text;
begin
  select count(*), min(id) into v_n, v_id from ventas
  where not cancelada and total = 641
    and (fecha at time zone 'America/Mexico_City')::date = date '2026-11-13'
    and to_char(fecha at time zone 'America/Mexico_City', 'HH24:MI') between '19:25' and '19:29';
  if v_n <> 1 then raise exception 'Encontré % ventas de $641 a las 7:27 p.m.; no se cambió nada.', v_n; end if;

  select count(*), min(id) into v_nc, v_cli from clientes
  where activo and (nombre ilike '%espinos%' or nombre ilike '%espinoz%');
  if v_nc <> 1 then
    select string_agg(format('#%s %s (%s)', id, nombre, tipo), ' | ' order by nombre) into v_lista
    from clientes where activo and tipo in ('empresa','restaurante');
    raise exception 'Encontré % clientes llamados Espinosa/Espinoza; no se cambió nada. Empresas dadas de alta: %', v_nc, coalesce(v_lista, 'ninguna');
  end if;

  update ventas set cliente_id = v_cli, forma_pago = 'credito', canal = 'empresa' where id = v_id;
  raise notice 'Venta % asignada al cliente % y cambiada a crédito', v_id, v_cli;
end $$;
