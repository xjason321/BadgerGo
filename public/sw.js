/* BadgerGo service worker: opens the app and shows the map with a weak or missing signal.
   Only fetches that are safe to reuse are cached. Routing, dock counts, weather and search always go to the network. */
const VERSION = "v1";
const APP = `badgergo-app-${VERSION}`;
const TILES = `badgergo-tiles-${VERSION}`;
const MAX_TILES = 600;
/** Same-site files (each deploy adds new hashed ones): keep the newest this many. */
const MAX_APP = 80;

/** Saving a copy is a bonus: a full disk or an unsaveable response (206, error) must not break the fetch. */
const keep = (c, req, r) => c.put(req, r).catch(() => {});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, TILES].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) if (!(name === APP && new URL(keys[i].url).pathname === "/")) await c.delete(keys[i]);
}

/** Serve the cached copy now and refresh it in the background. */
async function staleWhileRevalidate(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const fresh = fetch(req).then((r) => {
    if (r.status === 200 || r.type === "opaque") keep(c, req, r.clone()).then(() => trim(cacheName, MAX_APP).catch(() => {}));
    return r;
  }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

/** The page: network first (so updates arrive), but fall back to the last copy after a short wait or when offline. */
async function page(req) {
  const c = await caches.open(APP);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 4000))]);
    if (r.status === 200) keep(c, "/", r.clone());
    return r;
  } catch {
    return (await c.match("/")) || Response.error();
  }
}

/** Map tiles never change under the same URL: use the saved one, otherwise fetch and keep it. */
async function tile(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r.status === 200 || r.type === "opaque") keep(c, req, r.clone()).then(() => trim(TILES, MAX_TILES).catch(() => {}));
    return r;
  } catch { return Response.error(); }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && url.origin === location.origin) return e.respondWith(page(req));
  if (url.hostname === "tile.openstreetmap.org") return e.respondWith(tile(req));
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return e.respondWith(staleWhileRevalidate(req, APP));
  if (url.origin === location.origin && !url.pathname.startsWith("/valhalla")) return e.respondWith(staleWhileRevalidate(req, APP));
});

/** Tapping a timer notification brings BadgerGo forward (or opens it). */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow("/");
  })());
});
