// Минимальный Service Worker: cache-first для оболочки приложения.
// Книги НЕ кэшируются тут — они лежат в IndexedDB.
// Версию меняй при выкатке, чтобы SW обновил кэш.
const CACHE_VERSION = 'mo38639e';
const CACHE_NAME = `reader-shell-${CACHE_VERSION}`;

// Список того, что хотим заранее положить в кэш.
// Реальные имена JS/CSS бандлов заранее не знаем (Vite даёт хэши),
// поэтому precache-им только базовое, а остальное добавляем при первом запросе.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll упадёт если хоть один ресурс 404, поэтому используем allSettled-обёртку
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('reader-shell-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Кросс-оригинальные запросы не трогаем.
  if (url.origin !== self.location.origin) return;

  // === Network-first для HTML/навигации ===
  // Критично: HTML всегда получаем свежий с сервера (если есть сеть).
  // Это гарантирует что обновлённый index.html со ссылками на новые JS-хэши
  // всегда доходит до пользователя. Кэш используется ТОЛЬКО офлайн.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }

  // === Cache-first для остального ===
  // JS/CSS/иконки имеют хэши в именах → стабильны → кэшируем навсегда.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});

// Позволяет странице попросить SW сразу активироваться при обновлении.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
