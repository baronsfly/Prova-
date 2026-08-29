const CACHE='pilotlog-v6.0.1';
const ROOT=new URL('./',self.location).href;
const INDEX=new URL('./index.html',self.location).href;
const STATIC=new Set([
  new URL('./pilotlog-6.0.1.css',self.location).href,
  new URL('./pilotlog-6.0.1.js',self.location).href,
  new URL('./manifest.webmanifest',self.location).href
]);
const CORE=[ROOT,INDEX,...STATIC];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()){
      if(key!==CACHE && key.startsWith('pilotlog-')) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const res=await fetch(req);
        if(res && res.ok){
          const cache=await caches.open(CACHE);
          await cache.put(INDEX,res.clone());
        }
        return res;
      }catch{
        return (await caches.match(INDEX)) || (await caches.match(ROOT));
      }
    })());
    return;
  }

  if(STATIC.has(url.href)){
    event.respondWith((async()=>{
      const cached=await caches.match(req);
      if(cached) return cached;
      const res=await fetch(req);
      if(res && res.ok){
        const cache=await caches.open(CACHE);
        await cache.put(req,res.clone());
      }
      return res;
    })());
  }
});
