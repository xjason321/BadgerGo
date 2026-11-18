import { VALHALLA_URL } from "../config";
import { haversine } from "./geo";
import type { Plan } from "./types";

/** One stretch of a trip in order, drawn under the elevation plot: walking is a grey dotted line, riding takes the bikeway's color. */
export interface ProfilePart {
  mode: "walk" | "bike";
  /** Index into KINDS (bike parts only; absent when road types aren't known). */
  kind?: number;
  unpaved?: boolean;
  geometry: [number, number][];
}

export interface Profile {
  totalM: number;
  /** Distance along the trip (m) and height (m), smoothed a little. */
  pts: { d: number; h: number }[];
  parts: { from: number; to: number; mode: "walk" | "bike"; kind?: number; unpaved?: boolean }[];
  /** Total climb and descent in metres. */
  gainM: number;
  lossM: number;
  minH: number;
  maxH: number;
}

/** The plan's route as ordered parts, walking and riding, exactly as the map draws them. */
export function planParts(plan: Plan): ProfilePart[] {
  const out: ProfilePart[] = [];
  const walk = (g?: [number, number][]) => { if (g && g.length > 1) out.push({ mode: "walk", geometry: g }); };
  walk(plan.walkToDock.geometry);
  plan.rides.forEach((ride, i) => {
    walk(ride.walkBefore?.geometry);
    const segs = plan.roads?.rides[i]?.segments;
    if (segs?.length) for (const s of segs) out.push({ mode: "bike", kind: s.kind, unpaved: s.unpaved, geometry: s.geometry });
    else out.push({ mode: "bike", geometry: ride.geometry });
    walk(ride.walkAfter?.geometry);
  });
  walk(plan.walkFromDock.geometry);
  return out.filter((p) => p.geometry.length > 1);
}

const lengthOf = (g: [number, number][]) => {
  let d = 0;
  for (let i = 1; i < g.length; i++) d += haversine({ lat: g[i - 1][0], lon: g[i - 1][1] }, { lat: g[i][0], lon: g[i][1] });
  return d;
};

/** Moving average over `w` neighbours each side; the raw heights are whole metres, which look stair-stepped. */
export function smooth(h: number[], w = 1): number[] {
  return h.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(h.length - 1, i + w); j++) { s += h[j]; n++; }
    return s / n;
  });
}

/** Total climb and descent of a height series, ignoring wiggles smaller than `min` metres. */
export function climb(h: number[], min = 0.75): { gain: number; loss: number } {
  let gain = 0, loss = 0, anchor = h[0] ?? 0;
  for (const v of h) {
    if (v - anchor >= min) { gain += v - anchor; anchor = v; }
    else if (anchor - v >= min) { loss += anchor - v; anchor = v; }
  }
  return { gain, loss };
}

const cache = new Map<string, Promise<Profile | null>>();

/**
 * Heights along the whole trip from the router's /height service (one request per plan), or null when the
 * server has no elevation data. The result is cached per route.
 */
export function fetchProfile(parts: ProfilePart[], f: typeof fetch = (i, o) => fetch(i, o), base: string = VALHALLA_URL): Promise<Profile | null> {
  if (!parts.length) return Promise.resolve(null);
  const shape: { lat: number; lon: number }[] = [];
  const bounds: { from: number; to: number; part: ProfilePart }[] = [];
  let at = 0;
  for (const p of parts) {
    const len = lengthOf(p.geometry);
    bounds.push({ from: at, to: at + len, part: p });
    at += len;
    for (const [lat, lon] of p.geometry) shape.push({ lat, lon });
  }
  const totalM = at;
  if (totalM < 5) return Promise.resolve(null);
  const key = `${base}|${shape.length}|${shape[0].lat},${shape[0].lon}|${shape[shape.length - 1].lat},${shape[shape.length - 1].lon}|${Math.round(totalM)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // The service takes the line as is and returns [distance, height] pairs every `resample_distance` metres.
  const step = Math.max(10, Math.round(totalM / 80));
  const keep = shape.length > 4000 ? shape.filter((_, i) => i % Math.ceil(shape.length / 4000) === 0 || i === shape.length - 1) : shape;
  const job = (async (): Promise<Profile | null> => {
    const res = await f(`${base}/height`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ shape: keep, range: true, resample_distance: step }),
    });
    if (!res.ok) return null;
    const data: { range_height?: [number, number | null][] } = await res.json();
    const raw = (data.range_height ?? []).filter((r): r is [number, number] => r[1] != null);
    if (raw.length < 2) return null;
    const srcTotal = raw[raw.length - 1][0] || totalM; // the service measures the line itself; line it up with ours
    const heights = smooth(raw.map((r) => r[1]));
    const { gain, loss } = climb(heights);
    return {
      totalM,
      pts: raw.map((r, i) => ({ d: (r[0] / srcTotal) * totalM, h: heights[i] })),
      parts: bounds.map((b) => ({ from: b.from, to: b.to, mode: b.part.mode, kind: b.part.kind, unpaved: b.part.unpaved })),
      gainM: gain,
      lossM: loss,
      minH: Math.min(...heights),
      maxH: Math.max(...heights),
    };
  })().catch(() => null);
  cache.set(key, job);
  return job;
}
