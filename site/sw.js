// sw.js — so yesterday's feed reads on a train, and nothing else.
//
// Everything goes to the network first and falls back to the cache. Serving a
// cached copy first would be faster and is how most of these are written, and
// it is wrong here: a page and the script that runs it have to agree, and one
// asset missed by the build's ?v= stamping would then be cached forever. An
// offline fallback cannot go stale, because online never reads it.
// Bumped when a cached asset changes name: activate drops every other
// cache, so an offline copy can never point at a script that is gone.
const CACHE = "manicule-2";
const PAGES = ["./", "index.html", "method.html", "fork.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PAGES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // Stamped assets change address every build, so the cached copy of an
      // old one is matched loosely rather than not at all: offline, a slightly
      // old script beats a blank page.
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || (request.mode === "navigate" ? caches.match("./") : undefined))),
  );
});
