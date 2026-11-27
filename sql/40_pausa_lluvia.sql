-- =====================================================================
-- AGUA INMACULADA · PAUSA DE PEDIDOS A DOMICILIO POR LLUVIA (27-nov-2026)
-- Pausa hasta nuevo aviso. Para reactivar: Pedidos → "Reactivar pedidos".
-- =====================================================================
update public.config set texto = 'siempre' where clave = 'pausa_pedidos';
update public.config set texto = 'Por la lluvia, hoy suspendimos el servicio a domicilio. Te esperamos en planta; reactivamos pronto.'
 where clave = 'pausa_pedidos_aviso';

select clave, texto from config where clave in ('pausa_pedidos','pausa_pedidos_aviso');
