import { haversine } from "./geo";
import { ARRIVE_M } from "./ride";
import type { LatLng, Plan } from "./types";

/** One stretch handed to an outside navigation app: a walk, or a ride (or part of one) between docks / guide points. */
export interface NavLeg {
  kind: "walk" | "ride";
  /** Where the leg ends: a dock, the destination, or (for a ride part) a guide point on the route. */
  to: LatLng;
  /** The dock or destination this leg is heading for. */
  toName: string;
  /** True when `to` is that dock / destination itself, false for a ride part that ends mid-route. */
  atStop: boolean;
  minutes: number;
  meters: number;
  /** The route this app planned for the leg, [lat, lon] pairs. */
  geometry: [number, number][];
  /** Points the outside app is routed through, in order (at most `GOOGLE_VIA` per leg). */
  via: LatLng[];
  /** "Part 1 of 2" when a long ride needs several links. */
  part?: { n: number; of: number };
  swap?: boolean;
  final?: boolean;
}

export { ARRIVE_M };

/**
 * How the trip is handed to Google Maps. A Maps link carries only an origin, a destination and a few waypoints, and
 * Google chooses its own path between them, so (the method BadgerBikes uses):
 *  - via points are added until no stretch between guide points is longer than `GAP_M` (fewest points),
 *    preferring shared-use path sections, where a point anchors best;
 *  - a ride with more via points than a link allows is split into parts of at most `GOOGLE_VIA` waypoints.
 */
export const GOOGLE_VIA = 3;
export const GAP_M = 700;
const MAX_SHAPING = 12;

const lenOf = (g: [number, number][]) => g.slice(1).reduce((a, p, i) => a + haversine({ lat: g[i][0], lon: g[i][1] }, { lat: p[0], lon: p[1] }), 0);

/** Cumulative metres at every vertex. */
function cumulative(g: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + haversine({ lat: g[i - 1][0], lon: g[i - 1][1] }, { lat: g[i][0], lon: g[i][1] }));
  return cum;
}

