import { haversine } from "./geo";
import type { LatLng } from "./types";

/** Look this far along the route to work out which way it runs. */
const LOOK_M = 25;

const rad = (d: number) => (d * Math.PI) / 180;
/** Compass bearing from a to b, 0-360 (0 = north, 90 = east). */
export function bearing(a: LatLng, b: LatLng): number {
  const dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** A Google Street View link at a point, facing `heading` when given. Opens the Maps app on a phone. */
export function streetViewUrl(p: LatLng, heading?: number): string {
  const at = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  return heading == null ? at : `${at}&heading=${Math.round(heading) % 360}&pitch=0&fov=90`;
}

export interface View { point: LatLng; heading: number }

const pt = (g: [number, number]): LatLng => ({ lat: g[0], lon: g[1] });

/**
 * Where to look along a leg: at its start facing the way the route goes, and at its end facing
 * the way you arrive (so you see the dock or turn as you will). Null if the leg has no length.
 */
export function legViews(geometry: [number, number][]): { start: View; end: View } | null {
  if (geometry.length < 2) return null;
  const pts = geometry.map(pt);
  const first = pts[0], last = pts[pts.length - 1];
  if (haversine(first, last) < 1 && pts.length < 3) return null;
  const ahead = pts.find((p) => haversine(first, p) >= LOOK_M) ?? last;
  const behind = [...pts].reverse().find((p) => haversine(p, last) >= LOOK_M) ?? first;
  return { start: { point: first, heading: bearing(first, ahead) }, end: { point: last, heading: bearing(behind, last) } };
}

export const viewUrl = (v: View) => streetViewUrl(v.point, v.heading);
