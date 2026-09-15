const CACHE = "branje-stevcev-v11";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./ocr-robust.js", "./auto-read.js", "./meter-recheck.js", "./email-share.js", "./gallery.js"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

async function injectScripts(response) {
  const text = await response.text();
  let injected = text;
  if (!injected.includes("ocr-robust.js")) {
    injected = injected.replace("</body>", '<script src="./ocr-robust.js?v=10"></script></body>');
  }
  if (!injected.includes("auto-read.js")) {
    injected = injected.replace("</body>", '<script src="./auto-read.js?v=1"></script></body>');
  }
  if (!injected.includes("meter-recheck.js")) {
    injected = injected.replace("</body>", '<script src="./meter-recheck.js?v=1"></script></body>');
  }
  if (!injected.includes("email-share.js")) {
    injected = injected.replace("</body>", '<script src="./email-share.js?v=1"></script></body>');
  }
  if (!injected.includes("gallery.js")) {
    injected = injected.replace("</body>", '<script src="./gallery.js?v=1"></script></body>');
  }
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
        return await injectScripts(net);
      } catch (_) {
        const cached = await caches.match(event.request) || await caches.match("./index.html");
        return cached ? await injectScripts(cached) : Response.error();
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