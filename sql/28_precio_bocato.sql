-- =====================================================================
-- AGUA INMACULADA · PRECIO BOCATO (19-nov-2026)
-- Bocato: relleno con entrega de Javier a $27.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
do $$
declare v_n int; v_id bigint; v_antes numeric;
begin
  select count(*), min(id) into v_n, v_id from clientes where activo and nombre ilike '%bocato%';
  if v_n <> 1 then raise exception 'Encontré % clientes activos con "Bocato" en el nombre; no se cambió nada', v_n; end if;
  select precio_especial into v_antes from clientes where id = v_id;
  update clientes set precio_especial = 27 where id = v_id;
  raise notice 'Bocato: precio con entrega % → 27', coalesce(v_antes::text, 'normal');
end $$;

select nombre, precio_especial as precio_con_entrega from clientes where nombre ilike '%bocato%';
