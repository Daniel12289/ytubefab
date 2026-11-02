// Ytubefab service worker: lets the installed app open and scroll without internet.
const VERSION = "ytubefab-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const IMAGE_CACHE = `${VERSION}-images`;
const MAX_IMAGES = 80;

const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// Open the page from the network when possible, the saved copy when offline.
async function pageRequest(request) {
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000)),
    ]);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put("/index.html", fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await caches.match("/index.html");
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The app page itself
  if (req.mode === "navigate" && url.origin === self.location.origin) {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      event.respondWith(pageRequest(req));
    }
    return;
  }

  // Movie thumbnails: keep a limited number for offline scrolling
  if (url.hostname === "i.ytimg.com") {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok && res.type === "cors") {
            cache.put(req, res.clone());
            trim(IMAGE_CACHE, MAX_IMAGES);
          }
          return res;
        } catch (e) {
          return Response.error();
        }
      }),
    );
    return;
  }

  // Our own static files (icons, manifest): saved copy first, refreshed in the background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      }),
    );
  }
});
