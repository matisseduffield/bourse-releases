// Lets the website open with no signal. Pages and the app's own files come from
// the network first, so a release shows straight away; the copies here are only
// for when that fails. Anything not named below passes straight through, so /api/ and its prices
// never land here. Registered by pwa.js, never in the Android app.
const CACHE = 'bourse';
const at = file => new URL(file, location).href;
const INDEX = at('index.html');
const FILES = ['index.html', 'style.css', 'universes.js', 'lib.js', 'app.js', 'pwa.js', 'fonts/hanken-grotesk-latin.woff2'].map(at);

addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => skipWaiting()));
});

addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => clients.claim()));
});

addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  // The one copy of a file, whatever its ?v=: a new version replaces the last.
  const key = url.pathname === '/' ? INDEX : url.origin + url.pathname;
  if (!FILES.includes(key)) return;
  e.respondWith(fetch(request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)));
    }
    return res;
  }).catch(() => caches.match(key).then(hit => hit || Response.error())));
});
