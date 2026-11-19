import { describe, expect, it } from "vitest";
import { ago, loadStations, MAX_AGE_MS, readStations, saveStations } from "./stationCache";
import type { Station } from "./types";

const mem = () => { const m: Record<string, string> = {}; return { m, s: { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } } }; };
const st = { id: "a", name: "A", lat: 1, lon: 2, bikesAvailable: 3, docksAvailable: 4, isRenting: true, isReturning: true } as Station;
const feed = (docks = [{ station_id: "a", name: "A", lat: 1, lon: 2 }], status = [{ station_id: "a", num_bikes_available: 3, num_docks_available: 4, is_renting: 1, is_returning: 1 }]) =>
  (async (u: string) => ({ ok: true, json: async () => ({ data: { stations: String(u).includes("information") ? docks : status } }) })) as unknown as typeof fetch;
const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;

describe("station cache", () => {
  it("round-trips and expires", () => {
    const { s } = mem();
    saveStations([st], 1000, s);
    expect(readStations(2000, s)?.stations).toHaveLength(1);
    expect(readStations(1000 + MAX_AGE_MS + 1, s)).toBeNull();
  });
  it("ignores junk or empty data", () => {
    const { m, s } = mem();
    m["badgergo.stations"] = "{bad"; expect(readStations(1, s)).toBeNull();
    saveStations([], 1000, s); expect(readStations(2000, s)).toBeNull();
  });
  it("loads from the network and remembers it", async () => {
    const { s } = mem();
    const r = await loadStations("sys", feed(), () => 5000, s);
    expect(r.cachedAt).toBeUndefined();
    expect(r.stations[0].id).toBe("a");
    expect(readStations(6000, s)?.at).toBe(5000);
  });
  it("falls back to the saved docks when offline, saying when they were saved", async () => {
    const { s } = mem();
    saveStations([st], 4000, s);
    const r = await loadStations("sys", down, () => 9000, s);
    expect(r.cachedAt).toBe(4000);
    expect(r.stations).toHaveLength(1);
  });
  it("still fails when offline with nothing saved", async () => {
    await expect(loadStations("sys", down, () => 1, mem().s)).rejects.toThrow("Failed to fetch");
  });
  it("describes age", () => {
    expect(ago(0, 20_000)).toBe("just now");
    expect(ago(0, 5 * 60_000)).toBe("5 min ago");
    expect(ago(0, 3 * 3600_000)).toBe("3 h ago");
  });
});
