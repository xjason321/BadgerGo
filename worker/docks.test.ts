import { describe, expect, it } from "vitest";
import { SYSTEM_ID as APP_SYSTEM_ID } from "../src/config";
import { fetchDockCounts, SYSTEM_ID } from "./docks";

const feed = { data: { stations: [{ station_id: "d1", num_bikes_available: 4, num_docks_available: 2, is_renting: 1, is_returning: 1 }] } };
const answer = (res: () => Response | Promise<Response>) => ((async (url: string) => { seen.push(url); return res(); }) as unknown as typeof fetch);
const seen: string[] = [];

describe("live dock numbers", () => {
  it("reads BCycle Madison's station status", async () => {
    seen.length = 0;
    expect(await fetchDockCounts("d1", answer(() => Response.json(feed)))).toEqual({ bikes: 4, docks: 2 });
    expect(seen).toEqual(["https://gbfs.bcycle.com/bcycle_madison/station_status.json"]);
  });
  it("is the same city as the app", () => expect(SYSTEM_ID).toBe(APP_SYSTEM_ID));
  it("null when it can't tell: station missing, feed down, garbage, no network", async () => {
    expect(await fetchDockCounts("zzz", answer(() => Response.json(feed)))).toBeNull();
    expect(await fetchDockCounts("d1", answer(() => new Response("nope", { status: 503 })))).toBeNull();
    expect(await fetchDockCounts("d1", answer(() => new Response("<html>", { status: 200 })))).toBeNull();
    expect(await fetchDockCounts("d1", answer(() => { throw new TypeError("offline"); }))).toBeNull();
  });
});
