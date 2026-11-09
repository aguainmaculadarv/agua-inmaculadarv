-- =====================================================================
-- AGUA INMACULADA · NÚMERO DE PEDIDO, LUGAR EN LA FILA Y TIEMPO ESTIMADO (09-nov-2026)
-- La página pública le dice al cliente su número de pedido, cuántos pedidos van
-- antes del suyo y el tiempo normal de entrega (lo escribe el dueño en Ajustes).
-- Fuera de horario (L-V 9-21, Sáb 9-18, Dom 9-16) le avisa cuándo se entrega.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
insert into public.config (clave, texto, descripcion) values
  ('tiempo_entrega', 'Normalmente entregamos en 30 a 60 minutos.', 'Tiempo de entrega que ve el cliente al hacer su pedido en línea')
on conflict (clave) do nothing;

create or replace function public.estado_pedido_en_linea(p_telefono text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_tel text; v_id bigint; v_creado timestamptz; v_marcas jsonb; v_antes int := 0;
  v_ahora timestamp := now() at time zone 'America/Mexico_City';
  v_dow int; v_h numeric; v_fin int; v_abierto boolean; v_abre text;
begin
  v_dow := extract(dow from v_ahora);
  v_h := extract(hour from v_ahora) + extract(minute from v_ahora) / 60.0;
  v_fin := case v_dow when 0 then 16 when 6 then 18 else 21 end;
  v_abierto := v_h >= 9 and v_h < v_fin;
  v_abre := case when v_h < 9 then 'hoy a partir de las 9:00 a.m.' else 'mañana a partir de las 9:00 a.m.' end;

  v_tel := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10);
  if length(v_tel) = 10 then
    select id, creado_en, marcas into v_id, v_creado, v_marcas from pedidos
     where estado = 'pendiente' and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel
     order by creado_en desc limit 1;
    if v_id is not null then
      select count(*) into v_antes from pedidos where estado = 'pendiente' and creado_en < v_creado;
    end if;
  end if;

  return json_build_object('pendiente', v_id is not null, 'id', v_id, 'marcas', v_marcas, 'antes', v_antes,
    'abierto', v_abierto, 'abre', v_abre,
    'tiempo', (select nullif(trim(texto), '') from config where clave = 'tiempo_entrega'));
end $$;
grant execute on function public.estado_pedido_en_linea to anon, authenticated;

select 'Fila de pedidos lista' as resultado;
