import { haversine } from "./geo";
import type { RoadSegment } from "./types";

export interface UnpavedRun {
  /** Total length of the stretch, metres. */
  meters: number;
  /** The point halfway along the stretch, [lat, lon]. */
  mid: [number, number];
  /** The two route points either side of `mid`, in travel order. */
  from: [number, number];
  to: [number, number];
}

const pt = (p: [number, number]) => ({ lat: p[0], lon: p[1] });

/** Joins neighbouring unpaved segments of one ride into stretches and finds each stretch's midpoint. */
export function unpavedRuns(segments: RoadSegment[]): UnpavedRun[] {
  const runs: [number, number][][] = [];
  let cur: [number, number][] | null = null;
  for (const s of segments) {
    if (s.unpaved && s.geometry.length > 1) {
      if (!cur) runs.push((cur = []));
      cur.push(...(cur.length ? s.geometry.slice(1) : s.geometry));
    } else cur = null;
  }
  return runs.map((g) => {
    const lens = g.slice(1).map((p, i) => haversine(pt(g[i]), pt(p)));
    const meters = lens.reduce((a, b) => a + b, 0);
    let left = meters / 2;
    let i = 0;
    while (i < lens.length - 1 && left > lens[i]) left -= lens[i++];
    const t = lens[i] > 0 ? left / lens[i] : 0;
    const [a, b] = [g[i], g[i + 1]];
    return { meters, mid: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number], from: a, to: b };
  });
}
