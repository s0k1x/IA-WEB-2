/* AURA-X · service worker: abre la app sin conexión (solo la interfaz).
   Red primero para que las actualizaciones lleguen siempre; caché como respaldo.
   El trabajo en segundo plano ocurre en Supabase, no aquí. */
const CACHE = 'aura-x-shell-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/styles.css', 'css/components.css',
  'js/storage.js', 'js/store.js', 'js/conversations.js', 'js/projects.js', 'js/mcp.js', 'js/prompts.js', 'js/backup.js',
  'js/ui.js', 'js/render.js', 'js/api.js', 'js/palette.js', 'js/app.js',
  'icons/aura-mark.png', 'icons/aura-logo.webp', 'icons/favicon-32.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return; // la API de Supabase nunca se cachea
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
