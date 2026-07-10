const CACHE_NAME = 'sawt-alahzan-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass through all requests for now. 
  // Offline caching logic will be implemented in Phase 3.
  event.respondWith(fetch(event.request));
});
