const CACHE = "branje-stevcev-v3";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./ocr-robust.js"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

async function injectRobustOCR(response) {
  const text = await response.text();
  if (text.includes("ocr-robust.js")) return new Response(text, {status: response.status, statusText: response.statusText, headers: response.headers});
  const injected = text.replace("</body>", '<script src="./ocr-robust.js?v=3"></script></body>');
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  return new Response(injected, {status: response.status, statusText: response.statusText, headers});
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isPage = event.request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/BRANJE-TEVCEV/");

  if (isPage) {
    event.respondWith((async () => {
      try {
        const net = await fetch(event.request, {cache:"no-store"});
        const copy = net.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        return await injectRobustOCR(net);
      } catch (_) {
        const cached = await caches.match(event.request) || await caches.match("./index.html");
        return cached ? await injectRobustOCR(cached) : Response.error();
      }
    })());
    return;
  }

  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    return response;
  }).catch(() => caches.match(event.request)));
});