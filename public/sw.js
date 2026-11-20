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
  // The usage dashboard and its live numbers are never kept: an old copy of the numbers is wrong, and the dashboard page must not replace the saved app page.
  if (url.origin === location.origin && (url.pathname.startsWith("/api/") || url.pathname === "/analytics" || url.pathname === "/analytics.html")) return;
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

/** The bike timer's pushes (sent by the stats Worker once a minute during a ride): the phone freezes the page in the
    background, so this is what keeps the notification current. Each push must show a notification, or browsers
    penalise the site; the countdown is shown quietly and taken down again if the app is already on screen. */
self.addEventListener("push", (e) => {
  let n = null;
  try { n = e.data ? e.data.json() : null; } catch { /* not JSON */ }
  if (!n || typeof n.title !== "string") n = { title: "BadgerGo bike timer", body: "Open BadgerGo to see your time.", tag: "badgergo-timer-live", alert: false };
  const tag = typeof n.tag === "string" ? n.tag : "badgergo-timer-live";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.some((w) => w.visibilityState === "visible"); // the app is on screen: it beeps and speaks itself
    const loud = n.alert === true && !open;
    await self.registration.showNotification(n.title, {
      body: typeof n.body === "string" ? n.body : "", tag, icon: "/icon-192.png", badge: "/icon-192.png",
      silent: !loud, renotify: loud, ...(loud ? { vibrate: [250, 120, 250] } : {}), data: { url: "/" },
    });
    if (open && !n.alert) for (const old of await self.registration.getNotifications({ tag })) old.close();
  })());
});
