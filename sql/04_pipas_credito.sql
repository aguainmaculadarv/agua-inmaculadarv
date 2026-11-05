-- =====================================================================
-- AGUA INMACULADA · PIPAS A CRÉDITO Y ABONOS
-- Una pipa puede pagarse en el momento o quedar a crédito.
-- Cada pago es un abono; si sale del cajón del turno se registra como
-- pago con caja (afecta el corte). Si sale del sobre / del dueño, no.
-- Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.pipas add column if not exists credito boolean not null default false;

create table if not exists public.pipa_abonos (
  id bigint generated always as identity primary key,
  pipa_id bigint not null references public.pipas(id) on delete cascade,
  fecha timestamptz not null default now(),
  monto numeric not null check (monto > 0),
  origen text not null check (origen in ('caja','sobre')),
  gasto_id bigint references public.gastos(id) on delete set null,
  turno_id bigint references public.turnos(id),
  usuario_id uuid references public.perfiles(id) default auth.uid(),
  notas text
);

-- Registrar un abono (o el pago completo) de una pipa
create or replace function public.abonar_pipa(
  p_pipa_id bigint, p_monto numeric, p_origen text, p_turno_id bigint default null, p_notas text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_p pipas%rowtype; v_saldo numeric; v_gasto bigint; v_id bigint; t turnos%rowtype;
begin
  if mi_rol() is null then raise exception 'Usuario sin acceso'; end if;
  select * into v_p from pipas where id = p_pipa_id;
  if not found then raise exception 'Pipa no encontrada'; end if;
  if coalesce(p_monto, 0) <= 0 then raise exception 'Escribe el monto'; end if;
  select v_p.costo - coalesce(sum(monto), 0) into v_saldo from pipa_abonos where pipa_id = p_pipa_id;
  if p_monto > v_saldo + 0.009 then raise exception 'El abono es mayor a lo que se debe (%)', v_saldo; end if;
  if p_origen = 'caja' then
    select * into t from turnos where id = p_turno_id and estado = 'abierto';
    if not found then raise exception 'Para pagar del cajón necesitas un turno abierto'; end if;
    if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
    insert into gastos (categoria, descripcion, monto, proveedor, pagado_de_caja, turno_id, usuario_id)
    values ('insumo', 'Pago pipa #' || p_pipa_id, p_monto, v_p.proveedor, true, p_turno_id, auth.uid())
    returning id into v_gasto;
  elsif p_origen <> 'sobre' then raise exception 'Origen no válido';
  end if;
  insert into pipa_abonos (pipa_id, monto, origen, gasto_id, turno_id, usuario_id, notas)
  values (p_pipa_id, p_monto, p_origen, v_gasto, p_turno_id, auth.uid(), p_notas)
  returning id into v_id;
  return v_id;
end $$;

-- Lista de pipas a crédito con su saldo (la ven dueños y ventanilla)
create or replace function public.pipas_por_pagar()
returns table (id bigint, fecha timestamptz, litros numeric, costo numeric, proveedor text, notas text, pagado numeric, saldo numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if mi_rol() is null then raise exception 'Usuario sin acceso'; end if;
  return query
    select p.id, p.fecha, p.litros, p.costo, p.proveedor, p.notas,
           coalesce(sum(a.monto), 0), p.costo - coalesce(sum(a.monto), 0)
    from pipas p left join pipa_abonos a on a.pipa_id = p.id
    where p.credito
    group by p.id
    having p.costo - coalesce(sum(a.monto), 0) > 0.009
    order by p.fecha;
end $$;

grant execute on function public.abonar_pipa, public.pipas_por_pagar to authenticated;

alter table public.pipa_abonos enable row level security;
drop policy if exists pipa_abonos_ver on public.pipa_abonos;
drop policy if exists pipa_abonos_dueno on public.pipa_abonos;
create policy pipa_abonos_ver on public.pipa_abonos for select to authenticated using (usuario_id = auth.uid() or es_dueno());
create policy pipa_abonos_dueno on public.pipa_abonos for delete to authenticated using (es_dueno());
revoke all on public.pipa_abonos from anon;
