-- =====================================================================
-- AGUA INMACULADA · REACTIVAR AGUA ALCALINA (24-nov-2026)
-- Vuelve a aceptar pedidos de alcalina en la liga de clientes y en la app.
-- =====================================================================
update public.productos set activo = true where nombre = 'Agua alcalina';

select nombre, activo, precio, precio_domicilio from productos where nombre = 'Agua alcalina';
