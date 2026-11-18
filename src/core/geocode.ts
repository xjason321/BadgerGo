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

/** Nominatim reverse lookup: a short address for a point, or null. */
export async function reverseGeocode(
  lat: number,
  lon: number,
  f: typeof fetch = (i, o) => fetch(i, o),
): Promise<string | null> {
  const p = new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", zoom: "18" });
  const res = await f(`https://nominatim.openstreetmap.org/reverse?${p}`);
  if (!res.ok) return null;
  const r: { name?: string; address?: Record<string, string>; display_name?: string } = await res.json();
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  return r.name || street || r.display_name?.split(",").slice(0, 2).join(",") || null;
}

export interface PlaceSuggestion {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

/**
 * Type-ahead place search (restaurants, shops, addresses...) from Photon, an OpenStreetMap search made for autocomplete.
 * Results are kept inside the given box, with the nearest to its middle first.
 */
export async function suggestPlaces(
  query: string,
  box: [number, number, number, number],
  opts: { limit?: number; signal?: AbortSignal } = {},
  f: typeof fetch = (i, o) => fetch(i, o),
): Promise<PlaceSuggestion[]> {
  const p = new URLSearchParams({
    q: query,
    limit: String(opts.limit ?? 6),
    lang: "en",
    lat: String((box[1] + box[3]) / 2),
    lon: String((box[0] + box[2]) / 2),
    bbox: box.join(","),
  });
  const res = await f(`https://photon.komoot.io/api/?${p}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const j: { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[] } = await res.json();
  return (j.features ?? [])
    .map((ft) => {
      const pr = ft.properties;
      const street = [pr.housenumber, pr.street].filter(Boolean).join(" ");
      const name = pr.name || street;
      const address = [pr.name ? street : "", pr.city || pr.county].filter(Boolean).join(", ");
      return { name: name ?? "", address, lat: ft.geometry.coordinates[1], lon: ft.geometry.coordinates[0] };
    })
    .filter((x) => x.name);
}
