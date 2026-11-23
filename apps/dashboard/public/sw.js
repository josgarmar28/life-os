// Service worker mínimo: guarda la "carcasa" de la app para abrirla sin conexión y muestra los avisos.
// NUNCA guarda respuestas de Supabase (datos personales siempre frescos y fuera de la caché).
const CACHE = 'lifeos-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Red primero; sin red, la app en caché (la cola de registros se envía al volver la conexión).
    // La carcasa se actualiza en cada visita con red, para que sin red se abra la última versión.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Los recursos llevan hash en el nombre: caché primero.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
  }
});

// Avisos (web push): cada aviso que llega se muestra siempre (iOS retira el permiso si no).
self.addEventListener('push', (event) => {
  let m = { title: 'LIFE OS', body: '', url: '/' };
  try { m = { ...m, ...event.data.json() }; } catch { /* aviso sin datos: se muestra el genérico */ }
  event.waitUntil(self.registration.showNotification(m.title, {
    body: m.body, tag: m.tag, renotify: Boolean(m.tag), icon: '/icon-512.png', badge: '/icon-512.png', data: { url: m.url },
  }));
});

// Al tocar el aviso: abre (o enfoca) la app en la pantalla del aviso.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : w));
    }
    return self.clients.openWindow(url);
  }));
});
