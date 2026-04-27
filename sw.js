const CACHE_NAME = 'elms-cache-v5';
const urlsToCache = [
  '/',
  '/index.html',
  '/student-dashboard.html',
  '/teacher-dashboard.html',
  '/admin-dashboard.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/student.js',
  '/js/teacher.js',
  '/js/admin.js',
  '/js/firebase-config.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

// Install Event: Cache files
self.addEventListener('install', event => {
  self.skipWaiting(); // Forces the waiting service worker to become the active service worker.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate Event: Clear old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all pages immediately.
});

// Fetch Event: Network-First Strategy
self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return fetch(event.request)
        .then(response => {
          // If network is successful, update cache and return response
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => {
          // If network fails (offline), load from cache
          return cache.match(event.request);
        });
    })
  );
});