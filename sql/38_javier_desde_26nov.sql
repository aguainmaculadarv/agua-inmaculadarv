-- =====================================================================
-- AGUA INMACULADA · PAGO DE JAVIER: CONTAR DESDE EL JUEVES 26-NOV (26-nov-2026)
-- El 25-nov se cobró con el método anterior; por decisión de Arqui se empieza
-- de nuevo hoy. No se borra nada: entregas y ventas quedan igual.
-- =====================================================================
insert into public.config (clave, texto, descripcion)
values ('javier_saldo_desde', '2026-11-26', 'Desde qué día se cuenta lo que Javier debe pagar en planta')
on conflict (clave) do update set texto = '2026-11-26';

select clave, texto from config where clave = 'javier_saldo_desde';
