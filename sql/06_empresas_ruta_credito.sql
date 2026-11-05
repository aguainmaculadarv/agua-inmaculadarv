-- =====================================================================
-- AGUA INMACULADA · RUTA DE EMPRESAS, CRÉDITO Y CUENTAS POR COBRAR
-- 1) Datos de ruta por cliente: días de entrega, días de crédito, contacto.
-- 2) La entrega a empresa se cobra de contado o queda a crédito según el cliente.
-- 3) Pagos de clientes (cobros) y cuentas por cobrar con vencidos.
-- 4) Carga el catálogo de empresas que mandó Arqui (05-nov-2026).
-- Se puede correr más de una vez sin problema.
-- =====================================================================

-- ---------- 1) columnas nuevas en clientes ----------
alter table public.clientes add column if not exists dias_entrega text[];          -- {lun,mar,mie,jue,vie,sab,dom}
alter table public.clientes add column if not exists dias_credito int;            -- 0 = contado; null = crédito sin plazo definido
alter table public.clientes add column if not exists forma_pago_habitual text;    -- efectivo / transferencia
alter table public.clientes add column if not exists contacto text;
alter table public.clientes add column if not exists quien_recibe text;

-- ---------- 3) pagos que hacen los clientes a crédito ----------
create table if not exists public.cobros (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  cliente_id bigint not null references public.clientes(id),
  monto numeric not null check (monto > 0),
  forma_pago text not null check (forma_pago in ('efectivo','transferencia')),
  notas text,
  usuario_id uuid references public.perfiles(id) default auth.uid()
);
alter table public.cobros enable row level security;
drop policy if exists cobros_dueno on public.cobros;
create policy cobros_dueno on public.cobros for all to authenticated using (es_dueno()) with check (es_dueno());
revoke all on public.cobros from anon;

