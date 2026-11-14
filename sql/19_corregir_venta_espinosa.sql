-- =====================================================================
-- CORRECCIÓN PUNTUAL · venta a Espinosa del 13-nov-2026, ~7:27 p.m.
-- Yara la registró como "transferencia", pero Espinosa compra a crédito
-- (paga con factura). Se cambia a crédito para que entre en "Por cobrar".
-- Solo toca esa venta; si no encuentra exactamente una, no cambia nada y
-- muestra las transferencias de ese día para identificarla.
-- (v2: busca Espinosa/Espinoza y cualquier hora entre 7 y 8 p.m.)
-- =====================================================================
do $$
declare v_n int; v_id bigint; v_lista text;
begin
  select count(*), min(v.id) into v_n, v_id
  from ventas v join clientes c on c.id = v.cliente_id
  where (c.nombre ilike '%espinos%' or c.nombre ilike '%espinoz%')
    and not v.cancelada and v.forma_pago = 'transferencia'
    and (v.fecha at time zone 'America/Mexico_City')::date = date '2026-11-13'
    and extract(hour from v.fecha at time zone 'America/Mexico_City') = 19;
  if v_n <> 1 then
    select string_agg(format('#%s %s %s $%s %s', v.id, to_char(v.fecha at time zone 'America/Mexico_City', 'HH24:MI'),
                             coalesce(c.nombre, 'sin cliente'), v.total, v.forma_pago), ' | ' order by v.fecha)
      into v_lista
    from ventas v left join clientes c on c.id = v.cliente_id
    where (v.fecha at time zone 'America/Mexico_City')::date = date '2026-11-13'
      and extract(hour from v.fecha at time zone 'America/Mexico_City') between 18 and 20 and not v.cancelada;
    raise exception 'Encontré % ventas que coinciden; no se cambió nada. Ventas de 6 a 9 p.m.: %', v_n, coalesce(v_lista, 'ninguna');
  end if;
  update ventas set forma_pago = 'credito' where id = v_id;
  raise notice 'Venta % cambiada a crédito', v_id;
end $$;
