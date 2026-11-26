-- =====================================================================
-- AGUA INMACULADA · IVA DEL RELLENO 5 L (25-nov-2026)
-- El agua en envases menores de 10 litros causa IVA 16% (en garrafón es tasa 0%).
-- Corrige el producto y las ventas que ya se hicieron con él.
-- =====================================================================
update public.productos set iva_tasa = 0.16 where nombre = 'Relleno 5 L';
update public.venta_detalle set iva_tasa = 0.16
 where producto_id = (select id from productos where nombre = 'Relleno 5 L') and iva_tasa <> 0.16;

select nombre, precio, iva_tasa from productos where nombre = 'Relleno 5 L';
