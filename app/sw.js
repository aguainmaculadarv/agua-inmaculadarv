// Service worker mínimo: permite instalar la app. Siempre busca la versión más nueva en línea.
const CACHE = 'ai-v5';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// Notificación de pedido nuevo (llega aunque el teléfono esté bloqueado)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Nuevo pedido', {
    body: d.body || 'Revisa tus pedidos pendientes',
    icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'pedido', renotify: true,
    vibrate: [300, 150, 300, 150, 300], requireInteraction: true, data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) { w.navigate && w.navigate(e.notification.data.url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(e.notification.data.url);
  }));
});
