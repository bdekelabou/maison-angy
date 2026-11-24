// Maison Angy - Service Worker PWA
const CACHE_NAME = 'maison-angy-v9-no-admin';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/images/logo.jpg',
  '/images/banner.jpg',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Purge ALL old caches immediately
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // CRITICAL: NEVER intercept or cache /admin, /admin.html, or /api/
  const url = event.request.url || '';
  if (url.includes('/admin') || url.includes('/api/')) {
    return; // Pass through to network directly without touching CacheStorage!
  }

  if (event.request.method !== 'GET') return;

  // Network first for other assets
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
