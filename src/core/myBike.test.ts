import { describe, expect, it } from "vitest";
import { isMyBike, MY_BIKE_ID, myBikeStation, NO_WALK, startsOnBike } from "./myBike";
import { navLegs } from "./navLinks";
import { backupDocks } from "./dockNow";
import { buildCustomPlan, planRoutes } from "./planner";
import type { RoutingProvider } from "./routing";
import type { LatLng, Segment, Station } from "./types";

const distM = (a: LatLng, b: LatLng) => Math.hypot((b.lat - a.lat) * 111_000, (b.lon - a.lon) * 111_000 * 0.73);
const calls: { mode: string; from: LatLng; to: LatLng }[] = [];
const fake: RoutingProvider = {
  async route(mode, from, to): Promise<Segment[]> {
    calls.push({ mode, from, to });
    const d = distM(from, to);
    return [{ mode, distanceM: d, durationMin: d / (mode === "bike" ? 4 : 1.4) / 60, geometry: [[from.lat, from.lon], [to.lat, to.lon]] }];
  },
  async row(from, targets) { return targets.map((b) => distM(from, b) / 4 / 60); },
  async matrix(points) { return points.map((a) => points.map((b) => distM(a, b) / 4 / 60)); },
};
const st = (id: string, lat: number, lon: number, bikes = 3, docks = 3): Station => ({ id, name: id, lat, lon, bikesAvailable: bikes, docksAvailable: docks, isRenting: true, isReturning: true });

const origin = { lat: 43.0, lon: -89.0 };
const dest = { lat: 43.05, lon: -89.0 };
// Every dock near the start is empty: a normal search can't find a bike, but someone already riding doesn't need one.
const stations = [st("empty1", 43.001, -89.0, 0, 5), st("empty2", 43.002, -89.0, 0, 5), st("e1", 43.0499, -89.0), st("e2", 43.0505, -89.001)];

describe("starting with a bike", () => {
  it("normally has to walk to a dock that has a bike, since the ones near the start are empty", async () => {
    const [plan] = await planRoutes(origin, dest, stations, fake, { maxRideMinutes: 30 });
    expect(startsOnBike(plan)).toBe(false);
    expect(plan.walkToDock.durationMin).toBeGreaterThan(30);
  });

  it("plans from the rider's own spot with no pick-up dock and no walk to one", async () => {
    calls.length = 0;
    const plans = await planRoutes(origin, dest, stations, fake, { maxRideMinutes: 30, startWithBike: true });
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(startsOnBike(p)).toBe(true);
      expect(p.stations[0]).toMatchObject({ id: MY_BIKE_ID, lat: origin.lat, lon: origin.lon });
      expect(p.walkToDock).toEqual(NO_WALK);
      expect(p.rides.length).toBe(p.stations.length - 1);
      expect(p.totalMinutes).toBeCloseTo(p.rideMinutes + p.swapMinutes + p.walkFromDock.durationMin);
    }
    expect(calls.some((c) => c.mode === "walk" && c.to.lat === origin.lat && c.to.lon === origin.lon)).toBe(false);
  });

  it("still ends at a real drop-off dock with open spaces", async () => {
    const plans = await planRoutes(origin, dest, stations, fake, { maxRideMinutes: 30, startWithBike: true });
    for (const p of plans) {
      const last = p.stations[p.stations.length - 1];
      expect(isMyBike(last)).toBe(false);
      expect(last.docksAvailable).toBeGreaterThan(0);
    }
  });

  it("can still swap at real docks along the way", async () => {
    const far = { lat: 43.09, lon: -89.0 };
    const line = [...stations, st("m0", 43.03, -89.0), st("m1", 43.06, -89.0), st("end", 43.0895, -89.0)];
    const plans = await planRoutes(origin, far, line, fake, { maxRideMinutes: 20, startWithBike: true });
    expect(plans.some((p) => p.stations.length > 2)).toBe(true);
    expect(plans.every((p) => startsOnBike(p))).toBe(true);
  });

  it("builds custom routes without routing a walk to the stand-in", async () => {
    calls.length = 0;
    const plan = await buildCustomPlan(origin, dest, [myBikeStation(origin), stations[2]], fake, { maxRideMinutes: 30 });
    expect(plan.walkToDock).toEqual(NO_WALK);
    expect(calls.filter((c) => c.mode === "walk")).toHaveLength(1);
  });

  it("gives ride mode no walk leg to a pick-up", async () => {
    const [plan] = await planRoutes(origin, dest, stations, fake, { maxRideMinutes: 30, startWithBike: true });
    const legs = navLegs(plan, dest, "Dest");
    expect(legs[0].kind).toBe("ride");
    expect(legs.some((l) => l.toName === "Your bike")).toBe(false);
  });

  it("suggests no backup pick-up dock when you're already riding", async () => {
    const [plan] = await planRoutes(origin, dest, stations, fake, { maxRideMinutes: 30, startWithBike: true });
    expect(backupDocks(plan, [...stations, st("near", 43.0001, -89.0)]).pickup).toBeNull();
  });
});
