// Live dock numbers for the Timers Durable Object: BCycle's public GBFS feed (the same one the app reads).
import { countsFromStatus, type DockCounts } from "../src/core/endDock";

/** The same city as SYSTEM_ID in src/config.ts (a test keeps them equal; that file reads Vite settings so the Worker can't import it). */
export const SYSTEM_ID = "bcycle_madison";
const STATUS_URL = `https://gbfs.bcycle.com/${SYSTEM_ID}/station_status.json`;

/** Open docks and bikes at one station right now, or null when the feed can't be read. Cloudflare keeps the feed for 30 s, so all riders share one fetch. */
export async function fetchDockCounts(id: string, f: typeof fetch = fetch): Promise<DockCounts | null> {
  try {
    const r = await f(STATUS_URL, { signal: AbortSignal.timeout(5000), cf: { cacheTtl: 30, cacheEverything: true } } as RequestInit);
    return r.ok ? countsFromStatus(await r.json(), id) : null;
  } catch { return null; }
}
