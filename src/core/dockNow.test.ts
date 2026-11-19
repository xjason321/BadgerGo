import { describe, expect, it } from "vitest";
import { canDock, fullReason, fullWarning, nearestOpenDocks } from "./dockNow";
import { googleDirectUrl, navLegs } from "./navLinks";
import type { Plan, Station } from "./types";

const st = (id: string, lat: number, lon: number, docks: number, returning = true) =>
  ({ id, name: id, lat, lon, bikesAvailable: 3, docksAvailable: docks, isRenting: true, isReturning: returning }) as Station;
// About 111 m per 0.001 degree of latitude.
const here = { lat: 43.07, lon: -89.4 };
const all = [st("far", 43.08, -89.4, 5), st("near", 43.071, -89.4, 2), st("full", 43.0702, -89.4, 0), st("closed", 43.0703, -89.4, 4, false), st("mid", 43.074, -89.4, 1)];

describe("nearestOpenDocks", () => {
  it("skips full and not-returning docks and sorts by distance", () => {
    expect(nearestOpenDocks(here, all).map((d) => d.station.id)).toEqual(["near", "mid", "far"]);
  });
  it("respects the limit and exclusion", () => {
    expect(nearestOpenDocks(here, all, { limit: 1 }).map((d) => d.station.id)).toEqual(["near"]);
    expect(nearestOpenDocks(here, all, { excludeId: "near" })[0].station.id).toBe("mid");
  });
  it("gives distances in metres", () => {
    const d = nearestOpenDocks(here, all)[0];
    expect(d.meters).toBeGreaterThan(100);
    expect(d.meters).toBeLessThan(125);
  });
  it("returns nothing when no dock is open", () => expect(nearestOpenDocks(here, [st("a", 43.07, -89.4, 0)])).toEqual([]));
});

describe("fullWarning", () => {
  it("is null for an open dock, an unknown dock or no dock", () => {
    expect(fullWarning("near", all)).toBeNull();
    expect(fullWarning("ghost", all)).toBeNull();
    expect(fullWarning(undefined, all)).toBeNull();
  });
  it("warns about a full dock and lists the closest open ones to it", () => {
    const w = fullWarning("full", all)!;
    expect(w.station.id).toBe("full");
    expect(w.alternatives.map((d) => d.station.id)).toEqual(["near", "mid"]);
    expect(fullReason(w.station)).toBe("has no free docks");
  });
  it("also warns when a dock isn't taking returns", () => {
    expect(fullWarning("closed", all)).not.toBeNull();
    expect(fullReason(all[3])).toBe("isn't taking returns");
    expect(canDock(all[3])).toBe(false);
  });
});

describe("links and legs", () => {
  it("builds bike directions to a dock", () => {
    expect(googleDirectUrl({ lat: 43.07, lon: -89.4 })).toBe("https://www.google.com/maps/dir/?api=1&destination=43.070000%2C-89.400000&travelmode=bicycling&dir_action=navigate");
    expect(googleDirectUrl({ lat: 43.07, lon: -89.4 }, "walking")).toContain("travelmode=walking");
  });
  it("tags the legs that end at a dock with its id", () => {
    const plan = {
      stations: [st("A", 43.07, -89.4, 1), st("B", 43.07, -89.39, 1)],
      walkToDock: { mode: "walk", durationMin: 1, distanceM: 50, geometry: [[43.0699, -89.4], [43.07, -89.4]] },
      rides: [{ mode: "bike", durationMin: 5, distanceM: 800, geometry: [[43.07, -89.4], [43.07, -89.39]] }],
      walkFromDock: { mode: "walk", durationMin: 1, distanceM: 50, geometry: [[43.07, -89.39], [43.0701, -89.39]] },
    } as unknown as Plan;
    const legs = navLegs(plan, { lat: 43.0701, lon: -89.39 }, "Dest");
    expect(legs.map((l) => l.dockId)).toEqual(["A", "B", undefined]);
  });
});
