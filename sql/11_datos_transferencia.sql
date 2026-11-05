-- =====================================================================
-- AGUA INMACULADA · DATOS DE TRANSFERENCIA EN LA PÁGINA DE PEDIDOS (05-nov-2026)
-- El dueño escribe banco, CLABE y titular en Ajustes; la página pública los muestra
-- solo cuando el cliente elige pagar por transferencia.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
insert into public.config (clave, texto, descripcion) values
  ('datos_transferencia', null, 'Datos para transferencia que ve el cliente en la página de pedidos (banco, CLABE y a nombre de quién)')
on conflict (clave) do nothing;

create or replace function public.datos_transferencia()
returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(texto), '') from config where clave = 'datos_transferencia';
$$;
grant execute on function public.datos_transferencia to anon, authenticated;

select 'Datos de transferencia listos' as resultado;