/** The point `along` metres down the line. */
function pointAt(g: [number, number][], cum: number[], along: number): LatLng {
  if (along <= 0) return { lat: g[0][0], lon: g[0][1] };
  const end = cum[cum.length - 1];
  if (along >= end) return { lat: g[g.length - 1][0], lon: g[g.length - 1][1] };
  let i = 1;
  while (cum[i] < along) i++;
  const t = (along - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return { lat: g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, lon: g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t };
}

/** The part of the line between two distances along it. */
function sliceAlong(g: [number, number][], cum: number[], a: number, b: number): [number, number][] {
  const s = pointAt(g, cum, a), e = pointAt(g, cum, b);
  const mid = g.filter((_, i) => cum[i] > a && cum[i] < b);
  return [[s.lat, s.lon], ...mid, [e.lat, e.lon]];
}

/**
 * Via points that keep an outside app on the route: the longest stretch between consecutive guide points (start, earlier
 * via points, end) is split until none is longer than `maxGap` or `slots` points are used. Points land on path sections
 * (`trailRanges`, metres along the route) when that costs no extra point. Returns distances along the route.
 */
export function shapingAlongs(endAlong: number, slots = MAX_SHAPING, trailRanges: ReadonlyArray<readonly [number, number]> = [], maxGap = GAP_M): number[] {
  const marks = [0, endAlong];
  const placed: number[] = [];
  for (let n = 0; n < slots; n++) {
    let best: { from: number; to: number } | null = null;
    for (let i = 0; i < marks.length - 1; i++) {
      const from = marks[i], to = marks[i + 1];
      if (to - from > maxGap && (!best || to - from > best.to - best.from)) best = { from, to };
    }
    if (!best) break;
    // This stretch needs k pieces of at most maxGap, so the next point may go anywhere in [to - (k-1)*maxGap, from + maxGap]:
    // on a path section there if possible, otherwise at the even split. Never hug the stretch's ends.
    const k = Math.ceil((best.to - best.from) / maxGap);
    const winLo = Math.max(best.from + maxGap / 4, best.to - (k - 1) * maxGap);
    const winHi = Math.min(best.to - maxGap / 4, best.from + maxGap);
    let along = best.from + (best.to - best.from) / k;
    let trail = Math.min(150, winHi - winLo) - 1; // ignore slivers of path
    for (const [a, b] of trailRanges) {
      const lo = Math.max(a, winLo), hi = Math.min(b, winHi);
      if (b > a && hi - lo > trail) { trail = hi - lo; along = (lo + hi) / 2; }
    }
    placed.push(along);
    marks.push(along);
    marks.sort((x, y) => x - y);
  }
  return placed.sort((x, y) => x - y);
}

/** Ranges (metres along the ride) on shared-use paths, from the road analysis. The analysis is scaled onto the ride line. */
function pathRanges(plan: Plan, j: number, rideM: number): [number, number][] {
  const segs = plan.roads?.rides[j]?.segments;
  if (!segs?.length) return [];
  const lens = segs.map((s) => lenOf(s.geometry));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const out: [number, number][] = [];
  let at = 0;
  segs.forEach((s, i) => {
    if (s.kind === 0) out.push([(at / total) * rideM, ((at + lens[i]) / total) * rideM]);
    at += lens[i];
  });
  return out;
}

/** A ride as one or more links: via points per `shapingAlongs`, then parts of at most `maxVia` waypoints (spread evenly). */
function rideLegs(plan: Plan, j: number, maxVia: number): NavLeg[] {
  const r = plan.rides[j];
  const dock = plan.stations[j + 1];
  const g = r.geometry;
  const swap = j < plan.rides.length - 1;
  const whole: NavLeg = { kind: "ride", to: dock, toName: dock.name, atStop: true, minutes: r.durationMin, meters: r.distanceM, geometry: g, via: [], swap };
  if (g.length < 2) return [whole];
  const cum = cumulative(g);
  const end = cum[cum.length - 1];
  const vias = shapingAlongs(end, MAX_SHAPING, pathRanges(plan, j, end));
  const guides = [...vias, end]; // distances of every point after the start; the last is the dock
  const parts = Math.max(1, Math.ceil(guides.length / (maxVia + 1)));
  const out: NavLeg[] = [];
  let from = 0, used = 0;
  for (let n = 0; n < parts; n++) {
    const take = Math.round(((n + 1) * guides.length) / parts) - used; // points this part covers, the last being its end
    const slice = guides.slice(used, used + take);
    used += take;
    const to = slice[slice.length - 1];
    const lastPart = n === parts - 1;
    const geometry = sliceAlong(g, cum, from, to);
    out.push({
      kind: "ride",
      to: lastPart ? dock : pointAt(g, cum, to),
      toName: dock.name,
      atStop: lastPart,
      minutes: (r.durationMin * (to - from)) / (end || 1),
      meters: to - from,
      geometry,
      via: slice.slice(0, -1).map((a) => pointAt(g, cum, a)),
      ...(parts > 1 ? { part: { n: n + 1, of: parts } } : {}),
      ...(lastPart ? { swap } : {}),
    });
    from = to;
  }
  return out;
}

/** The plan as legs for an outside app. Every leg starts from where the rider is (the previous leg's end), so no origin is sent. */
export function navLegs(plan: Plan, destination: LatLng, destinationName = "your destination", maxVia = GOOGLE_VIA): NavLeg[] {
  const legs: NavLeg[] = [];
  const st = plan.stations;
  if (plan.walkOnly || !st.length) { // "just walk there": no docks, one walk straight to the destination
    if (plan.walkToDock.geometry.length)
      legs.push({ kind: "walk", to: destination, toName: destinationName, atStop: true, minutes: plan.walkToDock.durationMin, meters: plan.walkToDock.distanceM, geometry: plan.walkToDock.geometry, via: [], final: true });
    return legs;
  }
  if (plan.walkToDock.geometry.length)
    legs.push({ kind: "walk", to: st[0], toName: st[0].name, atStop: true, minutes: plan.walkToDock.durationMin, meters: plan.walkToDock.distanceM, geometry: plan.walkToDock.geometry, via: [] });
  plan.rides.forEach((_, j) => legs.push(...rideLegs(plan, j, maxVia)));
  if (plan.walkFromDock.geometry.length)
    legs.push({ kind: "walk", to: destination, toName: destinationName, atStop: true, minutes: plan.walkFromDock.durationMin, meters: plan.walkFromDock.distanceM, geometry: plan.walkFromDock.geometry, via: [], final: true });
  else if (legs.length) legs[legs.length - 1].final = true;
  return legs;
}

const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/** Google Maps: bicycling or walking directions from where the rider is, started as turn-by-turn when they're at the start. */
export function googleLegUrl(leg: NavLeg, via: LatLng[] = leg.via): string {
  const q = [
    "api=1",
    `destination=${encodeURIComponent(ll(leg.to))}`,
    `travelmode=${leg.kind === "ride" ? "bicycling" : "walking"}`,
    "dir_action=navigate",
  ];
  if (via.length) q.push(`waypoints=${via.map((p) => encodeURIComponent(ll(p))).join("%7C")}`);
  return `https://www.google.com/maps/dir/?${q.join("&")}`;
}

/** Apple Maps (iOS 18.4 and later): cycling or walking directions with repeated waypoint parameters. */
export function appleLegUrl(leg: NavLeg, via: LatLng[] = leg.via): string {
  const q = [`destination=${ll(leg.to)}`, `mode=${leg.kind === "ride" ? "cycling" : "walking"}`];
  for (const p of via) q.push(`waypoint=${ll(p)}`);
  return `https://maps.apple.com/directions?${q.join("&")}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The whole trip as one GPX file: a track per leg (exact geometry) plus a waypoint for each dock. For OsmAnd, Komoot, Organic Maps, Garmin... */
export function planGpx(plan: Plan, legs: NavLeg[], title: string): string {
  const trk = legs
    .map((l, i) => {
      const pts = l.geometry.map(([la, lo]) => `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>`).join("");
      return `<trk><name>${esc(`${i + 1}. ${l.kind === "ride" ? "Ride" : "Walk"} to ${l.atStop ? l.toName : `${l.toName} (part ${l.part?.n})`}`)}</name><trkseg>${pts}</trkseg></trk>`;
    })
    .join("");
  const wpt = plan.stations.map((s) => `<wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><name>${esc(s.name)}</name></wpt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="BadgerGo" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(title)}</name></metadata>${wpt}${trk}</gpx>`;
}

/** Index of the leg to show after a location fix: moves on when the rider is at the end of the current leg. */
export function legAfterFix(legs: NavLeg[], index: number, pos: LatLng): number {
  return index < legs.length && haversine(pos, legs[index].to) <= ARRIVE_M ? index + 1 : index;
}
