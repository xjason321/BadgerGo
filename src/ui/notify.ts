import type { NoteContent } from "../core/timerNotify";

/** on: will notify. off: not asked yet. blocked: the rider said no. unsupported: this browser can't (e.g. Safari outside a home-screen app). */
export type NotifyState = "on" | "off" | "blocked" | "unsupported";

const supported = () => typeof window !== "undefined" && "Notification" in window;

export function notifyState(): NotifyState {
  if (!supported()) return "unsupported";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "blocked" : "off";
}

/** Ask the browser for permission. Call it straight from a tap (some browsers refuse otherwise). Never asks twice. */
export async function askNotifyPermission(): Promise<NotifyState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch { /* old browsers use a callback; the state below still reflects the answer */ }
  }
  return notifyState();
}

const registration = async () => {
  try { return (await navigator.serviceWorker?.getRegistration()) ?? null; } catch { return null; }
};

/** Show a notification (the service worker's when there is one, which is what Android needs). Quietly does nothing without permission. */
export async function showNote(n: NoteContent, opts: { silent?: boolean } = {}): Promise<void> {
  if (notifyState() !== "on") return;
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: n.body,
    tag: n.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    silent: !!opts.silent,
    renotify: !opts.silent,
    data: { url: "/" },
  };
  if (!opts.silent) options.vibrate = [250, 120, 250];
  try {
    const reg = await registration();
    if (reg) { await reg.showNotification(n.title, options); return; }
    new Notification(n.title, options);
  } catch { /* some phones only allow the service-worker kind; nothing more to try */ }
}

export async function closeNote(tag: string): Promise<void> {
  try {
    const reg = await registration();
    for (const n of (await reg?.getNotifications({ tag })) ?? []) n.close();
  } catch { /* ignore */ }
}
