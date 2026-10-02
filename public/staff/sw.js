/* BSWL Staff service worker.

   NEVER caches /api — staff data must always be live and must never be
   served from a session that has since signed out.
   Navigations: network first, cached copy only as the offline fallback,
   so a deploy always reaches Leon. Static assets (/_next/static, /brand):
   cache first; their URLs are content-hashed.
   Bump CACHE when this file changes. */
var CACHE = 'bswl-staff-next-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(['/staff/login', '/brand/logo-side.png', '/brand/logo-login.png'].map(function (u) {
      return c.add(u).catch(function () {});
    }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('bswl-staff') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return r;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match('/staff/login'); });
    }));
    return;
  }
  if (url.pathname.indexOf('/_next/static/') === 0 || url.pathname.indexOf('/brand/') === 0) {
    e.respondWith(caches.match(req).then(function (m) {
      return m || fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return r;
      });
    }));
  }
});
