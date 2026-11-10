-- =====================================================================
-- AGUA INMACULADA · CONFIRMAR PAGO POR TRANSFERENCIA (10-nov-2026)
-- La planta revisa en el banco que sí llegó la transferencia y toca "Pago recibido".
-- Javier ve el pedido como PAGADO al instante y no cobra.
-- Se puede correr más de una vez sin problema.
-- =====================================================================
alter table public.pedidos add column if not exists pago_confirmado_en timestamptz;
alter table public.pedidos add column if not exists pago_confirmado_por uuid references public.perfiles(id);

create or replace function public.confirmar_pago_pedido(p_pedido_id bigint, p_deshacer boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare v pedidos%rowtype;
begin
  if mi_rol() not in ('dueno','ventanilla') then raise exception 'Solo dueños o ventanilla confirman pagos'; end if;
  select * into v from pedidos where id = p_pedido_id;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v.estado = 'cancelado' then raise exception 'El pedido está cancelado'; end if;
  if p_deshacer then
    update pedidos set pago_confirmado_en = null, pago_confirmado_por = null where id = p_pedido_id;
  else
    update pedidos set pago_confirmado_en = now(), pago_confirmado_por = auth.uid(), forma_pago = 'transferencia' where id = p_pedido_id;
  end if;
end $$;
grant execute on function public.confirmar_pago_pedido to authenticated;

select 'Confirmación de pago lista' as resultado;
