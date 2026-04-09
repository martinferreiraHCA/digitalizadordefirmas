/**
 * Service Worker — Escáner de Firmas
 * Caches app shell and CDN dependencies for offline use.
 */
const CACHE_NAME = 'firma-scanner-v2';

const APP_SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/config.js',
  'js/utils.js',
  'js/cedula.js',
  'js/pipeline.js',
  'js/history.js',
  'js/app.js',
  'js/worker.js',
  'manifest.json',
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,500;9..40,700&family=JetBrains+Mono:wght@400;600&display=swap',
];

// Install: cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL).catch(() => {
        // Cache what we can, ignore failures for individual files
        return Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for CDN
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // OpenCV.js: network-first (large file, cache after first load)
  if (url.includes('opencv.js')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // CDN assets: stale-while-revalidate
  if (url.startsWith('https://cdnjs.') || url.startsWith('https://fonts.g')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Google Fonts CSS may redirect to font files
  if (url.startsWith('https://fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // App shell: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
