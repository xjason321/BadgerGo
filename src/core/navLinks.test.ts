import { describe, expect, it } from "vitest";
import { appleLegUrl, googleLegUrl, legAfterFix, navLegs, shapingAlongs, type NavLeg } from "./navLinks";
import type { Plan, Station } from "./types";

const st = (id: string, lat: number, lon: number) => ({ id, name: id, lat, lon }) as unknown as Station;
/** A straight ride east of `km` kilometres (about 1.3 km per 0.016 deg of longitude at Madison's latitude). */
const ride = (km: number): [number, number][] => Array.from({ length: 41 }, (_, i) => [43.07, -89.4 + (i / 40) * (km / 81.5)]);
const plan = (km: number, pathFrom?: number): Plan =>
  ({
    stations: [st("A", 43.07, -89.4), st("B", 43.07, -89.4 + km / 81.5)],
    walkToDock: { mode: "walk", durationMin: 2, distanceM: 150, geometry: [[43.0699, -89.4], [43.07, -89.4]] },
    rides: [{ mode: "bike", durationMin: 10, distanceM: km * 1000, geometry: ride(km) }],
    walkFromDock: { mode: "walk", durationMin: 3, distanceM: 200, geometry: [[43.07, -89.35], [43.0701, -89.35]] },
    roads: pathFrom == null ? undefined : { breakdown: {}, rides: [{ breakdown: {}, segments: [{ kind: 1, unpaved: false, geometry: ride(km).slice(0, 20) }, { kind: 0, unpaved: false, geometry: ride(km).slice(19) }] }] },
  }) as unknown as Plan;
const dest = { lat: 43.0701, lon: -89.35 };

describe("shapingAlongs", () => {
  it("adds nothing for a short stretch and the fewest points for a long one", () => {
    expect(shapingAlongs(600)).toEqual([]);
    expect(shapingAlongs(1400)).toHaveLength(1); // two pieces of 700
    expect(shapingAlongs(2800)).toHaveLength(3);
  });
  it("leaves no stretch longer than the gap and respects the slot cap", () => {
    const a = shapingAlongs(5000);
    const marks = [0, ...a, 5000];
    for (let i = 1; i < marks.length; i++) expect(marks[i] - marks[i - 1]).toBeLessThanOrEqual(700 + 1e-6);
    expect(shapingAlongs(50000, 12)).toHaveLength(12);
  });
  it("puts a point on a path section when one fits", () => {
    const a = shapingAlongs(1400, 12, [[300, 1100]]);
    expect(a[0]).toBeGreaterThan(300);
    expect(a[0]).toBeLessThan(1100);
  });
});

describe("navLegs", () => {
  it("keeps a short ride as one leg ending at the dock", () => {
    const legs = navLegs(plan(1), dest);
    const rides = legs.filter((l) => l.kind === "ride");
    expect(rides).toHaveLength(1);
    expect(rides[0].atStop).toBe(true);
    expect(rides[0].via.length).toBeLessThanOrEqual(3);
  });
  it("splits a long ride into parts of at most 3 waypoints, the last ending at the dock", () => {
    const legs = navLegs(plan(6), dest);
    const rides = legs.filter((l) => l.kind === "ride");
    expect(rides.length).toBeGreaterThan(1);
    rides.forEach((r) => expect(r.via.length).toBeLessThanOrEqual(3));
    expect(rides.slice(0, -1).every((r) => !r.atStop)).toBe(true);
    expect(rides[rides.length - 1].atStop).toBe(true);
    expect(rides[0].part).toEqual({ n: 1, of: rides.length });
    // the parts add back up to the whole ride
    expect(rides.reduce((a, r) => a + r.minutes, 0)).toBeCloseTo(10, 5);
  });
});

const leg: NavLeg = { kind: "ride", to: { lat: 43.0725, lon: -89.38 }, toName: "X", atStop: true, minutes: 5, meters: 1500, geometry: [], via: [{ lat: 43.071, lon: -89.4 }, { lat: 43.072, lon: -89.39 }] };

describe("links", () => {
  it("builds a Google Maps bicycling URL with encoded waypoints and no origin", () => {
    const u = googleLegUrl(leg);
    expect(u).toContain("travelmode=bicycling");
    expect(u).toContain("dir_action=navigate");
    expect(u).toContain("destination=43.072500%2C-89.380000");
    expect(u).toContain("waypoints=43.071000%2C-89.400000%7C43.072000%2C-89.390000");
    expect(u).not.toContain("origin=");
  });
  it("walking legs carry no waypoints", () => {
    expect(googleLegUrl({ ...leg, kind: "walk", via: [] })).not.toContain("waypoints");
    expect(appleLegUrl({ ...leg, kind: "walk", via: [] })).toContain("mode=walking");
  });
  it("builds an Apple Maps cycling URL with repeated waypoints", () => {
    const u = appleLegUrl(leg);
    expect(u).toContain("mode=cycling");
    expect((u.match(/waypoint=/g) ?? []).length).toBe(2);
  });
  it("advances when the rider is at the leg's end", () => {
    expect(legAfterFix([leg], 0, { lat: 43.0725, lon: -89.38 })).toBe(1);
    expect(legAfterFix([leg], 0, { lat: 43.08, lon: -89.38 })).toBe(0);
  });
});
