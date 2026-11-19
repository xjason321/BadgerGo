/**
 * Registers the service worker that lets BadgerGo open and show the map with a weak signal.
 * Only in the built app: in development it would serve stale modules. Open the dev server
 * with ?sw=1 to try it there.
 */
export function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD && !location.search.includes("sw=1")) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
