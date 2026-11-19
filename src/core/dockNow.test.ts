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

import { backupDocks } from "./dockNow";
describe("backupDocks", () => {
  const A = st("A", 43.07, -89.4, 3);
  const B = st("B", 43.08, -89.4, 3);
  const plan = { stations: [A, B] };
  const pool = [A, B, st("a2", 43.0715, -89.4, 1), st("a3", 43.0705, -89.4, 1), st("b2", 43.0812, -89.4, 4), st("bfar", 43.09, -89.4, 4)];
  it("picks the nearest unused dock with a bike near the pick-up, and one with a free dock near the drop-off", () => {
    const b = backupDocks(plan, pool);
    expect(b.pickup?.station.id).toBe("a3");
    expect(b.dropoff?.station.id).toBe("b2");
  });
  it("skips docks with nothing to give and docks too far away", () => {
    const empty = { ...st("e", 43.0701, -89.4, 1), bikesAvailable: 0 };
    expect(backupDocks(plan, [A, B, empty]).pickup).toBeNull();
    expect(backupDocks(plan, [A, B, st("bfar", 43.09, -89.4, 4)]).dropoff).toBeNull();
  });
  it("never suggests a dock the plan already uses", () => {
    expect(backupDocks({ stations: [A, B, st("mid", 43.075, -89.4, 2)] }, [A, B, st("mid", 43.075, -89.4, 2)]).pickup).toBeNull();
  });
});

import { hasBike, nearestBikes } from "./dockNow";
describe("nearestBikes", () => {
  const b = (id: string, lat: number, bikes: number, renting = true) => ({ ...st(id, lat, -89.4, 1), bikesAvailable: bikes, isRenting: renting });
  const pool = [b("far", 43.08, 5), b("near", 43.071, 2), b("empty", 43.0702, 0), b("closed", 43.0703, 6, false), b("mid", 43.074, 1)];
  it("lists the nearest docks that have a bike, skipping empty and non-renting ones", () => {
    expect(nearestBikes(here, pool).map((d) => d.station.id)).toEqual(["near", "mid", "far"]);
    expect(hasBike(pool[3])).toBe(false);
  });
  it("respects the limit and handles no bikes at all", () => {
    expect(nearestBikes(here, pool, 1)).toHaveLength(1);
    expect(nearestBikes(here, [b("e", 43.07, 0)])).toEqual([]);
  });
});
