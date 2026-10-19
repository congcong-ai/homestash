// 只缓存离线提示页；不缓存库存 API，避免把旧库存当作最新事实。
self.addEventListener('install',event=>{event.waitUntil(caches.open('freshmate-offline-v1').then(cache=>cache.add('/offline.html')));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));});
