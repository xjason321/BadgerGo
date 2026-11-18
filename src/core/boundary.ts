import { BOUNDARY_OSM_ID } from "../config";

type LL = [number, number]; // [lat, lon]
export interface Boundary {
  /** Outer rings (one per piece of the city). */
  outer: LL[][];
  /** Holes: areas inside the outer rings that are not part of the city. */
  holes: LL[][];
}

interface GeoJson { type: string; coordinates: any }

/** GeoJSON Polygon/MultiPolygon -> rings in [lat, lon]. */
export function parseBoundary(g: GeoJson): Boundary {
  const polys: number[][][][] = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  const ring = (r: number[][]): LL[] => r.map(([lon, lat]) => [lat, lon]);
  const out: Boundary = { outer: [], holes: [] };
  for (const poly of polys) {
    poly.forEach((r, i) => (i === 0 ? out.outer : out.holes).push(ring(r)));
  }
  return out;
}

/**
 * Rings for one polygon that covers the whole map except the city. With even-odd filling, the
 * world rectangle is filled, each outer ring cuts a hole, and each of the city's own holes fills back in.
 */
export function maskRings(b: Boundary): LL[][] {
  const world: LL[] = [[-85, -360], [-85, 360], [85, 360], [85, -360]];
  return [world, ...b.outer, ...b.holes];
}

const KEY = (id: string) => `badgergo.boundary.v1.${id}`;

/** Fetch the city limits once from OpenStreetMap (Nominatim) and remember them in this browser. */
export async function loadBoundary(
  id: string = BOUNDARY_OSM_ID,
  f: typeof fetch = (i, o) => fetch(i, o),
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
): Promise<Boundary | null> {
  if (!id) return null;
  try {
    const cached = storage?.getItem(KEY(id));
    if (cached) return JSON.parse(cached) as Boundary;
  } catch {
    /* unreadable cache: fetch again */
  }
  const p = new URLSearchParams({ osm_ids: id, format: "json", polygon_geojson: "1", polygon_threshold: "0.0003" });
  const res = await f(`https://nominatim.openstreetmap.org/lookup?${p}`);
  if (!res.ok) throw new Error(`Boundary lookup failed (${res.status})`);
  const rows: { geojson?: GeoJson }[] = await res.json();
  const g = rows[0]?.geojson;
  if (!g) return null;
  const b = parseBoundary(g);
  try {
    storage?.setItem(KEY(id), JSON.stringify(b));
  } catch {
    /* storage full or blocked: fine */
  }
  return b;
}
