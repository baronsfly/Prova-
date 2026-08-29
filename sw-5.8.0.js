const CACHE='pilotlog-v5.8.0';
const ROOT=new URL('./',self.location).href;
const INDEX=new URL('./index.html',self.location).href;
const CORE=[ROOT,INDEX,new URL('./pilotlog-5.8.0.css',self.location).href,new URL('./pilotlog-5.8.0.js',self.location).href,new URL('./manifest.webmanifest',self.location).href];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key!==CACHE&&key.startsWith('pilotlog-'))await caches.delete(key);await self.clients.claim()})())});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;event.respondWith((async()=>{try{const res=await fetch(req);if(res&&res.ok){const copy=res.clone();const cache=await caches.open(CACHE);await cache.put(req,copy)}return res}catch(err){if(req.mode==='navigate')return (await caches.match(INDEX))||(await caches.match(ROOT));return await caches.match(req)}})())});
