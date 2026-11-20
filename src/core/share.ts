import { KINDS } from "./bikeways";
import { isMyBike } from "./myBike";
import type { Place, Plan, RoadPrefs, Station } from "./types";

/** Everything needed to rebuild one route on another phone: where it goes, which docks, and how it was planned. */
export interface SharedRoute {
  origin: Place;
  destination: Place;
  /** Real docks in order (pick-up, swaps, drop-off). Empty for a walk-only route. */
  stationIds: string[];
  walkOnly: boolean;
  /** Set when the route starts on the rider's own bike: free minutes left on it. */
  bikeLeft: number | null;
  swapsOn: boolean;
  maxRide: number;
  prefs: RoadPrefs;
}

/** The query parameter that carries a shared route. */
export const SHARE_PARAM = "r";
const VERSION = 1;
const MAX_STOPS = 12;

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(token: string): string {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const UNPAVED = ["avoid", "ok"] as const;
const HILLS = ["avoid", "normal", "ok"] as const;

/** A compact token for a route (URL-safe, no padding). */
export function encodeShare(r: SharedRoute): string {
  const place = (p: Place) => [r5(p.lat), r5(p.lon), p.label.slice(0, 120)];
  return b64urlEncode(
    JSON.stringify({
      v: VERSION,
      o: place(r.origin),
      d: place(r.destination),
      s: r.stationIds,
      w: r.walkOnly ? 1 : 0,
      b: r.bikeLeft,
      sw: r.swapsOn ? 1 : 0,
      m: r.maxRide,
      p: [r.prefs.traffic, r.prefs.strict ? 1 : 0, UNPAVED.indexOf(r.prefs.unpaved), HILLS.indexOf(r.prefs.hills)],
    }),
  );
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function readPlace(x: unknown): Place | null {
  if (!Array.isArray(x) || x.length < 3) return null;
  const [lat, lon, label] = x;
  if (!isNum(lat) || !isNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || typeof label !== "string") return null;
  return { lat, lon, label: label.slice(0, 120) };
}

/** Read a token back. Anything malformed, from the wrong version or out of range gives null, never a throw. */
export function decodeShare(token: string): SharedRoute | null {
  try {
    const j = JSON.parse(b64urlDecode(token.trim()));
    if (!j || typeof j !== "object" || j.v !== VERSION) return null;
    const origin = readPlace(j.o);
    const destination = readPlace(j.d);
    if (!origin || !destination) return null;
    const ids: unknown = j.s;
    if (!Array.isArray(ids) || ids.length > MAX_STOPS || !ids.every((s) => typeof s === "string" && s.length > 0 && s.length <= 64)) return null;
    const walkOnly = j.w === 1;
    const bikeLeft = j.b == null ? null : isNum(j.b) ? Math.max(0, Math.min(30, Math.round(j.b))) : undefined;
    if (bikeLeft === undefined) return null;
    // A bike route needs a drop-off dock (and a pick-up unless you start on your own bike); a walk has none.
    if (walkOnly ? ids.length !== 0 : ids.length < (bikeLeft != null ? 1 : 2)) return null;
    const maxRide = isNum(j.m) ? Math.max(5, Math.min(30, Math.round(j.m))) : 25;
    const p = j.p;
    if (!Array.isArray(p) || p.length !== 4) return null;
    const traffic = Math.round(Number(p[0]));
    const unpaved = UNPAVED[p[2] as number];
    const hills = HILLS[p[3] as number];
    if (!(traffic >= 0 && traffic < KINDS.length) || !unpaved || !hills) return null;
    return {
      origin,
      destination,
      stationIds: ids as string[],
      walkOnly,
      bikeLeft,
      swapsOn: j.sw !== 0,
      maxRide,
      prefs: { traffic, strict: p[1] === 1, unpaved, hills },
    };
  } catch {
    return null;
  }
}

/** The link to send. `base` is the page's address (any query or hash on it is dropped). */
export function shareUrl(base: string, r: SharedRoute): string {
  const u = new URL(base);
  u.search = "";
  u.hash = "";
  u.searchParams.set(SHARE_PARAM, encodeShare(r));
  return u.toString();
}

/** The shared route in a page address's query string, if there is one. */
export function readShareParam(search: string): SharedRoute | null {
  const t = new URLSearchParams(search).get(SHARE_PARAM);
  return t ? decodeShare(t) : null;
}

/** Describe a route on screen as a SharedRoute. */
export function shareFromPlan(
  plan: Plan,
  ctx: { origin: Place; destination: Place; swapsOn: boolean; maxRide: number; prefs: RoadPrefs },
): SharedRoute {
  const real = plan.walkOnly ? [] : plan.stations.filter((s) => !isMyBike(s));
  return {
    origin: ctx.origin,
    destination: ctx.destination,
    stationIds: real.map((s) => s.id),
    walkOnly: !!plan.walkOnly,
    bikeLeft: !plan.walkOnly && plan.stations.some(isMyBike) ? plan.startMinutesLeft ?? 30 : null,
    swapsOn: ctx.swapsOn,
    maxRide: ctx.maxRide,
    prefs: ctx.prefs,
  };
}

/** The docks of a shared route from the live list, in order; null if any of them is gone. */
export function chainFromIds(ids: string[], stations: Station[]): Station[] | null {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const out: Station[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) return null;
    out.push(s);
  }
  return out;
}
