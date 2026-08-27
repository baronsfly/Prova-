// PilotLog v4.8 - service worker intentionally minimal during active development.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
