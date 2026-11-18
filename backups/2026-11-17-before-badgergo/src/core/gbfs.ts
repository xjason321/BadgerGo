import type { Station } from "./types";

interface InfoStation { station_id: string; name: string; address?: string; lat: number; lon: number }
interface StatusStation {
  station_id: string;
  num_bikes_available: number;
  num_docks_available: number;
  is_renting?: number | boolean;
  is_returning?: number | boolean;
}

const truthy = (v: unknown) => v === undefined || v === 1 || v === true;

/** Join station_information (static) with station_status (live). */
export function joinStations(info: InfoStation[], status: StatusStation[]): Station[] {
  const byId = new Map(status.map((s) => [s.station_id, s]));
  const out: Station[] = [];
  for (const i of info) {
    const s = byId.get(i.station_id);
    if (!s) continue;
    out.push({
      id: i.station_id,
      name: i.name,
      address: i.address,
      lat: i.lat,
      lon: i.lon,
      bikesAvailable: s.num_bikes_available,
      docksAvailable: s.num_docks_available,
      isRenting: truthy(s.is_renting),
      isReturning: truthy(s.is_returning),
    });
  }
  return out;
}

/** systemId e.g. "bcycle_madison". Feed docs: https://www.bcycle.com/gbfs */
export async function fetchStations(systemId: string, f: typeof fetch = (i, o) => fetch(i, o)): Promise<Station[]> {
  const base = `https://gbfs.bcycle.com/${systemId}`;
  const [info, status] = await Promise.all([
    f(`${base}/station_information.json`).then((r) => r.json()),
    f(`${base}/station_status.json`).then((r) => r.json()),
  ]);
  return joinStations(info.data.stations, status.data.stations);
}
