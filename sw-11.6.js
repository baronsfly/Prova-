const CACHE='pilotlog-v11.6-sim-report-v1';
const ROOT=new URL('./',self.location).href;
const INDEX=new URL('./index.html',self.location).href;
const CORE=[ROOT,INDEX,new URL('./pilotlog-11.6.css',self.location).href,new URL('./pilotlog-11.6.js',self.location).href,new URL('./manifest.webmanifest',self.location).href,new URL('./nexa-apple-touch-icon-180.png',self.location).href,new URL('./nexa-icon-192.png',self.location).href,new URL('./nexa-icon-512.png',self.location).href];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key!==CACHE&&key.startsWith('pilotlog-'))await caches.delete(key);await self.clients.claim()})())});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{try{const res=await fetch(req);if(res?.ok){const cache=await caches.open(CACHE);cache.put(INDEX,res.clone())}return res}catch{return (await caches.match(INDEX))||(await caches.match(ROOT))}})());
    return;
  }
  const immutable=CORE.includes(url.href)&&url.href!==INDEX&&url.href!==ROOT;
  if(immutable){event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(async res=>{if(res?.ok)(await caches.open(CACHE)).put(req,res.clone());return res})));return}
  event.respondWith((async()=>{try{const res=await fetch(req);if(res?.ok)(await caches.open(CACHE)).put(req,res.clone());return res}catch{return caches.match(req)}})());
});
