-- =====================================================================
-- AGUA INMACULADA · PEDIDOS A DOMICILIO CON MARCAS + AVISOS A JAVIER (05-nov-2026)
-- 1) Un pedido lleva varias marcas (Ciel, Epura, Bluerock, Bonafont, Rositas).
-- 2) El cliente se guarda solo (por teléfono) y queda listo para "repetir pedido".
-- 3) Avisos: tiempo real en la app y suscripciones para notificación con el
--    teléfono bloqueado (las envía la función "aviso-pedido" de Supabase).
-- Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.pedidos add column if not exists marcas jsonb;          -- {"Ciel": 2, "Epura": 1}
alter table public.pedidos add column if not exists origen text not null default 'app';  -- app / cliente
alter table public.pedidos add column if not exists avisado_en timestamptz;

-- ---------- crear pedido (con marcas y alta automática del cliente) ----------
drop function if exists public.crear_pedido(text, text, text, text, bigint, int, text, text, bigint, uuid);
drop function if exists public.crear_pedido(text, text, text, text, bigint, int, text, text, bigint, uuid, jsonb);
create or replace function public.crear_pedido(
  p_nombre text, p_telefono text, p_domicilio text, p_maps text, p_producto_id bigint,
  p_cantidad int, p_forma_pago text, p_notas text default null, p_cliente_id bigint default null,
  p_asignado uuid default null, p_marcas jsonb default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_p productos%rowtype; v_id bigint; v_cant int; v_cli bigint := p_cliente_id; v_tel text; v_marcas jsonb;
begin
  if mi_rol() not in ('dueno','ventanilla') then raise exception 'Solo dueños o ventanilla capturan pedidos'; end if;
  if p_producto_id is null then
    select * into v_p from productos where nombre = 'Relleno garrafón' and activo;
  else
    select * into v_p from productos where id = p_producto_id and activo;
  end if;
  if not found then raise exception 'Producto no válido'; end if;
  if coalesce(trim(p_domicilio), '') = '' then raise exception 'Escribe el domicilio'; end if;

  -- marcas: solo cantidades positivas
  select coalesce(jsonb_object_agg(key, (value)::int), '{}'::jsonb), coalesce(sum((value)::int), 0)
    into v_marcas, v_cant
  from jsonb_each_text(coalesce(p_marcas, '{}'::jsonb)) where (value)::int > 0;
  if v_cant = 0 then v_cant := coalesce(p_cantidad, 0); v_marcas := null; end if;
  if v_cant <= 0 then raise exception 'Escribe cuántos garrafones'; end if;

  -- cliente: si no viene, se busca por teléfono; si no existe, se da de alta
  v_tel := nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), '');
  if v_tel is not null then v_tel := right(v_tel, 10); end if;
  if v_cli is null and v_tel is not null then
    select id into v_cli from clientes
     where tipo = 'domicilio' and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_tel
     order by id limit 1;
  end if;
  if v_cli is null and v_tel is not null then
    insert into clientes (tipo, nombre, telefono, domicilio, maps_url)
    values ('domicilio', coalesce(nullif(trim(p_nombre), ''), 'Cliente ' || v_tel), v_tel, p_domicilio, p_maps)
    returning id into v_cli;
  elsif v_cli is not null then
    update clientes set domicilio = coalesce(nullif(trim(p_domicilio), ''), domicilio),
                        maps_url = coalesce(nullif(trim(p_maps), ''), maps_url),
                        telefono = coalesce(telefono, v_tel)
     where id = v_cli and tipo = 'domicilio';
  end if;

  insert into pedidos (nombre, telefono, domicilio, maps_url, producto_id, cantidad, precio_unitario, forma_pago, notas,
                       cliente_id, asignado_a, creado_por, marcas)
  values (coalesce(nullif(trim(p_nombre), ''), 'Cliente'), coalesce(v_tel, p_telefono), p_domicilio, p_maps, v_p.id, v_cant,
          coalesce(v_p.precio_domicilio, v_p.precio), coalesce(p_forma_pago, 'efectivo'), p_notas, v_cli, p_asignado, auth.uid(), v_marcas)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.crear_pedido to authenticated;

-- ---------- tiempo real: la app de Javier se entera al instante ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos') then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end $$;

-- ---------- suscripciones para notificación con teléfono bloqueado ----------
create table if not exists public.push_subs (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.perfiles(id) default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists push_subs_propias on public.push_subs;
create policy push_subs_propias on public.push_subs for all to authenticated
  using (usuario_id = auth.uid() or es_dueno()) with check (usuario_id = auth.uid());
revoke all on public.push_subs from anon;

-- Guardar (o renovar) la suscripción del teléfono
create or replace function public.guardar_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if mi_rol() is null then raise exception 'Usuario sin acceso'; end if;
  insert into push_subs (usuario_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set usuario_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, creado_en = now();
end $$;
grant execute on function public.guardar_push to authenticated;

select 'Pedidos con marcas y avisos listos' as resultado;
