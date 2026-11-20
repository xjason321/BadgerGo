import type { Station } from "./types";

interface InfoStation {
  station_id: string;
  name: string;
  address?: string;
  lat: number;
  lon: number;
  rental_uris?: { android?: string; ios?: string };
}
interface StatusStation {
  station_id: string;
  num_bikes_available: number;
  num_docks_available: number;
  is_renting?: number | boolean;
  is_returning?: number | boolean;
}

const truthy = (v: unknown) => v === undefined || v === 1 || v === true;
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const coord = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
/** Only https links from the feed are used (a javascript: or data: link would run in the page). */
const httpsOnly = (u: unknown) => {
  if (typeof u !== "string") return undefined;
  try { return new URL(u).protocol === "https:" ? u : undefined; } catch { return undefined; }
};
/** Feed text is shown on screen: keep it a plain, short string. */
const text = (v: unknown, max = 120) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** Join station_information (static) with station_status (live). */
export function joinStations(info: InfoStation[], status: StatusStation[]): Station[] {
  if (!Array.isArray(info) || !Array.isArray(status)) throw new Error("Unexpected dock data");
  const byId = new Map(status.filter((s) => s && typeof s.station_id === "string").map((s) => [s.station_id, s]));
  const out: Station[] = [];
  const seen = new Set<string>();
  for (const i of info) {
    // Anything malformed is skipped rather than allowed to break the map or the planner.
    if (!i || typeof i.station_id !== "string" || !i.station_id || seen.has(i.station_id)) continue;
    const s = byId.get(i.station_id);
    const lat = coord(i.lat, 90), lon = coord(i.lon, 180);
    if (!s || lat == null || lon == null) continue;
    seen.add(i.station_id);
    const uris = i.rental_uris && typeof i.rental_uris === "object" ? { android: httpsOnly(i.rental_uris.android), ios: httpsOnly(i.rental_uris.ios) } : undefined;
    out.push({
      id: i.station_id,
      name: text(i.name) || "BCycle dock",
      address: i.address == null ? undefined : text(i.address, 200),
      lat,
      lon,
      bikesAvailable: count(s.num_bikes_available),
      docksAvailable: count(s.num_docks_available),
      isRenting: truthy(s.is_renting),
      isReturning: truthy(s.is_returning),
      rentalUris: uris && (uris.android || uris.ios) ? uris : undefined,
    });
  }
  return out;
}

/** systemId e.g. "bcycle_madison". Feed docs: https://www.bcycle.com/gbfs */
export async function fetchStations(systemId: string, f: typeof fetch = (i, o) => fetch(i, o)): Promise<Station[]> {
  const base = `https://gbfs.bcycle.com/${systemId}`;
  const get = async (name: string) => {
    const r = await f(`${base}/${name}.json`);
    if (!r.ok) throw new Error(`Dock data failed (${r.status})`);
    return r.json();
  };
  const [info, status] = await Promise.all([get("station_information"), get("station_status")]);
  return joinStations(info?.data?.stations, status?.data?.stations);
}
