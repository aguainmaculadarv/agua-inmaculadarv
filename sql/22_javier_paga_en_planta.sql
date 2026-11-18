-- =====================================================================
-- AGUA INMACULADA · JAVIER PAGA EN PLANTA LO DE DOMICILIO (17-nov-2026)
-- Javier entrega y cobra; al regresar, Yara/Norma le registran en ventanilla lo
-- cobrado (efectivo y transferencias) al cliente "Javier (reparto)".
--  1) Ventas a clientes tipo repartidor quedan marcadas canal 'repartidor'.
--  2) El cierre de planta ya NO suma aparte los pedidos de domicilio (el agua
--     ya se cuenta en la venta a Javier; así no se duplica).
--  3) El cierre de moto descuenta solo lo que Javier pagó en efectivo en planta.
--  4) Se da de alta el cliente "Javier (reparto)" (precio a domicilio, sin especial).
-- Se puede correr más de una vez sin problema.
-- =====================================================================

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
  v_esp numeric;
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
  values (p_turno_id, auth.uid(), p_cliente_id,
          case when v_cli.id is not null and v_cli.tipo = 'distribuidor' then 'repartidor' else coalesce(p_canal,'planta') end,
          p_forma_pago)
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
    -- Precio especial por cliente en cualquier producto (tabla cliente_precios): manda sobre todo lo anterior
    if v_cli.id is not null then
      v_esp := null;
      select precio into v_esp from cliente_precios where cliente_id = v_cli.id and producto_id = v_prod.id;
      if v_esp is not null then v_precio := v_esp; end if;
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
grant execute on function public.registrar_venta to authenticated;

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

  -- garrafones cargados a la camioneta durante este turno de planta también salen del medidor
  if t.tipo = 'planta' then
    select v_litros_vend + coalesce(sum(c.garrafones), 0) * 20 into v_litros_vend
    from cargas c join turnos tt on tt.id = c.turno_id
    where tt.tipo = 'camioneta' and c.fecha >= t.abierto_en and c.fecha <= now();
  end if;
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
    select coalesce(sum(llenos + nuevos), 0), coalesce(sum(vacios), 0) into v_entregados, v_vacios from entregas where turno_id = p_turno_id;
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
    -- lo que Javier ya pagó EN EFECTIVO en ventanilla durante su turno (las transferencias no traen efectivo)
    select coalesce(sum(v.total), 0) into v_pagado from ventas v
      where v.canal = 'repartidor' and v.forma_pago = 'efectivo' and not v.cancelada and v.fecha >= t.abierto_en and v.fecha <= now();
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

insert into clientes (tipo, nombre, activo)
select 'distribuidor', 'Javier (reparto)', true
where not exists (select 1 from clientes where nombre = 'Javier (reparto)');
update clientes set activo = true, tipo = 'distribuidor', precio_especial = null where nombre = 'Javier (reparto)';
delete from cliente_precios where cliente_id = (select id from clientes where nombre = 'Javier (reparto)');

-- ventas ya hechas a repartidores: marcarlas para la comparativa
update ventas v set canal = 'repartidor' from clientes c
 where c.id = v.cliente_id and c.tipo = 'distribuidor' and v.canal <> 'repartidor';

select 'Javier paga en planta: listo' as resultado;
-- (reenviado el 17-nov para aplicarlo; el primer intento se canceló en la fila)
