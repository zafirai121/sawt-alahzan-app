// Service worker for the installed app.
//  - The app's own files: network first, cached copy when offline.
//  - Tracks the listener downloaded (AUDIO_CACHE, filled by the page): served
//    from the cache, including the byte ranges the audio player asks for.
//  - The database and everything else are left alone, so data is always fresh.
const APP_CACHE = 'sawt-alahzan-app-v3';
const AUDIO_CACHE = 'sawt-alahzan-audio-cache-v1';
const MEDIA_HOST = 'soutalahzan.com'; // R2: audio files and covers

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== APP_CACHE && n !== AUDIO_CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Answer a Range request from a full cached response
async function rangeResponse(request, cached) {
  const range = request.headers.get('range');
  if (!range) return cached;
  const blob = await cached.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m && m[1] ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), blob.size - 1) : blob.size - 1;
  if (start >= blob.size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // App shell: network first so updates show up, cache as the offline fallback
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match(new URL('./', self.location).href)))
    );
    return;
  }

  // Downloaded tracks and covers (on the media host); everything else passes through
  if (url.hostname !== MEDIA_HOST) return;
  event.respondWith(
    caches.open(AUDIO_CACHE)
      .then((cache) => cache.match(request.url))
      .then((cached) => (cached ? rangeResponse(request, cached) : fetch(request)))
  );
});
