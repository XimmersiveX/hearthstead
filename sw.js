// Hearthstead service worker: lets the game load offline.
// Network first: when online you always get the newest files (fetched past the HTTP cache),
// and each fresh copy is stored. The stored copy is used only when the network fails or stalls.
// Saves live in localStorage, which this worker never touches.
const CACHE = 'hearthstead-v2';
const CORE = [
  './', 'index.html', 'manifest.json',
  'css/style.css', 'css/look-table.css', 'css/themes.css',
  'js/data.js', 'js/install.js', 'js/sim.js', 'js/seasons.js', 'js/scene.js', 'js/ui.js', 'js/audio.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg',
];
const STALL_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('hearthstead-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(networkFirst(req, e));
});

async function networkFirst(req, e) {
  const cache = await caches.open(CACHE);
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok && res.type === 'basic') e.waitUntil(cache.put(req, res.clone()));
    return res;
  });
  const stall = new Promise(r => setTimeout(r, STALL_MS));
  try {
    const res = await Promise.race([net, stall.then(() => null)]);
    if (res) return res;
    const hit = await match(cache, req);
    return hit || await net;           // stalled and nothing stored: keep waiting
  } catch (err) {
    const hit = await match(cache, req);
    if (hit) return hit;
    throw err;
  }
}

async function match(cache, req) {
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') return cache.match('./') || cache.match('index.html');
  return null;
}
