/* BSWL Parent service worker, served from a route rather than public/ for
   one reason: the hub lives at /parent (no trailing slash), which a worker
   at /parent/sw.js cannot control with its default scope of /parent/. The
   Service-Worker-Allowed header lets it register with scope '/parent'.

   Network first for pages, so a deploy always reaches the parent, with the
   cache as the offline fallback. /api is never cached: a stale fee balance
   is worse than no fee balance. Bump CACHE on every change to this file. */

const SW = `
var CACHE='bswl-parent-next-v1';
var ASSETS=['/parent','/parent/login','/parent/manifest.json','/parent/icon-192.png','/parent/icon-512.png','/parent/apple-touch-icon.png'];

self.addEventListener('install',function(e){
 e.waitUntil(caches.open(CACHE).then(function(c){
  return Promise.all(ASSETS.map(function(u){
   return fetch(u,{cache:'reload'}).then(function(r){if(r&&r.ok&&!r.redirected)return c.put(u,r);}).catch(function(){});
  }));
 }).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
 e.waitUntil(caches.keys().then(function(ks){
  return Promise.all(ks.filter(function(k){return k.indexOf('bswl-parent')===0&&k!==CACHE;}).map(function(k){return caches.delete(k);}));
 }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
 var req=e.request;
 if(req.method!=='GET')return;
 var u=new URL(req.url);
 if(u.origin!==self.location.origin)return;
 if(u.pathname.indexOf('/api/')===0)return;
 var isHTML=req.mode==='navigate'||(req.headers.get('accept')||'').indexOf('text/html')>=0;
 if(isHTML){
  e.respondWith(fetch(req).then(function(res){
   if(res&&res.status===200&&!res.redirected){var c=res.clone();caches.open(CACHE).then(function(k){k.put(req,c);});}
   return res;
  }).catch(function(){return caches.match(req,{ignoreSearch:true}).then(function(r){return r||caches.match('/parent');});}));
  return;
 }
 e.respondWith(caches.match(req,{ignoreSearch:true}).then(function(hit){
  var net=fetch(req).then(function(res){
   if(res&&res.status===200&&!res.redirected){var c2=res.clone();caches.open(CACHE).then(function(k){k.put(req,c2);});}
   return res;}).catch(function(){return hit;});
  return hit||net;
 }));
});

/* The fee reminder: { title, body, url, tag }. */
self.addEventListener('push',function(e){
 var d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data?e.data.text():''};}
 e.waitUntil(self.registration.showNotification(d.title||'BS With Leon',{
  body:d.body||'',icon:'/parent/icon-192.png',badge:'/parent/icon-192.png',tag:d.tag||'bswl-parent',renotify:true,
  data:{url:d.url||'/parent'}}));
});
self.addEventListener('notificationclick',function(e){
 e.notification.close();
 var target=new URL((e.notification.data&&e.notification.data.url)||'/parent',self.location.origin+'/parent/');
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
  for(var i=0;i<list.length;i++){var c=list[i];
   if(c.url.indexOf(self.registration.scope)===0&&'focus' in c)return c.focus();}
  return self.clients.openWindow(target.href);
 }));
});
`;

export function GET() {
  return new Response(SW, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/parent',
    },
  });
}
