-- =====================================================================
-- AGUA INMACULADA · EDITAR PEDIDOS A DOMICILIO (17-nov-2026)
-- Dueños y ventanilla pueden corregir un pedido:
--  · pendiente: cambiar garrafones por marca (purificada y alcalina) y forma de pago
--  · entregado: cambiar cuántos se entregaron y cómo pagó; se recalcula lo cobrado
-- Queda anotado en las notas quién lo corrigió y qué tenía antes.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
create or replace function public.editar_pedido(
  p_pedido_id bigint, p_marcas jsonb default null, p_entregados int default null,
  p_forma_pago text default null, p_motivo text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v pedidos%rowtype; v_marcas jsonb; v_cant int; v_alc int; v_pa numeric; v_monto numeric; v_q int; v_nota text; v_quien text;
begin
  if mi_rol() not in ('dueno','ventanilla') then raise exception 'Solo dueños o ventanilla pueden editar pedidos'; end if;
  select * into v from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v.estado = 'cancelado' then raise exception 'El pedido está cancelado'; end if;
  select nombre into v_quien from perfiles where id = auth.uid();

  if v.estado = 'pendiente' then
    select coalesce(jsonb_object_agg(key, (value)::int), '{}'::jsonb), coalesce(sum((value)::int), 0)
      into v_marcas, v_cant
    from jsonb_each_text(coalesce(p_marcas, v.marcas, '{}'::jsonb)) where value ~ '^\d{1,2}$' and (value)::int > 0;
    if v_cant < 1 then raise exception 'El pedido debe tener al menos 1 garrafón (o cancélalo)'; end if;
    select coalesce(sum((value)::int), 0) into v_alc from jsonb_each_text(v_marcas) where key like '% alcalina';
    v_pa := v.precio_alcalina;
    if v_alc > 0 and v_pa is null then
      select coalesce(precio_domicilio, precio) into v_pa from productos where nombre = 'Agua alcalina';
    end if;
    v_nota := format('Editado por %s %s: antes %s garrafones', coalesce(v_quien, ''), to_char(now() at time zone 'America/Mexico_City', 'DD/MM HH24:MI'), v.cantidad);
    update pedidos set marcas = v_marcas, cantidad = v_cant, alcalina = v_alc, precio_alcalina = v_pa,
      forma_pago = case when p_forma_pago in ('efectivo','transferencia') then p_forma_pago else forma_pago end,
      notas = concat_ws(' · ', nullif(notas, ''), v_nota, nullif(trim(p_motivo), ''))
    where id = p_pedido_id;
    return json_build_object('ok', true, 'cantidad', v_cant);
  end if;

  -- entregado: corregir cantidad entregada y forma de pago, y recalcular lo cobrado
  v_q := coalesce(p_entregados, v.entregado_cantidad);
  if v_q < 0 then raise exception 'Cantidad no válida'; end if;
  v_monto := (v_q - least(coalesce(v.alcalina, 0), v_q)) * v.precio_unitario
           + least(coalesce(v.alcalina, 0), v_q) * coalesce(v.precio_alcalina, v.precio_unitario);
  v_nota := format('Corregido por %s %s: antes %s entregados, %s %s', coalesce(v_quien, ''), to_char(now() at time zone 'America/Mexico_City', 'DD/MM HH24:MI'),
                   v.entregado_cantidad, v.forma_pago_real, to_char(v.monto_cobrado, 'FM$999,990.00'));
  update pedidos set entregado_cantidad = v_q, monto_cobrado = v_monto,
    forma_pago_real = case when p_forma_pago in ('efectivo','transferencia') then p_forma_pago else forma_pago_real end,
    notas = concat_ws(' · ', nullif(notas, ''), v_nota, nullif(trim(p_motivo), ''))
  where id = p_pedido_id;
  return json_build_object('ok', true, 'monto', v_monto);
end $$;
grant execute on function public.editar_pedido to authenticated;

select 'Editar pedidos listo' as resultado;
