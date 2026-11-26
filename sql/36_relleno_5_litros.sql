-- =====================================================================
-- AGUA INMACULADA · PRODUCTO RELLENO 5 L (25-nov-2026)
-- Relleno de bote de 5 litros a $10 en ventanilla. Consume 5.5 L del medidor
-- (misma merma que el garrafón). Se puede correr más de una vez sin problema.
-- =====================================================================
insert into public.productos (nombre, precio, precio_domicilio, litros_producto, litros_consumo, cuenta_garrafon, iva_tasa, orden, color, activo)
select 'Relleno 5 L', 10, null, 5, 5.5, false, 0,
       (select coalesce(max(orden), 0) + 1 from productos), '#1BA6C9', true
where not exists (select 1 from productos where nombre = 'Relleno 5 L');

select id, nombre, precio, litros_consumo, activo from productos where nombre = 'Relleno 5 L';
