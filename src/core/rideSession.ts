import type { Place, Plan } from "./types";

/** Everything needed to pick a ride back up after the page was closed or reloaded (say, by switching apps). */
export interface Session { plan: Plan; origin: Place; destination: Place; index: number; savedAt: number }

const KEY = "badgergo.ride";
/** A ride older than this is over, whatever the app thinks. */
export const MAX_AGE_MS = 3 * 3600_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const def = (): Store | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

const isLine = (g: unknown) => Array.isArray(g) && g.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
const isSeg = (s: unknown) => !!s && isLine((s as { geometry?: unknown }).geometry) && Number.isFinite((s as { durationMin?: unknown }).durationMin);
const isStation = (s: unknown) => !!s && typeof (s as { id?: unknown }).id === "string" && typeof (s as { name?: unknown }).name === "string" && Number.isFinite((s as { lat?: unknown }).lat) && Number.isFinite((s as { lon?: unknown }).lon);
/** Enough of a plan to ride it. A ride saved by an older version of the app may not have it, and must not crash ride mode. */
const isPlan = (p: any): p is Plan =>
  !!p && typeof p.id === "string" && Array.isArray(p.stations) && p.stations.every(isStation) && isSeg(p.walkToDock) && isSeg(p.walkFromDock) &&
  Array.isArray(p.rides) && p.rides.every(isSeg) && (p.walkOnly ? true : p.rides.length === Math.max(0, p.stations.length - 1));
const isPlace = (p: unknown): p is Place => !!p && Number.isFinite((p as Place).lat) && Number.isFinite((p as Place).lon) && typeof (p as Place).label === "string";

/** Keep the plan lean: road-type analysis is large and not needed to ride. */
export const slim = (plan: Plan): Plan => { const { roads: _roads, ...rest } = plan; return rest as Plan; };

export function saveSession(s: Session, store: Store | undefined = def()) {
  try { store?.setItem(KEY, JSON.stringify({ ...s, plan: slim(s.plan) })); } catch { /* storage full or blocked */ }
}
export function clearSession(store: Store | undefined = def()) {
  try { store?.removeItem(KEY); } catch { /* ignore */ }
}

/** The saved ride, or null when there is none, it's stale, or it's damaged. */
export function readSession(now = Date.now(), store: Store | undefined = def()): Session | null {
  try {
    const raw = JSON.parse(store?.getItem(KEY) ?? "null");
    if (!raw || !isPlan(raw.plan) || !isPlace(raw.origin) || !isPlace(raw.destination)) return null;
    if (!Number.isInteger(raw.index) || raw.index < 0) return null;
    if (!Number.isFinite(raw.savedAt) || now - raw.savedAt > MAX_AGE_MS || raw.savedAt > now + 60_000) return null;
    return raw as Session;
  } catch { return null; }
}
