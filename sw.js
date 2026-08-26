// PilotLog v4.1: service worker intentionally disabled while stabilising navigation.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));
