// sw.js — so yesterday's pool reads on a train.
//
// The build stamps every local asset with the commit (manicule.css?v=abc), so a
// stamped URL is immutable: cache it under its exact address and a new build
// asks for an address that is not in the cache. Matching loosely here would
// undo that stamping and serve a new page an old script.
//
// Pages and the two data files go to the network first, so anyone online is
// reading today's pool from today's page, and fall back to the cache when the
// train goes into a tunnel.
const SHELL = "manicule-shell-1";
const DATA = "manicule-data-1";
const PAGES = ["./", "index.html", "method.html", "fork.html"];
const IS_DATA = /\/(posts\.json|vectors\.bin)$/;

const keep = (cacheName, request, response) => {
  const copy = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, copy));
  return response;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PAGES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL && n !== DATA).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;

  // Newest wins, cache is the fallback: a page, and the pool it reads.
  if (request.mode === "navigate" || IS_DATA.test(url.pathname)) {
    const where = IS_DATA.test(url.pathname) ? DATA : SHELL;
    event.respondWith(
      fetch(request)
        .then((response) => keep(where, request, response))
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./"))),
    );
    return;
  }

  // Everything else is stamped, so its address is its version.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => keep(SHELL, request, response))),
  );
});
