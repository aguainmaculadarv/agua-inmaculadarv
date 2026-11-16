-- =====================================================================
-- AGUA INMACULADA · PAUSAR PEDIDOS EN LÍNEA CON UN BOTÓN (16-nov-2026)
-- El dueño pausa la liga de pedidos (solo hoy o hasta reactivar) desde Pedidos.
-- Mientras está pausada, la página muestra el aviso y la base rechaza pedidos.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
insert into public.config (clave, texto, descripcion) values
  ('pausa_pedidos', '', 'Pausa de pedidos en línea (se maneja con el botón en Pedidos)'),
  ('pausa_pedidos_aviso', 'Hoy no tenemos servicio a domicilio. Te esperamos en la planta.', 'Mensaje que ve el cliente cuando los pedidos en línea están pausados')
on conflict (clave) do nothing;

create or replace function public.estado_pedido_en_linea(p_telefono text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_tel text; v_id bigint; v_creado timestamptz; v_marcas jsonb; v_antes int := 0;
  v_ahora timestamp := now() at time zone 'America/Mexico_City';
  v_dow int; v_h numeric; v_fin int; v_abierto boolean; v_abre text; v_corte numeric; v_acepta boolean; v_pausa text; v_pausado boolean := false;
begin
  v_dow := extract(dow from v_ahora);
  v_h := extract(hour from v_ahora) + extract(minute from v_ahora) / 60.0;
  v_fin := case v_dow when 0 then 16 when 6 then 18 else 21 end;
  v_abierto := v_h >= 9 and v_h < v_fin;
  v_abre := case when v_h < 9 then 'hoy a partir de las 9:00 a.m.' else 'mañana a partir de las 9:00 a.m.' end;
  -- hora de corte de pedidos en línea (se cambia en Ajustes)
  v_corte := coalesce((select valor from config where clave = case v_dow when 6 then 'corte_pedidos_sab' when 0 then 'corte_pedidos_dom' else 'corte_pedidos_lv' end), v_fin);
  v_acepta := v_h < v_corte;
  -- pausa manual desde la app (botón del dueño): 'siempre' o una fecha hasta la que se pausa (inclusive)
  v_pausa := nullif(trim((select texto from config where clave = 'pausa_pedidos')), '');
  if v_pausa = 'siempre' or (v_pausa ~ '^\d{4}-\d{2}-\d{2}$' and v_pausa::date >= v_ahora::date) then
    v_pausado := true; v_acepta := false;
  end if;

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
    'abierto', v_abierto, 'abre', v_abre, 'acepta', v_acepta, 'corte', v_corte, 'pausado', v_pausado,
    'aviso_pausa', (select nullif(trim(texto), '') from config where clave = 'pausa_pedidos_aviso'),
    'tiempo', (select nullif(trim(texto), '') from config where clave = 'tiempo_entrega'));
end $$;
grant execute on function public.estado_pedido_en_linea to anon, authenticated;

select 'Pausa de pedidos lista' as resultado;
