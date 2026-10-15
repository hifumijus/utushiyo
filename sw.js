// アプリ本体を端末にキャッシュし、電波がなくても起動できるようにする。
// 公開内容を変えたら CACHE_VERSION を上げると、古いキャッシュが入れ替わる。
const CACHE_VERSION = 'v4';
const CACHE = 'nagekomi-' + CACHE_VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('nagekomi-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュがあれば通信を待たずに返し、裏で最新版を取り直す(次回の起動から反映)
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API などには関与しない

  const isPage = req.mode === 'navigate';
  const key = isPage ? new Request('./index.html') : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    const refresh = fetch(isPage ? new Request('./index.html', { cache: 'no-cache' }) : req)
      .then(res => {
        if (res && res.ok) cache.put(key, res.clone());
        return res;
      });
    if (cached) {
      event.waitUntil(refresh.catch(() => {}));
      return cached;
    }
    try {
      return await refresh;
    } catch (e) {
      return new Response('オフラインのため読み込めませんでした', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
