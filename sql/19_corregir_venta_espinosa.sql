-- =====================================================================
-- CORRECCIÓN PUNTUAL · venta a Espinosa del 13-nov-2026, 7:27 p.m.
-- Yara la registró como "transferencia", pero Espinosa compra a crédito
-- (paga con factura). Se cambia a crédito para que entre en "Por cobrar".
-- Solo toca esa venta; si no encuentra exactamente una, no cambia nada.
-- =====================================================================
do $$
declare v_n int; v_id bigint;
begin
  select count(*), min(v.id) into v_n, v_id
  from ventas v join clientes c on c.id = v.cliente_id
  where c.nombre ilike '%espinosa%'
    and not v.cancelada and v.forma_pago = 'transferencia'
    and (v.fecha at time zone 'America/Mexico_City')::date = date '2026-11-13'
    and to_char(v.fecha at time zone 'America/Mexico_City', 'HH24:MI') between '19:20' and '19:35';
  if v_n <> 1 then
    raise exception 'Se esperaba 1 venta de Espinosa por transferencia hacia las 7:27 p.m. del 13-nov y se encontraron %. No se cambió nada.', v_n;
  end if;
  update ventas set forma_pago = 'credito' where id = v_id;
  raise notice 'Venta % cambiada a crédito', v_id;
end $$;

select v.id, c.nombre, v.fecha at time zone 'America/Mexico_City' as fecha_local, v.total, v.forma_pago
from ventas v join clientes c on c.id = v.cliente_id
where c.nombre ilike '%espinosa%' and (v.fecha at time zone 'America/Mexico_City')::date = date '2026-11-13';
