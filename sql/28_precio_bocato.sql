-- =====================================================================
-- AGUA INMACULADA · PRECIO BOCATO (19-nov-2026)
-- Bocato: relleno con entrega de Javier a $27, y corrige a $27 sus entregas de hoy.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
do $$
declare v_n int; v_id bigint; v_antes numeric; v_rel bigint; r record; v_fix int := 0;
begin
  select count(*), min(id) into v_n, v_id from clientes where activo and nombre ilike '%bocato%';
  if v_n <> 1 then raise exception 'Encontré % clientes activos con "Bocato" en el nombre; no se cambió nada', v_n; end if;
  select precio_especial into v_antes from clientes where id = v_id;
  update clientes set precio_especial = 27 where id = v_id;
  raise notice 'Bocato: precio con entrega % → 27', coalesce(v_antes::text, 'normal');
  select id into v_rel from productos where nombre = 'Relleno garrafón';
  for r in select distinct v.id from entregas e join ventas v on v.id = e.venta_id
           join venta_detalle d on d.venta_id = v.id and d.producto_id = v_rel and d.precio_unitario <> 27
           where e.cliente_id = v_id and not v.cancelada and e.fecha >= '2026-11-19 00:00 America/Mexico_City'
  loop
    update venta_detalle set precio_unitario = 27, importe = 27 * cantidad where venta_id = r.id and producto_id = v_rel;
    update ventas set total = (select sum(importe) from venta_detalle where venta_id = r.id) where id = r.id;
    v_fix := v_fix + 1;
  end loop;
  raise notice 'Entregas de hoy a Bocato corregidas a $27: %', v_fix;
end $$;

select nombre, precio_especial as precio_con_entrega from clientes where nombre ilike '%bocato%';
