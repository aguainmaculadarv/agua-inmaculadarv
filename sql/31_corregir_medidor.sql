-- =====================================================================
-- AGUA INMACULADA · CORREGIR LECTURA DEL MEDIDOR (23-nov-2026)
-- Solo dueños: corrige la lectura inicial y/o final del medidor de un turno de
-- planta (abierto o cerrado) y recalcula los litros. Queda nota de quién y por qué.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
create or replace function public.corregir_medidor(
  p_turno_id bigint, p_inicial numeric, p_final numeric default null, p_motivo text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare t turnos%rowtype; v_factor numeric := 1; v_lm numeric; v_fin numeric;
begin
  if not es_dueno() then raise exception 'Solo los dueños pueden corregir el medidor'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo'; end if;
  select * into t from turnos where id = p_turno_id;
  if not found then raise exception 'Turno no encontrado'; end if;
  if p_inicial is null or p_inicial < 0 then raise exception 'Lectura inicial no válida'; end if;
  v_fin := case when t.estado = 'cerrado' then coalesce(p_final, t.medidor_final) else null end;
  if v_fin is not null and v_fin < p_inicial then raise exception 'La lectura final no puede ser menor a la inicial'; end if;
  if (select texto from config where clave = 'medidor_unidad') = 'm3' then v_factor := 1000; end if;
  v_lm := case when v_fin is not null then (v_fin - p_inicial) * v_factor end;

  update turnos set
    medidor_inicial = p_inicial,
    medidor_final = coalesce(v_fin, medidor_final),
    litros_medidor = case when estado = 'cerrado' then v_lm else litros_medidor end,
    diferencia_litros = case when estado = 'cerrado' and v_lm is not null then v_lm - litros_vendidos else diferencia_litros end,
    notas_apertura = concat_ws(' · ', notas_apertura,
      format('Medidor corregido por %s el %s: inicial %s → %s%s. Motivo: %s',
        coalesce((select nombre from perfiles where id = auth.uid()), 'dueño'),
        to_char(now() at time zone 'America/Mexico_City', 'DD/MM HH24:MI'),
        t.medidor_inicial, p_inicial,
        case when t.estado = 'cerrado' and v_fin is distinct from t.medidor_final then format(', final %s → %s', t.medidor_final, v_fin) else '' end,
        p_motivo))
  where id = p_turno_id;
  return json_build_object('ok', true, 'medidor_inicial', p_inicial, 'medidor_final', v_fin, 'litros_medidor', v_lm);
end $$;
grant execute on function public.corregir_medidor to authenticated;

select 'Corregir medidor listo' as resultado;
