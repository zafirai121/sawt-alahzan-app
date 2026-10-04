// Service worker for the installed app.
//  - The app's own files: network first, cached copy when offline.
//  - Tracks (and their covers) the listener downloaded (AUDIO_CACHE, filled by
//    the page): served from the cache, including the byte ranges the audio
//    player asks for, whichever host the file lives on.
//  - Fonts: cached copy first, so text keeps its typeface offline.
//  - The database and everything else are left alone, so data is always fresh.
const APP_CACHE = 'sawt-alahzan-app-v4';
const AUDIO_CACHE = 'sawt-alahzan-audio-cache-v1';
// Where audio files and covers are stored: R2 (own domain and r2.dev) and
// Supabase Storage (older uploads)
const MEDIA_HOSTS = new Set(['soutalahzan.com', 'pub-8168942d67ae4c1fb48c404f11458b4a.r2.dev']);
const SUPABASE_HOST = 'ckhtndmrcypkqrpjlzli.supabase.co';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const isMedia = (url) => MEDIA_HOSTS.has(url.hostname)
  || (url.hostname === SUPABASE_HOST && url.pathname.startsWith('/storage/'));

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

// Build files carry a content hash (assets/index-AbC123xy.js): each release
// adds new names, so older copies of the same file are dropped as they're replaced
const HASHED = /^(.*\/assets\/.+-)[\w-]{8}(\.\w+)$/;
async function keepApp(request, response) {
  const cache = await caches.open(APP_CACHE);
  await cache.put(request, response);
  const path = new URL(request.url).pathname;
  const m = HASHED.exec(path);
  if (!m) return;
  for (const key of await cache.keys()) {
    const p = new URL(key.url).pathname;
    if (p !== path && p.startsWith(m[1]) && p.endsWith(m[2]) && HASHED.test(p) && p.length === path.length) cache.delete(key);
  }
}

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
    // App shell: network first so updates show up, cache as the offline fallback.
    // The page and the files without a hash in their name skip the browser's own
    // short-lived copy (GitHub Pages lets it keep one for 10 minutes), so a new
    // release shows on the next open; hashed files never change, any copy will do.
    const fresh = HASHED.test(url.pathname)
      ? fetch(request)
      : fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
    event.respondWith(
      fresh
        .then((response) => {
          if (response.ok) event.waitUntil(keepApp(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match(new URL('./', self.location).href)))
    );
    return;
  }

  if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(caches.open(APP_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      const fresh = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; });
      if (!hit) return fresh;
      event.waitUntil(fresh.catch(() => {})); // refresh in the background
      return hit;
    }));
    return;
  }

  // Downloaded tracks and covers; everything else (the database included) passes through
  if (!isMedia(url)) return;
  event.respondWith(
    caches.open(AUDIO_CACHE)
      .then((cache) => cache.match(request.url))
      .then((cached) => (cached ? rangeResponse(request, cached) : fetch(request)))
  );
});
