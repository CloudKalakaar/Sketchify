const CACHE_NAME = 'sketchify-v7';

const STATIC_ASSETS = [
  '/Sketchify/',
  '/Sketchify/index.html',
  '/Sketchify/css/style.css',
  '/Sketchify/js/app.js',
  '/Sketchify/js/camera.js',
  '/Sketchify/js/paper-mode.js',
  '/Sketchify/js/wall-mode.js',
  '/Sketchify/js/sw-register.js',
  '/Sketchify/icons/icon-192.png',
  '/Sketchify/icons/icon-512.png',
  '/Sketchify/assets/logo.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => {
      self.clients.claim();
      self.clients.matchAll().then(clients =>
        clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for HTML (gets updates); cache-first for everything else
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return resp;
        })
        .catch(() => caches.match(request))
    );
  } else {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      }))
    );
  }
});
