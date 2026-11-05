-- =====================================================================
-- AGUA INMACULADA · PEDIDO EN LÍNEA (página pública "Haz tu pedido") · 05-nov-2026
-- El cliente escribe su teléfono y sus garrafones por marca.
-- Si el teléfono ya está guardado, el pedido sale con el domicilio que tiene la planta
-- (la página nunca muestra domicilios). Si no, pide domicilio y queda "por revisar".
-- Límites: un pedido pendiente por teléfono y máximo 40 pedidos en línea por hora.
-- Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.pedidos add column if not exists revisar boolean not null default false;

-- Precio por garrafón a domicilio (lo único que la página pública puede consultar)
create or replace function public.precio_pedido_en_linea()
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(precio_domicilio, precio) from productos where nombre = 'Relleno garrafón' and activo limit 1;
$$;

create or replace function public.pedido_en_linea(
  p_telefono text, p_marcas jsonb, p_forma_pago text default 'efectivo',
  p_comentario text default null, p_nombre text default null, p_domicilio text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_tel text; v_cli clientes%rowtype; v_p productos%rowtype; v_marcas jsonb; v_cant int; v_id bigint; v_nuevo boolean := false;
  v_com text := nullif(left(trim(coalesce(p_comentario, '')), 500), '');
begin
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
  where key in ('Ciel','Epura','Bluerock','Bonafont','Rositas') and value ~ '^\d{1,2}$' and (value)::int > 0;
  if v_cant < 1 or v_cant > 20 then return json_build_object('ok', false, 'motivo', 'cantidad'); end if;

  select * into v_p from productos where nombre = 'Relleno garrafón' and activo;
  if not found then return json_build_object('ok', false, 'motivo', 'cerrado'); end if;

  select * into v_cli from clientes
   where tipo = 'domicilio' and activo and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel
   order by id limit 1;

  if v_cli.id is null then
    -- cliente nuevo: hace falta su domicilio
    if coalesce(trim(p_domicilio), '') = '' then return json_build_object('ok', false, 'motivo', 'domicilio'); end if;
    v_nuevo := true;
  end if;

  insert into pedidos (nombre, telefono, domicilio, maps_url, producto_id, cantidad, precio_unitario, forma_pago, notas,
                       cliente_id, marcas, origen, revisar)
  values (coalesce(v_cli.nombre, nullif(left(trim(coalesce(p_nombre, '')), 120), ''), 'Cliente nuevo'),
          v_tel,
          coalesce(v_cli.domicilio, left(trim(p_domicilio), 200)),
          v_cli.maps_url, v_p.id, v_cant, coalesce(v_p.precio_domicilio, v_p.precio),
          case when p_forma_pago = 'transferencia' then 'transferencia' else 'efectivo' end,
          case when v_nuevo then 'CLIENTE NUEVO · ' else '' end || coalesce(v_com, ''),
          v_cli.id, v_marcas, 'cliente', v_nuevo or v_com is not null)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'nuevo', v_nuevo, 'total', v_cant * coalesce(v_p.precio_domicilio, v_p.precio));
end $$;

grant execute on function public.precio_pedido_en_linea, public.pedido_en_linea to anon, authenticated;

-- Para la planta: guardar como cliente al que pidió por primera vez, o marcar como revisado
create or replace function public.revisar_pedido(p_pedido_id bigint, p_guardar_cliente boolean default false,
  p_nombre text default null, p_domicilio text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_p pedidos%rowtype; v_cli bigint;
begin
  if mi_rol() not in ('dueno','ventanilla') then raise exception 'Solo dueños o ventanilla'; end if;
  select * into v_p from pedidos where id = p_pedido_id;
  if not found then raise exception 'Pedido no encontrado'; end if;
  v_cli := v_p.cliente_id;
  if p_guardar_cliente and v_cli is null then
    insert into clientes (tipo, nombre, telefono, domicilio)
    values ('domicilio', coalesce(nullif(trim(p_nombre), ''), v_p.nombre), v_p.telefono, coalesce(nullif(trim(p_domicilio), ''), v_p.domicilio))
    returning id into v_cli;
  end if;
  update pedidos set revisar = false, cliente_id = v_cli,
    nombre = coalesce(nullif(trim(p_nombre), ''), nombre), domicilio = coalesce(nullif(trim(p_domicilio), ''), domicilio)
  where id = p_pedido_id;
  return v_cli;
end $$;
grant execute on function public.revisar_pedido to authenticated;

select 'Pedido en línea listo' as resultado;
