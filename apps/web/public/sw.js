// 只缓存静态离线查看器，库存副本由用户主动开启后另行保存；不缓存API或登录响应。
const cacheName = "homestash-offline-v2";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll([
          "/offline.html",
          "/offline-storage.js",
          "/offline-viewer.js",
        ]),
      ),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key !== cacheName &&
                  (key.startsWith("homestash-offline-") ||
                    key.startsWith("freshmate-offline-")),
              )
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (
    ["/offline.html", "/offline-storage.js", "/offline-viewer.js"].includes(
      url.pathname,
    )
  ) {
    event.respondWith(
      caches
        .open(cacheName)
        .then(
          async (cache) =>
            (await cache.match(url.pathname)) ?? fetch(event.request),
        ),
    );
    return;
  }
  if (event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request)
        .then((response) =>
          response.status >= 500 ? caches.match("/offline.html") : response,
        )
        .catch(() => caches.match("/offline.html")),
    );
});
