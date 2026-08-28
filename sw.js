const CACHE='pilotlog-v5.2.0';
const ROOT=new URL('./',self.location).href;
const INDEX=new URL('./index.html',self.location).href;
const CORE=[ROOT,INDEX,new URL('./styles.css',self.location).href,new URL('./app.js',self.location).href,new URL('./manifest.webmanifest',self.location).href];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})())});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;if(req.mode==='navigate'){event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(INDEX,copy));return res}).catch(()=>caches.match(INDEX)));return}event.respondWith(caches.match(req,{ignoreSearch:true}).then(cached=>cached||fetch(req).then(res=>{if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res})))});
