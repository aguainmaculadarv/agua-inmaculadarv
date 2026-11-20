-- =====================================================================
-- AGUA INMACULADA · PAGO DE JAVIER: CONTAR DESDE EL LUNES 23-NOV (20-nov-2026)
-- Por decisión de Arqui, lo anterior al lunes 23-nov no se le cobra a Javier en caja.
-- Las entregas quedan registradas; solo cambia desde cuándo cuenta "Pagar en caja".
-- =====================================================================
insert into public.config (clave, texto, descripcion)
values ('javier_saldo_desde', '2026-11-23', 'Desde qué día se cuenta lo que Javier debe pagar en planta')
on conflict (clave) do update set texto = '2026-11-23';

select clave, texto from config where clave = 'javier_saldo_desde';
