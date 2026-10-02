/* BSWL Student service worker, served from /student/sw.js.

   WHY A ROUTE AND NOT A FILE IN public/: the app page is /student (no
   trailing slash). A worker file at /student/sw.js can only claim /student/
   unless the response carries Service-Worker-Allowed, and a static file
   cannot set a header. Served from here it can, so the worker controls the
   app page itself.

   Strategy:
     navigations          network first (a deploy always reaches the phone);
                          the last good copy is the offline fallback
     /api/student GETs    network first, last good reply when offline; the
                          cache is wiped on sign-out, so a shared phone does
                          not keep the last student's work
     static assets        cache first, refreshed quietly in the background
     never touched        other origins, non-GET, /api/auth, /api/files
                          (two-minute tickets), event streams
   Push: payload {title, body, url, tag}; a tap focuses the open app and
   tells it where to go (?go=), or opens it there.
   Bump CACHE whenever the asset list or the strategy changes. */

const CACHE = 'bswl-student-next-v1';

const SOURCE = `
var CACHE='${CACHE}';
var ASSETS=['/student/manifest.json','/student/mark.png','/student/mark-light.png',
 '/student/icon-192.png','/student/icon-512.png','/student/icon-maskable-512.png','/student/apple-touch-icon.png'];

self.addEventListener('install',function(e){
 e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS);})
  .catch(function(){}).then(function(){return self.skipWaiting();}));
});

self.addEventListener('activate',function(e){
 e.waitUntil(caches.keys().then(function(ks){
  return Promise.all(ks.filter(function(k){return k.indexOf('bswl-student')===0&&k!==CACHE;})
   .map(function(k){return caches.delete(k);}));
 }).then(function(){return self.clients.claim();}));
});

function keep(req,res){
 if(res&&res.ok&&!res.redirected&&res.type==='basic'){
  var copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});
 }
 return res;
}

self.addEventListener('fetch',function(e){
 var req=e.request;
 if(req.method!=='GET')return;
 var url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 var accept=req.headers.get('accept')||'';
 if(accept.indexOf('text/event-stream')>=0)return;
 var p=url.pathname;
 if(p.indexOf('/api/auth')===0||p.indexOf('/api/files')===0||p.indexOf('/api/quiz')===0)return;

 if(req.mode==='navigate'){
  e.respondWith(fetch(req).then(function(res){return keep(req,res);}).catch(function(){
   return caches.match(req,{ignoreSearch:true}).then(function(r){return r||caches.match('/student');});
  }));
  return;
 }
 if(p.indexOf('/api/student/')===0){
  e.respondWith(fetch(req).then(function(res){return keep(req,res);}).catch(function(){
   return caches.match(req).then(function(r){return r||Response.error();});
  }));
  return;
 }
 if(p.indexOf('/api/')===0)return;
 e.respondWith(caches.match(req,{ignoreSearch:true}).then(function(hit){
  var net=fetch(req).then(function(res){return keep(req,res);}).catch(function(){return hit;});
  return hit||net;
 }));
});

self.addEventListener('message',function(e){
 if(e.data&&e.data.type==='bswl-clear'){
  e.waitUntil(caches.delete(CACHE));
 }
});

self.addEventListener('push',function(e){
 var d={};
 try{d=e.data?e.data.json():{};}catch(x){d={body:e.data?e.data.text():''};}
 e.waitUntil(self.registration.showNotification(d.title||'BS With Leon',{
  body:d.body||'',
  icon:'/student/icon-192.png',
  badge:'/student/icon-192.png',
  tag:d.tag||'bswl',
  renotify:true,
  data:{url:d.url||'/student'}
 }));
});

self.addEventListener('notificationclick',function(e){
 e.notification.close();
 var target=new URL((e.notification.data&&e.notification.data.url)||'/student',self.location.origin+'/student/');
 if(target.origin!==self.location.origin||target.pathname.indexOf('/student')!==0){
  target=new URL('/student'+target.search,self.location.origin);
 }
 var go=target.searchParams.get('go')||'next';
 var home=self.location.origin+'/student';
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
  for(var i=0;i<list.length;i++){
   var c=list[i];
   if(c.url.indexOf(home)===0&&c.url.indexOf(home+'/login')!==0&&'focus' in c){
    c.postMessage({type:'bswl-go',go:go});
    return c.focus();
   }
  }
  return self.clients.openWindow('/student?go='+encodeURIComponent(go));
 }));
});
`;

export function GET() {
  return new Response(SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/student',
    },
  });
}
