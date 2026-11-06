-- =====================================================================
-- AGUA INMACULADA · FIRMA EN VENTAS A CRÉDITO DE VENTANILLA (05-nov-2026)
-- Cuando una empresa recoge en planta a crédito, quien recoge escribe su nombre
-- y firma en la pantalla. La firma queda ligada a la venta (ticket) y sale en
-- la nota digital y en el estado de cuenta mensual.
-- Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.ventas add column if not exists recibio text;
alter table public.ventas add column if not exists firma text;

create or replace function public.firmar_venta(p_venta_id bigint, p_recibio text, p_firma text)
returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype;
begin
  if mi_rol() is null then raise exception 'Usuario sin acceso'; end if;
  select * into v from ventas where id = p_venta_id;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.usuario_id <> auth.uid() and not es_dueno() then raise exception 'La venta no es tuya'; end if;
  if v.forma_pago <> 'credito' then raise exception 'Solo las ventas a crédito llevan firma'; end if;
  if v.firma is not null and not es_dueno() then raise exception 'Esta venta ya está firmada'; end if;
  if coalesce(trim(p_recibio), '') = '' then raise exception 'Escribe el nombre de quien recoge'; end if;
  if coalesce(p_firma, '') = '' then raise exception 'Falta la firma'; end if;
  update ventas set recibio = left(trim(p_recibio), 120), firma = p_firma where id = p_venta_id;
end $$;
grant execute on function public.firmar_venta to authenticated;

select 'Firma en ventas a crédito lista' as resultado;
