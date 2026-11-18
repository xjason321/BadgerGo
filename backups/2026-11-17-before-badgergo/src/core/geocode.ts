import type { Place } from "./types";

export interface GeocodeOptions {
  /** [west, south, east, north] viewbox to bias results. */
  viewbox?: [number, number, number, number];
  limit?: number;
}

/** Nominatim search. Public instance: max ~1 req/sec, so call on submit, not per keystroke. */
export async function geocode(
  query: string,
  opts: GeocodeOptions = {},
  f: typeof fetch = (i, o) => fetch(i, o),
): Promise<Place[]> {
  const p = new URLSearchParams({ q: query, format: "jsonv2", limit: String(opts.limit ?? 5) });
  if (opts.viewbox) {
    p.set("viewbox", opts.viewbox.join(","));
    p.set("bounded", "0");
  }
  const res = await f(`https://nominatim.openstreetmap.org/search?${p}`);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const rows: { lat: string; lon: string; display_name: string }[] = await res.json();
  return rows.map((r) => ({ lat: +r.lat, lon: +r.lon, label: r.display_name }));
}
