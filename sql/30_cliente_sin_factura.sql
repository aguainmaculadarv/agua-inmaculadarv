-- =====================================================================
-- AGUA INMACULADA · EMPRESAS QUE NO SE FACTURAN (21-nov-2026)
-- Marca por cliente si se le factura. Las que no, salen de la lista del
-- Contador y sus ventas cuentan en la factura global (público en general).
-- Se puede correr más de una vez sin problema.
-- =====================================================================
alter table public.clientes add column if not exists requiere_factura boolean not null default true;

select 'Facturar sí/no listo' as resultado;
