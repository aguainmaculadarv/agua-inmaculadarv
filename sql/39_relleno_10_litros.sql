-- =====================================================================
-- AGUA INMACULADA · PRODUCTO RELLENO 10 L (26-nov-2026)
-- Relleno de garrafón de 10 litros a $15 en ventanilla. Consume 11 L del medidor
-- (misma merma que el garrafón). IVA tasa 0%: el 16% aplica solo a envases
-- MENORES de 10 litros. Se puede correr más de una vez sin problema.
-- =====================================================================
insert into public.productos (nombre, precio, precio_domicilio, litros_producto, litros_consumo, cuenta_garrafon, iva_tasa, orden, color, activo)
select 'Relleno 10 L', 15, null, 10, 11, false, 0,
       (select coalesce(max(orden), 0) + 1 from productos), '#1BA6C9', true
where not exists (select 1 from productos where nombre = 'Relleno 10 L');

select id, nombre, precio, litros_consumo, iva_tasa, activo from productos where nombre = 'Relleno 10 L';
