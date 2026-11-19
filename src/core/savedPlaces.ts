import type { Place } from "./types";

export interface Stored { name: string; lat: number; lon: number }
export interface Places { saved: Stored[]; recents: Stored[] }

export const MAX_SAVED = 8;
export const MAX_RECENTS = 6;
const KEY = "badgergo.places";
/** Two places this close, or with the same name, are the same place. */
const SAME_M = 40;

const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: Stored, b: Stored): number {
  const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(x, rad(b.lat - a.lat)) * 6371000;
}
export const samePlace = (a: Stored, b: Stored) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase() || metres(a, b) < SAME_M;

/** A place worth remembering: not "My location", which changes every time. */
export const rememberable = (p: Place) => p.label.trim() !== "" && p.label !== "My location";
export const toStored = (p: Place): Stored => ({ name: p.label.split(",").slice(0, 2).join(",").trim(), lat: p.lat, lon: p.lon });

export const EMPTY: Places = { saved: [], recents: [] };

export const isSaved = (st: Places, p: Stored) => st.saved.some((s) => samePlace(s, p));

/** Put a place at the top of the recents (saved places don't need a second listing). */
export function addRecent(st: Places, p: Stored): Places {
  if (isSaved(st, p)) return st;
  return { ...st, recents: [p, ...st.recents.filter((r) => !samePlace(r, p))].slice(0, MAX_RECENTS) };
}

/** Save the place, or un-save it if it already is. */
export function toggleSaved(st: Places, p: Stored): Places {
  if (isSaved(st, p)) return { ...st, saved: st.saved.filter((s) => !samePlace(s, p)) };
  return { saved: [p, ...st.saved].slice(0, MAX_SAVED), recents: st.recents.filter((r) => !samePlace(r, p)) };
}

const ok = (x: unknown): x is Stored => !!x && typeof (x as Stored).name === "string" && Number.isFinite((x as Stored).lat) && Number.isFinite((x as Stored).lon);

export function readPlaces(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Places {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "null");
    if (!raw) return EMPTY;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter(ok) : []);
    return { saved: list(raw.saved).slice(0, MAX_SAVED), recents: list(raw.recents).slice(0, MAX_RECENTS) };
  } catch { return EMPTY; }
}
export function writePlaces(st: Places, storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(st)); } catch { /* storage full or blocked */ }
}
