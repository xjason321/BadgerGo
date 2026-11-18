import { VALHALLA_URL } from "../config";
import { classifyEdge, isUnpaved, KINDS, type TraceEdge } from "./bikeways";
import { haversine } from "./geo";
import { decodePolyline } from "./polyline";
import { NoRouteError, type RoutingProvider } from "./routing";
import type { LatLng, Plan, PlanRoads, RideRoads, RoadBreakdown, RoadSegment, Segment } from "./types";

export const emptyBreakdown = (): RoadBreakdown => ({ totalM: 0, byKind: KINDS.map(() => 0), unpavedM: 0 });

/**
 * Classify matched edges and group consecutive ones of the same kind into map segments.
 * `shape` is the matched path the edges' shape indices point into.
 */
export function analyzeEdges(edges: TraceEdge[], shape: [number, number][]): RideRoads {
  const breakdown = emptyBreakdown();
  const segments: RoadSegment[] = [];
  let prev = KINDS.length - 1;
  for (const e of edges) {
    const m = (e.length ?? 0) * 1000;
    const kind = classifyEdge(e, prev);
    prev = kind;
    if (m) {
      breakdown.byKind[kind] += m;
      breakdown.totalM += m;
      if (isUnpaved(e)) breakdown.unpavedM += m;
    }
    const b = e.begin_shape_index;
    const en = e.end_shape_index;
    if (b == null || en == null || en <= b) continue;
    const pts = shape.slice(b, en + 1);
    const unpaved = isUnpaved(e);
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && last.unpaved === unpaved) last.geometry.push(...pts.slice(1));
    else segments.push({ kind, unpaved, geometry: pts });
  }
  return { breakdown, segments };
}

export function mergeBreakdowns(list: RoadBreakdown[]): RoadBreakdown {
  const out = emptyBreakdown();
  for (const b of list) {
    out.totalM += b.totalM;
    out.unpavedM += b.unpavedM;
    b.byKind.forEach((m, k) => (out.byKind[k] += m));
  }
  return out;
}

/** Metres on bikeways less separated from traffic than `level` (an index into KINDS). */
export const exposureM = (b: RoadBreakdown, level: number) =>
  b.byKind.reduce((sum, m, k) => (k > level ? sum + m : sum), 0);

const cache = new Map<string, Promise<RideRoads>>();

/** Look up road types for an encoded (polyline6) bike route. Valhalla only. */
export function rideRoads(
  shape: string,
  f: typeof fetch = (i, o) => fetch(i, o),
  baseUrl: string = VALHALLA_URL,
): Promise<RideRoads> {
  const key = `${baseUrl}|${shape}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchRoads(shape, f, baseUrl);
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // don't remember failures
  }
  return p;
}

async function fetchRoads(shape: string, f: typeof fetch, baseUrl: string): Promise<RideRoads> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await f(`${baseUrl}/trace_attributes`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // keeps it a simple CORS request
      signal: ctl.signal,
      body: JSON.stringify({
        encoded_polyline: shape,
        costing: "bicycle",
        shape_match: "map_snap",
        filters: {
          attributes: [
            "shape",
            "edge.length",
            "edge.use",
            "edge.surface",
            "edge.cycle_lane",
            "edge.shoulder",
            "edge.begin_shape_index",
            "edge.end_shape_index",
          ],
          action: "include",
        },
      }),
    });
    if (!res.ok) throw new Error(`Road lookup failed (${res.status})`);
    const data = await res.json();
    return analyzeEdges(data.edges ?? [], data.shape ? decodePolyline(data.shape) : []);
  } finally {
    clearTimeout(timer);
  }
}

/** Road types for every ride of a plan. Throws if the plan has no Valhalla shapes. */
export async function analyzePlan(plan: Plan, f?: typeof fetch, baseUrl?: string): Promise<PlanRoads> {
  if (plan.rides.some((r) => !r.shape)) throw new Error("No road data for this router");
  const rides = await Promise.all(plan.rides.map((r) => rideRoads(r.shape!, f, baseUrl)));
  return { breakdown: mergeBreakdowns(rides.map((r) => r.breakdown)), rides };
}

/** Stretches shorter than this are ignored by the hard block (a street you have to cross, a dock's own block). */
const MIN_BLOCKED_M = 60;
const MAX_ROUNDS = 5;
const END_GRACE_M = 150;
const SAMPLE_EVERY_M = 80;

const segLength = (g: [number, number][]) =>
  g.slice(1).reduce((m, p, i) => m + haversine({ lat: g[i][0], lon: g[i][1] }, { lat: p[0], lon: p[1] }), 0);

/**
 * Points along every stretch of the ride on a kind above `level`, to exclude from the next routing
 * attempt. The first and last `graceM` of the ride are exempt (a dock sits on whatever street it
 * sits on, and that edge can't be avoided), and so are stretches under MIN_BLOCKED_M.
 */
export function offendingPoints(segments: RoadSegment[], level: number, graceM = END_GRACE_M): LatLng[] {
  const total = segments.reduce((m, s) => m + segLength(s.geometry), 0);
  const pts: LatLng[] = [];
  let at = 0; // distance along the ride at the start of the current segment
  for (const s of segments) {
    const g = s.geometry;
    const run: { p: LatLng; d: number }[] = [];
    let d = at;
    g.forEach((v, i) => {
      if (i) d += haversine({ lat: g[i - 1][0], lon: g[i - 1][1] }, { lat: v[0], lon: v[1] });
      if (d >= graceM && d <= total - graceM) run.push({ p: { lat: v[0], lon: v[1] }, d });
    });
    at = d;
    if (s.kind <= level || run.length < 2) continue;
    if (run[run.length - 1].d - run[0].d < MIN_BLOCKED_M) continue;
    let last = -Infinity;
    for (const r of run) {
      if (r.d - last >= SAMPLE_EVERY_M) {
        pts.push(r.p);
        last = r.d;
      }
    }
  }
  return pts;
}

/**
 * Hard-block bikeways less separated than `level`: route, look at what the ride uses, exclude the
 * offending road edges, and route again, until the ride is clean. Throws NoRouteError if it can't be.
 */
export function strictRefiner(provider: RoutingProvider, level: number, f?: typeof fetch, baseUrl?: string) {
  return async (first: Segment, from: LatLng, to: LatLng): Promise<Segment> => {
    let seg = first;
    const excluded: LatLng[] = [];
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      if (!seg.shape) throw new Error("Can't enforce a hard block: the main router is unavailable.");
      const { segments } = await rideRoads(seg.shape, f, baseUrl);
      const bad = offendingPoints(segments, level);
      if (!bad.length) return seg;
      if (round === MAX_ROUNDS) break;
      excluded.push(...bad);
      try {
        const r = await provider.route("bike", from, to, false, excluded.slice(-45));
        if (!r.length) break;
        seg = r[0];
      } catch (e) {
        if (e instanceof NoRouteError) break;
        throw e;
      }
    }
    throw new NoRouteError(`No route avoids ${KINDS[Math.min(level + 1, KINDS.length - 1)].label.toLowerCase()} and less separated types. Move the slider toward "−" or turn off the hard block.`);
  };
}
