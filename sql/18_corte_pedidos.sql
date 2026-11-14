-- =====================================================================
-- AGUA INMACULADA · HORA DE CORTE PARA PEDIDOS EN LÍNEA (13-nov-2026)
-- Lunes a viernes ya no se aceptan pedidos de la liga después de las 5:00 p.m.,
-- sábado después de las 3:00 p.m. y domingo después de las 4:00 p.m. (cierre).
-- Las horas se cambian en Ajustes. Antes de las 9 a.m. sí se aceptan (salen a las 9).
-- Se puede correr más de una vez sin problema.
-- =====================================================================
insert into public.config (clave, valor, descripcion) values
  ('corte_pedidos_lv',  17, 'Hora de corte de pedidos en línea, lunes a viernes (17 = 5:00 p.m.)'),
  ('corte_pedidos_sab', 15, 'Hora de corte de pedidos en línea, sábado (15 = 3:00 p.m.)'),
  ('corte_pedidos_dom', 16, 'Hora de corte de pedidos en línea, domingo (16 = 4:00 p.m.)')
on conflict (clave) do nothing;

create or replace function public.estado_pedido_en_linea(p_telefono text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_tel text; v_id bigint; v_creado timestamptz; v_marcas jsonb; v_antes int := 0;
  v_ahora timestamp := now() at time zone 'America/Mexico_City';
  v_dow int; v_h numeric; v_fin int; v_abierto boolean; v_abre text; v_corte numeric; v_acepta boolean;
begin
  v_dow := extract(dow from v_ahora);
  v_h := extract(hour from v_ahora) + extract(minute from v_ahora) / 60.0;
  v_fin := case v_dow when 0 then 16 when 6 then 18 else 21 end;
  v_abierto := v_h >= 9 and v_h < v_fin;
  v_abre := case when v_h < 9 then 'hoy a partir de las 9:00 a.m.' else 'mañana a partir de las 9:00 a.m.' end;
  -- hora de corte de pedidos en línea (se cambia en Ajustes)
  v_corte := coalesce((select valor from config where clave = case v_dow when 6 then 'corte_pedidos_sab' when 0 then 'corte_pedidos_dom' else 'corte_pedidos_lv' end), v_fin);
  v_acepta := v_h < v_corte;

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
    'abierto', v_abierto, 'abre', v_abre, 'acepta', v_acepta, 'corte', v_corte,
    'tiempo', (select nullif(trim(texto), '') from config where clave = 'tiempo_entrega'));
end $$;
grant execute on function public.estado_pedido_en_linea to anon, authenticated;

create or replace function public.pedido_en_linea(
  p_telefono text, p_marcas jsonb, p_forma_pago text default 'efectivo',
  p_comentario text default null, p_nombre text default null, p_domicilio text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_tel text; v_cli clientes%rowtype; v_p productos%rowtype; v_marcas jsonb; v_cant int; v_id bigint; v_nuevo boolean := false; v_alc int := 0; v_pa numeric;
  v_com text := nullif(left(trim(coalesce(p_comentario, '')), 500), '');
begin
  -- horario de pedidos en línea: después de la hora de corte ya no se aceptan
  if not ((estado_pedido_en_linea(null))->>'acepta')::boolean then
    return json_build_object('ok', false, 'motivo', 'horario');
  end if;
  v_tel := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10);
  if length(v_tel) <> 10 then return json_build_object('ok', false, 'motivo', 'telefono'); end if;

  -- límite general anti-bromas
  if (select count(*) from pedidos where origen = 'cliente' and creado_en > now() - interval '1 hour') >= 40 then
    return json_build_object('ok', false, 'motivo', 'saturado');
  end if;
  -- un pedido pendiente por teléfono
  if exists (select 1 from pedidos where estado = 'pendiente' and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel) then
    return json_build_object('ok', false, 'motivo', 'pendiente');
  end if;

  -- marcas válidas, de 1 a 20 garrafones en total
  select coalesce(jsonb_object_agg(key, (value)::int), '{}'::jsonb), coalesce(sum((value)::int), 0)
    into v_marcas, v_cant
  from jsonb_each_text(coalesce(p_marcas, '{}'::jsonb))
  where (key in ('Ciel','Epura','Bluerock','Bonafont','Rositas')
         or key in ('Ciel alcalina','Epura alcalina','Bluerock alcalina','Bonafont alcalina','Rositas alcalina'))
    and value ~ '^\d{1,2}$' and (value)::int > 0;
  if v_cant < 1 or v_cant > 20 then return json_build_object('ok', false, 'motivo', 'cantidad'); end if;

  select * into v_p from productos where nombre = 'Relleno garrafón' and activo;
  if not found then return json_build_object('ok', false, 'motivo', 'cerrado'); end if;
  select coalesce(sum((value)::int), 0) into v_alc from jsonb_each_text(v_marcas) where key like '% alcalina';
  if v_alc > 0 then
    select coalesce(precio_domicilio, precio) into v_pa from productos where nombre = 'Agua alcalina' and activo;
    if v_pa is null then return json_build_object('ok', false, 'motivo', 'alcalina'); end if;
  end if;

  select * into v_cli from clientes
   where tipo = 'domicilio' and activo and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel
   order by id limit 1;

  if v_cli.id is null then
    -- cliente nuevo: hace falta su domicilio
    if coalesce(trim(p_domicilio), '') = '' then return json_build_object('ok', false, 'motivo', 'domicilio'); end if;
    v_nuevo := true;
  end if;

  insert into pedidos (nombre, telefono, domicilio, maps_url, producto_id, cantidad, precio_unitario, forma_pago, notas,
                       cliente_id, marcas, origen, revisar, alcalina, precio_alcalina)
  values (coalesce(v_cli.nombre, nullif(left(trim(coalesce(p_nombre, '')), 120), ''), 'Cliente nuevo'),
          v_tel,
          coalesce(v_cli.domicilio, left(trim(p_domicilio), 200)),
          v_cli.maps_url, v_p.id, v_cant, coalesce(v_p.precio_domicilio, v_p.precio),
          case when p_forma_pago = 'transferencia' then 'transferencia' else 'efectivo' end,
          case when v_nuevo then 'CLIENTE NUEVO · ' else '' end || coalesce(v_com, ''),
          v_cli.id, v_marcas, 'cliente', v_nuevo or v_com is not null, v_alc, v_pa)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'nuevo', v_nuevo, 'total', (v_cant - v_alc) * coalesce(v_p.precio_domicilio, v_p.precio) + v_alc * coalesce(v_pa, 0));
end $$;
grant execute on function public.pedido_en_linea to anon, authenticated;

select 'Hora de corte de pedidos lista' as resultado;
