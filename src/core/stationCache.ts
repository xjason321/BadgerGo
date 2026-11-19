import { fetchStations } from "./gbfs";
import type { Station } from "./types";

const KEY = "badgergo.stations";
/** Saved dock data older than this isn't worth showing as if it meant anything. */
export const MAX_AGE_MS = 24 * 3600_000;

type Store = Pick<Storage, "getItem" | "setItem">;
const def = (): Store | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

export interface Loaded {
  stations: Station[];
  /** Set when the network failed and these are the last docks we saw: when they were saved (ms). */
  cachedAt?: number;
}

export function saveStations(stations: Station[], now = Date.now(), store: Store | undefined = def()) {
  try { store?.setItem(KEY, JSON.stringify({ at: now, stations })); } catch { /* storage full or blocked */ }
}

export function readStations(now = Date.now(), store: Store | undefined = def()): { at: number; stations: Station[] } | null {
  try {
    const raw = JSON.parse(store?.getItem(KEY) ?? "null");
    if (!raw || !Array.isArray(raw.stations) || !raw.stations.length || !Number.isFinite(raw.at)) return null;
    if (now - raw.at > MAX_AGE_MS || raw.at > now + 60_000) return null;
    return raw;
  } catch { return null; }
}

/** Download the docks; with no signal, fall back to the last ones we saw (and say when that was). */
export async function loadStations(systemId: string, f: typeof fetch = (i, o) => fetch(i, o), now: () => number = Date.now, store: Store | undefined = def()): Promise<Loaded> {
  try {
    const stations = await fetchStations(systemId, f);
    saveStations(stations, now(), store);
    return { stations };
  } catch (e) {
    const old = readStations(now(), store);
    if (!old) throw e;
    return { stations: old.stations, cachedAt: old.at };
  }
}

/** "5 min ago", "2 h ago". */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
