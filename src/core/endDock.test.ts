import { describe, expect, it } from "vitest";
import { becameRisky, countsFromStatus, countsOf, dockLevel, dockLine, DOCK_TAG, riskNote } from "./endDock";

const feed = (...stations: unknown[]) => ({ data: { stations } });
const st = (o: object = {}) => ({ station_id: "d1", num_bikes_available: 7, num_docks_available: 5, is_renting: 1, is_returning: 1, ...o });

describe("a station's numbers from the live feed", () => {
  it("reads the open docks and bikes of the station asked about", () => {
    expect(countsFromStatus(feed(st({ station_id: "other", num_docks_available: 0 }), st()), "d1")).toEqual({ bikes: 7, docks: 5 });
  });
  it("a dock that isn't taking returns has no usable docks, and one that isn't renting has no usable bikes", () => {
    expect(countsFromStatus(feed(st({ is_returning: 0 })), "d1")).toEqual({ bikes: 7, docks: 0 });
    expect(countsFromStatus(feed(st({ is_renting: false })), "d1")).toEqual({ bikes: 0, docks: 5 });
    expect(countsFromStatus(feed(st({ is_renting: undefined, is_returning: undefined })), "d1")).toEqual({ bikes: 7, docks: 5 }); // flags missing: assume yes, like the map
  });
  it("junk numbers count as none", () => {
    expect(countsFromStatus(feed(st({ num_bikes_available: -3, num_docks_available: "5" })), "d1")).toEqual({ bikes: 0, docks: 0 });
    expect(countsFromStatus(feed(st({ num_docks_available: 2.9 })), "d1")?.docks).toBe(2);
  });
  it("null when the station or the feed isn't there", () => {
    expect(countsFromStatus(feed(st()), "nope")).toBeNull();
    for (const bad of [null, undefined, {}, { data: {} }, { data: { stations: "x" } }, "text", 5]) expect(countsFromStatus(bad, "d1")).toBeNull();
    expect(countsFromStatus(feed(null, 5, "x"), "d1")).toBeNull();
  });
  it("counts what the app's station data has, the same way", () => {
    expect(countsOf({ bikesAvailable: 4, docksAvailable: 3, isRenting: true, isReturning: false })).toEqual({ bikes: 4, docks: 0 });
  });
});

describe("how it reads in a notification", () => {
  it("says open docks and bikes, singular or plural", () => {
    expect(dockLine("Capitol Square", { bikes: 7, docks: 5 })).toBe("Capitol Square: 5 open docks, 7 bikes");
    expect(dockLine("Union South", { bikes: 1, docks: 1 })).toBe("Union South: 1 open dock, 1 bike");
    expect(dockLine("Union South", { bikes: 0, docks: 0 })).toBe("Union South: 0 open docks, 0 bikes");
  });
});

describe("when the dock gets risky", () => {
  it("uses the app's levels: 3 or more open docks is safe, 1 or 2 is few, 0 is none", () => {
    expect([5, 3, 2, 1, 0].map((docks) => dockLevel({ bikes: 9, docks }))).toEqual(["ok", "ok", "low", "low", "none"]);
  });
  it("only a fall from safe counts", () => {
    expect(becameRisky("ok", "low")).toBe(true);
    expect(becameRisky("ok", "none")).toBe(true);
    expect(becameRisky("ok", "ok")).toBe(false);
    expect(becameRisky("low", "none")).toBe(false); // already risky
    expect(becameRisky("low", "low")).toBe(false);
    expect(becameRisky("none", "ok")).toBe(false);
    expect(becameRisky(null, "low")).toBe(false); // nothing to compare with yet
  });
  it("the warning names the dock and the number, on its own tag", () => {
    expect(riskNote("Capitol Square", { bikes: 3, docks: 2 })).toEqual({ tag: DOCK_TAG, title: "Only 2 open docks left at Capitol Square", body: expect.stringContaining("risky") });
    expect(riskNote("Capitol Square", { bikes: 3, docks: 1 }).title).toBe("Only 1 open dock left at Capitol Square");
    expect(riskNote("Capitol Square", { bikes: 3, docks: 0 }).title).toBe("No open docks at Capitol Square");
  });
});