-- ---------- 2) entrega a empresa: contado o crédito ----------
drop function if exists public.registrar_entrega_empresa(bigint, bigint, int, int, text, text, text);
create or replace function public.registrar_entrega_empresa(
  p_turno_id bigint, p_cliente_id bigint, p_llenos int, p_vacios int,
  p_recibio text, p_firma text, p_notas text default null, p_forma_pago text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_t turnos%rowtype; v_c clientes%rowtype; v_venta bigint; v_prod bigint; v_id bigint; v_fp text;
begin
  select * into v_t from turnos where id = p_turno_id;
  if not found or v_t.estado <> 'abierto' then raise exception 'El turno no está abierto'; end if;
  if v_t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
  select * into v_c from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente no válido'; end if;
  if coalesce(trim(p_recibio), '') = '' then raise exception 'Escribe el nombre de quien recibe'; end if;
  if p_firma is null then raise exception 'Falta la firma de recibido'; end if;
  if coalesce(p_llenos, 0) = 0 and coalesce(p_vacios, 0) = 0 then raise exception 'Escribe cuántos garrafones entregas o recoges'; end if;
  -- crédito si el cliente tiene días de crédito (o no tiene plazo definido); si es de contado, se cobra en la entrega
  v_fp := coalesce(p_forma_pago, case when v_c.dias_credito is null or v_c.dias_credito > 0 then 'credito'
                                      else coalesce(v_c.forma_pago_habitual, 'efectivo') end);
  if v_fp not in ('efectivo','transferencia','credito') then raise exception 'Forma de pago no válida'; end if;
  if coalesce(p_llenos, 0) > 0 then
    select id into v_prod from productos where nombre = 'Relleno garrafón';
    v_venta := registrar_venta(p_turno_id, v_fp, jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', p_llenos)), p_cliente_id, 'empresa');
  end if;
  insert into entregas (turno_id, cliente_id, llenos, vacios, recibio, firma, venta_id, notas, usuario_id)
  values (p_turno_id, p_cliente_id, coalesce(p_llenos, 0), coalesce(p_vacios, 0), p_recibio, p_firma, v_venta, p_notas, auth.uid())
  returning id into v_id;
  update clientes set garrafones_prestados = garrafones_prestados + coalesce(p_llenos, 0) - coalesce(p_vacios, 0) where id = p_cliente_id;
  return v_id;
end $$;

-- cierre de camioneta: ahora cuenta el efectivo cobrado a empresas de contado
create or replace function public.cerrar_turno_reparto(
  p_turno_id bigint, p_regreso_llenos int, p_regreso_vacios int,
  p_efectivo_contado numeric, p_notas text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  t turnos%rowtype;
  v_cargados int; v_entregados int := 0; v_vacios int := 0;
  v_ef numeric := 0; v_tr numeric := 0; v_pagado numeric := 0; v_esperado numeric; v_pend int := 0;
  v_dif_llenos int; v_dif_vacios int;
begin
  select * into t from turnos where id = p_turno_id;
  if not found or t.estado <> 'abierto' or t.tipo not in ('camioneta','moto') then raise exception 'El turno de reparto no está abierto'; end if;
  if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;

  select coalesce(sum(garrafones), 0) into v_cargados from cargas where turno_id = p_turno_id;

  if t.tipo = 'camioneta' then
    select coalesce(sum(llenos), 0), coalesce(sum(vacios), 0) into v_entregados, v_vacios from entregas where turno_id = p_turno_id;
    v_dif_vacios := coalesce(p_regreso_vacios, 0) - v_vacios;
    -- empresas de contado: lo que cobró en efectivo lo trae él
    select coalesce(sum(total) filter (where forma_pago = 'efectivo'), 0),
           coalesce(sum(total) filter (where forma_pago = 'transferencia'), 0)
      into v_ef, v_tr from ventas where turno_id = p_turno_id and canal = 'empresa' and not cancelada;
    v_esperado := t.caja_inicial + v_ef;
  else
    select coalesce(sum(entregado_cantidad), 0),
           coalesce(sum(monto_cobrado) filter (where forma_pago_real = 'efectivo'), 0),
           coalesce(sum(monto_cobrado) filter (where forma_pago_real = 'transferencia'), 0)
      into v_entregados, v_ef, v_tr
    from pedidos where turno_id = p_turno_id and estado = 'entregado';
    select coalesce(sum(v.total), 0) into v_pagado from ventas v
      where v.canal = 'repartidor' and not v.cancelada and v.fecha >= t.abierto_en and v.fecha <= now();
    select count(*) into v_pend from pedidos where estado = 'pendiente' and creado_en <= now();
    v_esperado := t.caja_inicial + v_ef - v_pagado;
  end if;
  v_dif_llenos := coalesce(p_regreso_llenos, 0) - (v_cargados - v_entregados);

  update turnos set cerrado_en = now(), estado = 'cerrado',
    regreso_llenos = p_regreso_llenos, regreso_vacios = p_regreso_vacios,
    entregados = v_entregados, vacios_recogidos = v_vacios,
    diferencia_llenos = v_dif_llenos, diferencia_vacios = v_dif_vacios,
    cobrado_efectivo = v_ef, cobrado_transferencia = v_tr, pagado_ventanilla = v_pagado,
    efectivo_contado = p_efectivo_contado, efectivo_esperado = v_esperado,
    diferencia_caja = p_efectivo_contado - v_esperado, pedidos_pendientes = v_pend,
    garrafones_vendidos = v_entregados, notas_cierre = p_notas
  where id = p_turno_id;

  return json_build_object('tipo', t.tipo, 'cargados', v_cargados, 'entregados', v_entregados,
    'regreso_llenos', p_regreso_llenos, 'diferencia_llenos', v_dif_llenos,
    'vacios_recogidos', v_vacios, 'regreso_vacios', p_regreso_vacios, 'diferencia_vacios', v_dif_vacios,
    'cobrado_efectivo', v_ef, 'cobrado_transferencia', v_tr, 'pagado_ventanilla', v_pagado,
    'caja_inicial', t.caja_inicial, 'efectivo_esperado', v_esperado, 'efectivo_contado', p_efectivo_contado,
    'diferencia_caja', p_efectivo_contado - v_esperado, 'pedidos_pendientes', v_pend);
end $$;

-- ---------- 3) cuentas por cobrar (los pagos se aplican a las ventas más viejas) ----------
create or replace function public.cuentas_por_cobrar()
returns table (cliente_id bigint, nombre text, telefono text, contacto text, dias_credito int,
               total_credito numeric, pagado numeric, saldo numeric, vencido numeric,
               pendiente_desde timestamptz, dias_vencido int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_dueno() then raise exception 'Solo dueños'; end if;
  return query
  with v as (
    select ve.cliente_id, ve.id, ve.fecha, ve.total,
           sum(ve.total) over (partition by ve.cliente_id order by ve.fecha, ve.id) as acum
    from ventas ve where ve.forma_pago = 'credito' and not ve.cancelada and ve.cliente_id is not null),
  c as (select co.cliente_id, sum(co.monto) as pagado from cobros co group by co.cliente_id),
  p as (
    select v.*, coalesce(c.pagado, 0) as pag,
           least(v.total, greatest(0, v.acum - coalesce(c.pagado, 0))) as pend
    from v left join c on c.cliente_id = v.cliente_id)
  select cl.id, cl.nombre, cl.telefono, cl.contacto, cl.dias_credito,
         sum(p.total), max(p.pag), sum(p.pend),
         coalesce(sum(p.pend) filter (where p.fecha + make_interval(days => coalesce(cl.dias_credito, 30)) < now()), 0),
         min(p.fecha) filter (where p.pend > 0),
         greatest(0, floor(extract(epoch from now() - (min(p.fecha) filter (where p.pend > 0) + make_interval(days => coalesce(cl.dias_credito, 30)))) / 86400))::int
  from p join clientes cl on cl.id = p.cliente_id
  group by cl.id
  having sum(p.pend) > 0.009
  order by 9 desc, 8 desc;
end $$;
grant execute on function public.registrar_entrega_empresa, public.cuentas_por_cobrar, public.cerrar_turno_reparto to authenticated;

-- ---------- 4) catálogo de empresas (05-nov-2026) ----------
-- Actualiza las que ya existen (por nombre, sin importar mayúsculas) y da de alta las nuevas.
do $$
declare r record; v_id bigint;
begin
  for r in select * from (values
  ('Construcciones Espinosa', null, 'A', 30, 'https://maps.app.goo.gl/ZTWx47WtfzVBUuATA', 'Ing. Sthepanie', array['lun','mie','vie']::text[], 'Estephanie', '9711071430', 'transferencia', 7, 'A veces ellos van a la planta a rellenar'),
  ('GC Remodelaciones', null, 'A', 30, 'https://maps.app.goo.gl/qiZSKXPt3jew1zvS7', 'Liz', array['mie']::text[], 'Eder', '3324971024', 'transferencia', 7, null),
  ('Henko', null, 'A', 35, 'https://maps.app.goo.gl/Awjn7NaVHsTJKFJA7', 'Encargado', array['vie']::text[], 'Daniela', '3319706298', 'transferencia', 7, null),
  ('Aduanas Prense', null, 'A', 35, 'https://maps.app.goo.gl/M7HX5iy9NzL4W3zF7', 'Gerardo', array['mar']::text[], 'Gerardo', '3316689490', 'transferencia', 7, null),
  ('Adualink', null, 'A', 35, 'https://maps.app.goo.gl/M7HX5iy9NzL4W3zF7', 'Gerardo', array['mar']::text[], 'Gerardo', '3315852679', 'transferencia', 7, null),
  ('Intraurbana El Tapatío', null, 'A', 35, 'https://maps.app.goo.gl/BS5cWG6Bn4WeQe2a8', 'Fernando', array['vie']::text[], 'Fernando', '3329088795', 'transferencia', 7, null),
  ('Torvi', 'Torbi', 'A', 35, 'https://maps.app.goo.gl/HZMA6mpiPCNpeuk8A', 'Berenice', array['mar']::text[], 'Berenice', '3338065420', 'transferencia', 7, null),
  ('Maquito', null, 'A', 33, 'https://maps.app.goo.gl/cAemrdjBawoS6ZHw5', 'Carmen', array['jue']::text[], 'Carmen', '3318233364', 'transferencia', 7, null),
  ('El Pechugón', null, 'A', 30, 'https://maps.app.goo.gl/1LM92qxyQZg14TtR6', 'Felix', array['mie']::text[], 'Felix', '3337227939', 'efectivo', 0, null),
  ('ISSIC', null, 'A', 35, 'https://maps.app.goo.gl/HZMA6mpiPCNpeuk8A', 'Sujey', array['mar']::text[], 'Sujey', '3317394581', 'transferencia', 7, null),
  ('Recinto San Javier', null, 'B', 35, 'https://maps.app.goo.gl/kDUsKC2BEFgGexLe8', 'Encargado', array['vie']::text[], 'Eduardo', '3317586747', 'transferencia', 7, null),
  ('Comedor Copachisa', 'Copa Chiza', 'B', 25, 'https://maps.app.goo.gl/BfRk1nkEdT7UBV8Y9', 'Bigotes', array['lun','jue']::text[], 'Bigotes', '4721598486', 'efectivo', 0, null),
  ('MT Galván', null, 'B', 35, 'https://maps.app.goo.gl/BfRk1nkEdT7UBV8Y9', 'Eder', array['lun','jue']::text[], 'Eder', '3312917418', 'transferencia', 7, null),
  ('Indecopisos', null, 'B', 35, 'https://maps.app.goo.gl/BfRk1nkEdT7UBV8Y9', 'Melanny Alisson', array['lun','jue']::text[], 'Melanny Alisson', '5510629122', 'transferencia', 7, null),
  ('Constructora GOC', null, 'B', 30, 'https://maps.app.goo.gl/7Zsr5Vh5qpBkWdNf9', 'Adan', array['lun','mie','vie']::text[], 'Adan', '3331307953', 'transferencia', 7, null),
  ('Chicken Crunch', null, 'C', 35, 'https://maps.app.goo.gl/U3aLUToMGUDyZXKX8', 'Jessica', array['sab']::text[], 'Jessica', '3333029488', 'efectivo', 0, 'Varía el día'),
  ('Tortillas de Harina', null, null, 25, 'https://maps.app.goo.gl/dJCzUtjAfyi4WnFk9', 'Encargado', array['vie']::text[], null, null, 'efectivo', 0, null)
  ) as x(nombre, alias, zona, precio, maps, quien, dias, contacto, tel, forma, credito, notas) loop
    select id into v_id from clientes
     where lower(trim(nombre)) in (lower(r.nombre), lower(coalesce(r.alias, r.nombre))) order by id limit 1;
    if v_id is null then
      insert into clientes (tipo, nombre, zona, precio_especial, maps_url, quien_recibe, dias_entrega, contacto, telefono, forma_pago_habitual, dias_credito, notas)
      values ('empresa', r.nombre, r.zona, r.precio, r.maps, r.quien, r.dias, r.contacto, r.tel, r.forma, r.credito, r.notas);
    else
      update clientes set nombre = r.nombre, zona = r.zona, precio_especial = r.precio, maps_url = r.maps, quien_recibe = r.quien,
        dias_entrega = r.dias, contacto = r.contacto, telefono = r.tel, forma_pago_habitual = r.forma, dias_credito = r.credito,
        notas = coalesce(r.notas, notas), activo = true,
        tipo = case when tipo in ('domicilio','distribuidor') then 'empresa' else tipo end
      where id = v_id;
    end if;
  end loop;
end $$;

-- Revisión: así quedaron las empresas
select nombre, zona, precio_especial as precio, dias_entrega, dias_credito, forma_pago_habitual as pago, telefono
from clientes where dias_entrega is not null order by zona nulls last, nombre;
