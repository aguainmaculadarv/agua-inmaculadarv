-- =====================================================================
-- AGUA INMACULADA · PAGO DE JAVIER: CONTAR DESDE EL MIÉRCOLES 25-NOV (24-nov-2026)
-- Del 23 y 24-nov se cobró con el método anterior; por decisión de Arqui se
-- empieza de nuevo el 25-nov. No se borra nada: entregas y ventas quedan igual.
-- =====================================================================
insert into public.config (clave, texto, descripcion)
values ('javier_saldo_desde', '2026-11-25', 'Desde qué día se cuenta lo que Javier debe pagar en planta')
on conflict (clave) do update set texto = '2026-11-25';

select clave, texto from config where clave = 'javier_saldo_desde';
