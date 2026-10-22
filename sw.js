/* AURA-X · abre la interfaz sin conexión. Red primero; la API de Supabase nunca se guarda. */
const CACHE = 'aura-x-v3';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'css/styles.css', 'icons/aura-mark.svg', 'icons/favicon-32.png',
  'js/core.js', 'js/supa.js', 'js/data.js', 'js/render.js', 'js/prompts.js', 'js/palette.js', 'js/app.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
