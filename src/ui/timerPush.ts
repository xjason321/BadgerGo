// Asks the stats Worker to push the bike timer's notifications to this phone (see worker/timers.ts). The page itself
// can't keep a notification current once the phone freezes it in the background. Every step can fail quietly
// (no push support, not set up on the server, offline): the caller then keeps showing notifications itself.

/** The server's public key as the bytes the push API wants. */
export function keyBytes(key: string): Uint8Array {
  const bin = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array): boolean => {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try { return (await navigator.serviceWorker?.getRegistration()) ?? null; } catch { return null; }
}

/** The dock the rider is heading for, and how many open docks it had just now (the server warns when that falls from safe to risky). */
export interface PushDock { id: string; name: string; docks: number }

/** True when the server will push this ride's notifications. Safe to call again for the same ride (after a reload). */
export async function startPush(startedAt: number, endDock?: PushDock): Promise<boolean> {
  try {
    const reg = await registration();
    if (!reg?.pushManager) return false;
    const keyRes = await fetch("/api/push/key");
    if (!keyRes.ok) return false; // push isn't set up on the server
    const key = keyBytes(String(((await keyRes.json()) as { key?: unknown }).key ?? ""));
    let sub = await reg.pushManager.getSubscription();
    // A subscription made for another key (the server's key was replaced) would be refused by the push service.
    if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    try {
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    } catch {
      // A subscription made with another key blocks a new one: drop it and subscribe again.
      await sub?.unsubscribe().catch(() => {});
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    }
    return (await post("/api/timer", { subscription: sub.toJSON(), startedAt, ...(endDock ? { endDock } : {}) })).ok;
  } catch { return false; }
}

/** The ride is over: stop the pushes. */
export async function stopPush(): Promise<void> {
  try {
    const sub = await (await registration())?.pushManager?.getSubscription();
    if (sub) await post("/api/timer/stop", { endpoint: sub.endpoint });
  } catch { /* the server also stops after 3 hours or when the phone drops the subscription */ }
}
