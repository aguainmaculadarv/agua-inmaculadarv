-- =====================================================================
-- AGUA INMACULADA · FUNCIONES, SEGURIDAD (RLS) Y ALMACENAMIENTO
-- Ejecutar después de 01_esquema.sql
-- =====================================================================

-- ---------- ABRIR TURNO ----------
create or replace function public.abrir_turno(
  p_tipo text, p_caja_inicial numeric, p_caja_ok boolean,
  p_medidor_ini numeric, p_garrafones_ini int,
  p_foto text default null, p_notas text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if mi_rol() is null then raise exception 'Usuario sin acceso'; end if;
  if exists (select 1 from turnos where usuario_id = auth.uid() and estado = 'abierto') then
    raise exception 'Ya tienes un turno abierto';
  end if;
  insert into turnos (usuario_id, tipo, caja_inicial, caja_inicial_ok, medidor_inicial,
                      garrafones_nuevos_ini, foto_medidor_ini, notas_apertura)
  values (auth.uid(), coalesce(p_tipo,'planta'), p_caja_inicial, coalesce(p_caja_ok,true),
          p_medidor_ini, p_garrafones_ini, p_foto, p_notas)
  returning id into v_id;
  return v_id;
end $$;

-- ---------- REGISTRAR VENTA (el precio lo pone el sistema, no el usuario) ----------
create or replace function public.registrar_venta(
  p_turno_id bigint, p_forma_pago text, p_items jsonb,
  p_cliente_id bigint default null, p_canal text default 'planta'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_turno turnos%rowtype;
  v_venta bigint;
  v_item jsonb;
  v_prod productos%rowtype;
  v_cli clientes%rowtype;
  v_precio numeric;
  v_cant numeric;
  v_total numeric := 0;
  v_det bigint;
begin
  select * into v_turno from turnos where id = p_turno_id;
  if not found or v_turno.estado <> 'abierto' then raise exception 'El turno no está abierto'; end if;
  if v_turno.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;
  if p_forma_pago not in ('efectivo','transferencia','credito') then raise exception 'Forma de pago no válida'; end if;
  if p_forma_pago = 'credito' and p_cliente_id is null then raise exception 'Una venta a crédito necesita cliente'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'La venta no tiene productos'; end if;

  if p_cliente_id is not null then
    select * into v_cli from clientes where id = p_cliente_id and activo;
  end if;

  insert into ventas (turno_id, usuario_id, cliente_id, canal, forma_pago)
  values (p_turno_id, auth.uid(), p_cliente_id, coalesce(p_canal,'planta'), p_forma_pago)
  returning id into v_venta;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad no válida'; end if;
    select * into v_prod from productos where id = (v_item->>'producto_id')::bigint and activo;
    if not found then raise exception 'Producto no válido'; end if;

    v_precio := case when p_canal = 'domicilio' then coalesce(v_prod.precio_domicilio, v_prod.precio)
                     else v_prod.precio end;
    -- Repartidor (cliente tipo distribuidor): paga en planta el precio a domicilio de cada producto
    if v_cli.id is not null and v_cli.tipo = 'distribuidor' then
      v_precio := coalesce(v_prod.precio_domicilio, v_prod.precio);
    end if;
    -- Precio especial por cliente (empresas y repartidores) en el relleno
    if v_cli.id is not null and v_cli.precio_especial is not null and v_prod.nombre = 'Relleno garrafón' then
      v_precio := v_cli.precio_especial;
    end if;

    insert into venta_detalle (venta_id, producto_id, cantidad, precio_unitario, importe,
                               litros_producto, litros_consumo, iva_tasa)
    values (v_venta, v_prod.id, v_cant, v_precio, v_precio * v_cant,
            v_prod.litros_producto * v_cant, v_prod.litros_consumo * v_cant, v_prod.iva_tasa)
    returning id into v_det;

    insert into movimientos (articulo_id, tipo, cantidad, motivo, venta_id, turno_id, usuario_id)
    select pi.articulo_id, 'salida', pi.cantidad * v_cant, 'Venta ' || v_prod.nombre, v_venta, p_turno_id, auth.uid()
    from producto_insumos pi where pi.producto_id = v_prod.id;

    v_total := v_total + v_precio * v_cant;
  end loop;

  update ventas set total = v_total where id = v_venta;
  return v_venta;
end $$;

-- ---------- CANCELAR VENTA (solo dueño) ----------
create or replace function public.cancelar_venta(p_venta_id bigint, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_dueno() then raise exception 'Solo el dueño puede cancelar ventas'; end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Escribe el motivo de la cancelación'; end if;
  update ventas set cancelada = true, cancelada_por = auth.uid(), cancelada_en = now(),
                    motivo_cancelacion = p_motivo
  where id = p_venta_id and not cancelada;
  if not found then raise exception 'La venta no existe o ya estaba cancelada'; end if;
  insert into movimientos (articulo_id, tipo, cantidad, motivo, venta_id, turno_id, usuario_id)
  select articulo_id, 'entrada', cantidad, 'Cancelación venta #' || p_venta_id, venta_id, turno_id, auth.uid()
  from movimientos where venta_id = p_venta_id and tipo = 'salida';
end $$;

-- ---------- CERRAR TURNO Y ARQUEO ----------
create or replace function public.cerrar_turno(
  p_turno_id bigint, p_medidor_fin numeric, p_garrafones_fin int,
  p_efectivo_contado numeric, p_foto_medidor text default null,
  p_foto_caja text default null, p_notas text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  t turnos%rowtype;
  v_ef numeric; v_tr numeric; v_gastos numeric; v_esperado numeric;
  v_litros_vend numeric; v_litros_med numeric; v_factor numeric := 1;
  v_garr int; v_nuevos int; v_dif_nuevos int;
begin
  select * into t from turnos where id = p_turno_id;
  if not found or t.estado <> 'abierto' then raise exception 'El turno no está abierto'; end if;
  if t.usuario_id <> auth.uid() and not es_dueno() then raise exception 'El turno no es tuyo'; end if;

  select coalesce(sum(total) filter (where forma_pago='efectivo'),0),
         coalesce(sum(total) filter (where forma_pago='transferencia'),0)
    into v_ef, v_tr from ventas where turno_id = p_turno_id and not cancelada;

  select coalesce(sum(monto),0) into v_gastos from gastos where turno_id = p_turno_id and pagado_de_caja;

  select coalesce(sum(d.litros_producto),0),
         coalesce(sum(d.cantidad) filter (where p.cuenta_garrafon),0),
         coalesce(sum(d.cantidad) filter (where p.nombre = 'Garrafón nuevo'),0)
    into v_litros_vend, v_garr, v_nuevos
  from venta_detalle d join ventas v on v.id = d.venta_id join productos p on p.id = d.producto_id
  where v.turno_id = p_turno_id and not v.cancelada;

  if (select texto from config where clave='medidor_unidad') = 'm3' then v_factor := 1000; end if;
  v_litros_med := case when p_medidor_fin is not null and t.medidor_inicial is not null
                       then (p_medidor_fin - t.medidor_inicial) * v_factor end;
  v_esperado := t.caja_inicial + v_ef - v_gastos;
  v_dif_nuevos := case when t.garrafones_nuevos_ini is not null and p_garrafones_fin is not null
                       then p_garrafones_fin - (t.garrafones_nuevos_ini - v_nuevos) end;

  update turnos set
    cerrado_en = now(), estado = 'cerrado',
    medidor_final = p_medidor_fin, garrafones_nuevos_fin = p_garrafones_fin,
    foto_medidor_fin = p_foto_medidor, foto_caja_fin = p_foto_caja, notas_cierre = p_notas,
    efectivo_contado = p_efectivo_contado, efectivo_esperado = v_esperado,
    diferencia_caja = p_efectivo_contado - v_esperado,
    ventas_efectivo = v_ef, ventas_transferencia = v_tr, gastos_caja = v_gastos,
    litros_medidor = v_litros_med, litros_vendidos = v_litros_vend,
    diferencia_litros = v_litros_med - v_litros_vend,
    garrafones_vendidos = v_garr, garrafones_nuevos_vendidos = v_nuevos,
    diferencia_garrafones_nuevos = v_dif_nuevos
  where id = p_turno_id;

  return json_build_object(
    'efectivo_esperado', v_esperado, 'efectivo_contado', p_efectivo_contado,
    'diferencia_caja', p_efectivo_contado - v_esperado,
    'ventas_efectivo', v_ef, 'ventas_transferencia', v_tr, 'gastos_caja', v_gastos,
    'litros_medidor', v_litros_med, 'litros_vendidos', v_litros_vend,
    'diferencia_litros', v_litros_med - v_litros_vend,
    'garrafones_vendidos', v_garr, 'garrafones_nuevos_vendidos', v_nuevos,
    'diferencia_garrafones_nuevos', v_dif_nuevos);
end $$;

-- ---------- RESUMEN DE UN PERIODO (panel y contador) ----------
create or replace function public.resumen_periodo(p_desde date, p_hasta date)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini timestamptz := (p_desde::timestamp at time zone 'America/Mexico_City');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'America/Mexico_City');
  r json;
begin
  if not es_dueno() then raise exception 'Solo dueños'; end if;
  with v as (
    select * from ventas where fecha >= v_ini and fecha < v_fin and not cancelada
  ), d as (
    select d.*, p.nombre producto, p.cuenta_garrafon, v.forma_pago, v.cliente_id, v.facturada, v.fecha, v.canal
    from venta_detalle d join v on v.id = d.venta_id join productos p on p.id = d.producto_id
  )
  select json_build_object(
    'total', (select coalesce(sum(total),0) from v),
    'num_ventas', (select count(*) from v),
    'efectivo', (select coalesce(sum(total),0) from v where forma_pago='efectivo'),
    'transferencia', (select coalesce(sum(total),0) from v where forma_pago='transferencia'),
    'credito', (select coalesce(sum(total),0) from v where forma_pago='credito'),
    'garrafones', (select coalesce(sum(cantidad),0) from d where cuenta_garrafon),
    'litros_vendidos', (select coalesce(sum(litros_producto),0) from d),
    'litros_consumo', (select coalesce(sum(litros_consumo),0) from d),
    'por_producto', (select coalesce(json_agg(x order by x.importe desc),'[]') from (
        select producto, sum(cantidad) cantidad, sum(importe) importe from d group by producto) x),
    'por_dia', (select coalesce(json_agg(x order by x.dia),'[]') from (
        select (fecha at time zone 'America/Mexico_City')::date dia,
               sum(importe) importe,
               sum(cantidad) filter (where cuenta_garrafon) garrafones
        from d group by 1) x),
    'por_canal', (select coalesce(json_agg(x),'[]') from (
        select canal, sum(importe) importe, sum(cantidad) filter (where cuenta_garrafon) garrafones from d group by canal) x),
    'iva', (select coalesce(json_agg(x),'[]') from (
        select iva_tasa, sum(importe) importe,
               round(sum(importe) / (1 + iva_tasa), 2) base,
               round(sum(importe) - sum(importe) / (1 + iva_tasa), 2) iva
        from d group by iva_tasa) x),
    'publico_general', (select coalesce(json_agg(x),'[]') from (
        select iva_tasa, sum(importe) importe from d where cliente_id is null or not facturada group by iva_tasa) x),
    'por_cliente', (select coalesce(json_agg(x),'[]') from (
        select c.id, c.nombre, c.rfc, c.razon_social,
               sum(v.total) total,
               sum(v.total) filter (where not v.facturada) pendiente_facturar,
               sum(v.total) filter (where v.forma_pago = 'credito') a_credito
        from v join clientes c on c.id = v.cliente_id group by c.id) x),
    'pipas', (select json_build_object('num', count(*), 'litros', coalesce(sum(litros),0), 'costo', coalesce(sum(costo),0))
              from pipas where fecha >= v_ini and fecha < v_fin),
    'gastos', (select coalesce(json_agg(x),'[]') from (
        select categoria, sum(monto) monto, sum(monto) filter (where con_factura) con_factura
        from gastos where fecha >= v_ini and fecha < v_fin group by categoria) x),
    'turnos', (select coalesce(json_agg(x order by x.abierto_en desc),'[]') from (
        select t.id, p.nombre usuario, t.tipo, t.abierto_en, t.cerrado_en, t.estado,
               t.diferencia_caja, t.diferencia_litros, t.diferencia_garrafones_nuevos,
               t.garrafones_vendidos, t.ventas_efectivo, t.ventas_transferencia
        from turnos t join perfiles p on p.id = t.usuario_id
        where t.abierto_en >= v_ini and t.abierto_en < v_fin) x)
  ) into r;
  return r;
end $$;

grant execute on function public.abrir_turno, public.registrar_venta, public.cancelar_venta,
  public.cerrar_turno, public.resumen_periodo, public.mi_rol, public.es_dueno to authenticated;

-- =====================================================================
-- SEGURIDAD POR ROL (RLS)
-- =====================================================================
alter table public.perfiles enable row level security;
alter table public.config enable row level security;
alter table public.articulos enable row level security;
alter table public.productos enable row level security;
alter table public.producto_insumos enable row level security;
alter table public.clientes enable row level security;
alter table public.turnos enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_detalle enable row level security;
alter table public.pipas enable row level security;
alter table public.gastos enable row level security;
alter table public.movimientos enable row level security;
alter table public.gastos_fijos enable row level security;
alter table public.bitacora enable row level security;
alter table public.mantenimientos enable row level security;

-- Limpia políticas previas para poder re-ejecutar
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Perfiles
create policy perfiles_ver on public.perfiles for select to authenticated using (id = auth.uid() or es_dueno());
create policy perfiles_editar on public.perfiles for update to authenticated using (es_dueno()) with check (es_dueno());

-- Catálogos: todos leen, solo dueño escribe
create policy config_ver on public.config for select to authenticated using (true);
create policy config_dueno on public.config for all to authenticated using (es_dueno()) with check (es_dueno());
create policy articulos_ver on public.articulos for select to authenticated using (true);
create policy articulos_dueno on public.articulos for all to authenticated using (es_dueno()) with check (es_dueno());
create policy productos_ver on public.productos for select to authenticated using (true);
create policy productos_dueno on public.productos for all to authenticated using (es_dueno()) with check (es_dueno());
create policy pi_ver on public.producto_insumos for select to authenticated using (true);
create policy pi_dueno on public.producto_insumos for all to authenticated using (es_dueno()) with check (es_dueno());

-- Clientes: todos leen (para elegirlos), empleados pueden dar de alta, solo dueño edita
create policy clientes_ver on public.clientes for select to authenticated using (mi_rol() is not null);
create policy clientes_alta on public.clientes for insert to authenticated
  with check (mi_rol() is not null and (es_dueno() or precio_especial is null));
create policy clientes_editar on public.clientes for update to authenticated using (es_dueno()) with check (es_dueno());

-- Turnos: cada quien ve los suyos; dueño ve todo. Altas y cierres solo por función.
create policy turnos_ver on public.turnos for select to authenticated using (usuario_id = auth.uid() or es_dueno());

-- Ventas y detalle: solo lectura directa; altas por función
create policy ventas_ver on public.ventas for select to authenticated using (usuario_id = auth.uid() or es_dueno());
create policy ventas_facturar on public.ventas for update to authenticated using (es_dueno()) with check (es_dueno());
create policy detalle_ver on public.venta_detalle for select to authenticated
  using (exists (select 1 from public.ventas v where v.id = venta_id and (v.usuario_id = auth.uid() or es_dueno())));

-- Pipas, gastos y bitácora: empleado registra en su turno; dueño ve y corrige todo
create policy pipas_ver on public.pipas for select to authenticated using (usuario_id = auth.uid() or es_dueno());
create policy pipas_alta on public.pipas for insert to authenticated with check (usuario_id = auth.uid() and mi_rol() is not null);
create policy pipas_dueno on public.pipas for update to authenticated using (es_dueno()) with check (es_dueno());

create policy gastos_ver on public.gastos for select to authenticated using (usuario_id = auth.uid() or es_dueno());
create policy gastos_alta on public.gastos for insert to authenticated with check (usuario_id = auth.uid() and mi_rol() is not null);
create policy gastos_dueno on public.gastos for update to authenticated using (es_dueno()) with check (es_dueno());

create policy bitacora_ver on public.bitacora for select to authenticated using (usuario_id = auth.uid() or es_dueno());
create policy bitacora_alta on public.bitacora for insert to authenticated with check (usuario_id = auth.uid() and mi_rol() is not null);

-- Movimientos de inventario: empleados registran merma; dueño hace ajustes
create policy mov_ver on public.movimientos for select to authenticated using (es_dueno() or usuario_id = auth.uid());
create policy mov_alta on public.movimientos for insert to authenticated
  with check (usuario_id = auth.uid() and (es_dueno() or tipo in ('merma')));

-- Solo dueños
create policy gf_dueno on public.gastos_fijos for all to authenticated using (es_dueno()) with check (es_dueno());
create policy mant_ver on public.mantenimientos for select to authenticated using (mi_rol() is not null);
create policy mant_dueno on public.mantenimientos for all to authenticated using (es_dueno()) with check (es_dueno());

-- Nadie anónimo
revoke all on all tables in schema public from anon;

-- =====================================================================
-- ALMACENAMIENTO DE FOTOS Y CONSTANCIAS
-- =====================================================================
insert into storage.buckets (id, name, public) values ('evidencias','evidencias', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('fiscal','fiscal', false)
on conflict (id) do nothing;

drop policy if exists evid_subir on storage.objects;
drop policy if exists evid_ver on storage.objects;
drop policy if exists fiscal_dueno on storage.objects;

create policy evid_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'evidencias' and public.mi_rol() is not null);
create policy evid_ver on storage.objects for select to authenticated
  using (bucket_id = 'evidencias' and (owner = auth.uid() or public.es_dueno()));
create policy fiscal_dueno on storage.objects for all to authenticated
  using (bucket_id = 'fiscal' and public.es_dueno()) with check (bucket_id = 'fiscal' and public.es_dueno());
