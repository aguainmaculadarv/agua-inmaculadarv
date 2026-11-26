-- =====================================================================
-- AGUA INMACULADA · PRECIO ESPECIAL EN PEDIDOS POR TELÉFONO (25-nov-2026)
--  1) Si alguien pide por la liga con el teléfono de un cliente registrado que
--     tiene precio especial (ej. Bocato), el pedido toma ese precio solo.
--  2) "Editar" pedido ahora también cambia el precio por garrafón.
--  3) Bocato: precio especial $25 (pedidos y entregas). Corrige lo de hoy.
-- Se puede correr más de una vez sin problema.
-- =====================================================================

drop function if exists public.editar_pedido(bigint, jsonb, int, text, text);
create or replace function public.editar_pedido(
  p_pedido_id bigint, p_marcas jsonb default null, p_entregados int default null,
  p_forma_pago text default null, p_motivo text default null, p_precio numeric default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v pedidos%rowtype; v_marcas jsonb; v_cant int; v_alc int; v_pa numeric; v_monto numeric; v_q int; v_nota text; v_quien text;
begin
  if p_precio is not null and (p_precio < 5 or p_precio > 200) then raise exception 'Precio por garrafón no válido'; end if;
  if mi_rol() not in ('dueno','ventanilla') then raise exception 'Solo dueños o ventanilla pueden editar pedidos'; end if;
  select * into v from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v.estado = 'cancelado' then raise exception 'El pedido está cancelado'; end if;
  select nombre into v_quien from perfiles where id = auth.uid();

  if v.estado = 'pendiente' then
    if p_marcas is null and coalesce(v.marcas, '{}'::jsonb) = '{}'::jsonb then
      v_marcas := v.marcas; v_cant := v.cantidad;   -- pedido sin marcas: solo cambia precio o forma de pago
    else
    select coalesce(jsonb_object_agg(key, (value)::int), '{}'::jsonb), coalesce(sum((value)::int), 0)
      into v_marcas, v_cant
    from jsonb_each_text(coalesce(p_marcas, v.marcas, '{}'::jsonb)) where value ~ '^\d{1,2}$' and (value)::int > 0;
    end if;
    if v_cant < 1 then raise exception 'El pedido debe tener al menos 1 garrafón (o cancélalo)'; end if;
    select coalesce(sum((value)::int), 0) into v_alc from jsonb_each_text(coalesce(v_marcas, '{}'::jsonb)) where key like '% alcalina';
    if v_marcas is null then v_alc := coalesce(v.alcalina, 0); end if;
    v_pa := v.precio_alcalina;
    if v_alc > 0 and v_pa is null then
      select coalesce(precio_domicilio, precio) into v_pa from productos where nombre = 'Agua alcalina';
    end if;
    v_nota := format('Editado por %s %s: antes %s garrafones', coalesce(v_quien, ''), to_char(now() at time zone 'America/Mexico_City', 'DD/MM HH24:MI'), v.cantidad);
    if p_precio is not null and p_precio <> v.precio_unitario then v_nota := v_nota || format(', precio %s → %s', v.precio_unitario, p_precio); end if;
    update pedidos set marcas = v_marcas, cantidad = v_cant, alcalina = v_alc, precio_alcalina = v_pa,
      precio_unitario = coalesce(p_precio, precio_unitario),
      forma_pago = case when p_forma_pago in ('efectivo','transferencia') then p_forma_pago else forma_pago end,
      notas = concat_ws(' · ', nullif(notas, ''), v_nota, nullif(trim(p_motivo), ''))
    where id = p_pedido_id;
    return json_build_object('ok', true, 'cantidad', v_cant);
  end if;

  -- entregado: corregir cantidad entregada y forma de pago, y recalcular lo cobrado
  v_q := coalesce(p_entregados, v.entregado_cantidad);
  if v_q < 0 then raise exception 'Cantidad no válida'; end if;
  v_monto := (v_q - least(coalesce(v.alcalina, 0), v_q)) * coalesce(p_precio, v.precio_unitario)
           + least(coalesce(v.alcalina, 0), v_q) * coalesce(v.precio_alcalina, p_precio, v.precio_unitario);
  v_nota := format('Corregido por %s %s: antes %s entregados, %s %s', coalesce(v_quien, ''), to_char(now() at time zone 'America/Mexico_City', 'DD/MM HH24:MI'),
                   v.entregado_cantidad, v.forma_pago_real, to_char(v.monto_cobrado, 'FM$999,990.00'));
  if p_precio is not null and p_precio <> v.precio_unitario then v_nota := v_nota || format(', precio %s → %s', v.precio_unitario, p_precio); end if;
  update pedidos set entregado_cantidad = v_q, monto_cobrado = v_monto, precio_unitario = coalesce(p_precio, precio_unitario),
    forma_pago_real = case when p_forma_pago in ('efectivo','transferencia') then p_forma_pago else forma_pago_real end,
    notas = concat_ws(' · ', nullif(notas, ''), v_nota, nullif(trim(p_motivo), ''))
  where id = p_pedido_id;
  return json_build_object('ok', true, 'monto', v_monto);
end $$;
grant execute on function public.editar_pedido to authenticated;

-- Precio especial por teléfono al crear un pedido (no aplica a ventas agregadas por Javier)
create or replace function public.pedido_precio_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tel text; v_pe numeric; v_n int;
begin
  if new.origen is not distinct from 'ruta' then return new; end if;
  v_tel := right(regexp_replace(coalesce(new.telefono, ''), '\D', '', 'g'), 10);
  if length(v_tel) < 10 then return new; end if;
  select count(*), min(precio_especial) into v_n, v_pe from clientes
   where activo and precio_especial is not null
     and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel;
  if v_n = 1 and v_pe > 0 then new.precio_unitario := v_pe; end if;
  return new;
end $$;
drop trigger if exists pedidos_precio_cliente on public.pedidos;
create trigger pedidos_precio_cliente before insert on public.pedidos
  for each row execute function public.pedido_precio_cliente();

-- Bocato a $25, su teléfono (si falta) desde su pedido de hoy, y corrección de lo de hoy
do $$
declare v_id bigint; v_n int; v_tel text; v_tels int; v_rel bigint; r record; v_fp int := 0; v_fe int := 0;
begin
  select count(*), min(id) into v_n, v_id from clientes where activo and nombre ilike '%bocato%';
  if v_n <> 1 then raise exception 'Encontré % clientes activos con "Bocato"; no se cambió nada', v_n; end if;
  update clientes set precio_especial = 25 where id = v_id;
  select telefono into v_tel from clientes where id = v_id;
  if length(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g')) < 10 then
    select count(distinct telefono), min(telefono) into v_tels, v_tel from pedidos
     where nombre ilike '%bocato%' and telefono is not null and creado_en >= '2026-11-01';
    if v_tels = 1 then update clientes set telefono = v_tel where id = v_id; raise notice 'Teléfono de Bocato tomado de su pedido: %', v_tel;
    else raise notice 'No pude tomar el teléfono de Bocato (encontré %). Ponlo a mano en Clientes.', v_tels; end if;
  end if;
  -- pedidos de Bocato desde hoy
  for r in select * from pedidos where creado_en >= '2026-11-25 00:00 America/Mexico_City' and estado <> 'cancelado'
           and (nombre ilike '%bocato%' or (v_tel is not null and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = right(regexp_replace(v_tel, '\D', '', 'g'), 10)))
           and precio_unitario <> 25
  loop
    update pedidos set precio_unitario = 25,
      monto_cobrado = case when estado = 'entregado' then
        (entregado_cantidad - least(coalesce(alcalina, 0), entregado_cantidad)) * 25 + least(coalesce(alcalina, 0), entregado_cantidad) * coalesce(precio_alcalina, 25)
        else monto_cobrado end,
      notas = concat_ws(' · ', nullif(notas, ''), format('Precio corregido %s → 25 (precio especial Bocato)', r.precio_unitario))
    where id = r.id;
    v_fp := v_fp + 1;
  end loop;
  -- entregas a Bocato desde hoy
  select id into v_rel from productos where nombre = 'Relleno garrafón';
  for r in select distinct v.id from entregas e join ventas v on v.id = e.venta_id
           join venta_detalle d on d.venta_id = v.id and d.producto_id = v_rel and d.precio_unitario <> 25
           where e.cliente_id = v_id and not v.cancelada and e.fecha >= '2026-11-25 00:00 America/Mexico_City'
  loop
    update venta_detalle set precio_unitario = 25, importe = 25 * cantidad where venta_id = r.id and producto_id = v_rel;
    update ventas set total = (select sum(importe) from venta_detalle where venta_id = r.id) where id = r.id;
    v_fe := v_fe + 1;
  end loop;
  raise notice 'Bocato a $25 · pedidos corregidos: % · entregas corregidas: %', v_fp, v_fe;
end $$;

select nombre, telefono, precio_especial from clientes where nombre ilike '%bocato%';
