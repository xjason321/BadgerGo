// Keeps a running ride across reloads and trips to other apps (browser storage; the pure timer maths is in bikeTimer.ts).
import { MAX_RIDE_MS } from "./timerPush";

const KEY = "badgergo.bikeTimer";
const STALE_MS = MAX_RIDE_MS;
/** The start time is kept so a reload (or a trip to another app) doesn't lose the ride. */
export function readTimer(now = Date.now(), store: Pick<Storage, "getItem"> | null = safeStore()): number | null {
  try {
    const v = Number(store?.getItem(KEY));
    return Number.isFinite(v) && v > 0 && now - v < STALE_MS && v <= now + 1000 ? v : null;
  } catch { return null; }
}
export function writeTimer(startedAt: number | null, store: Pick<Storage, "setItem" | "removeItem"> | null = safeStore()) {
  try { if (startedAt == null) store?.removeItem(KEY); else store?.setItem(KEY, String(startedAt)); } catch { /* private mode */ }
}
function safeStore(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }
