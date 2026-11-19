import { describe, expect, it } from "vitest";
import { describePlans, protectedShare } from "./planNotes";
import type { Plan, Station } from "./types";

const st = (id: string) => ({ id, name: id.toUpperCase(), lat: 0, lon: 0 }) as unknown as Station;
const seg = (min: number) => ({ mode: "walk", durationMin: min, distanceM: 0, geometry: [] });
interface O { id: string; stops: string[]; total: number; ride?: number; cost?: number; walks?: [number, number]; protectedM?: number; walkOnly?: boolean }
const plan = (o: O): Plan => ({
  id: o.id, stations: o.stops.map(st), walkToDock: seg(o.walks?.[0] ?? 2), walkFromDock: seg(o.walks?.[1] ?? 2), rides: [], totalMinutes: o.total,
  rideMinutes: o.ride ?? o.total - 4, overageCost: o.cost ?? 0, walkOnly: o.walkOnly,
  roads: o.protectedM == null ? undefined : { breakdown: { totalM: 1000, byKind: [o.protectedM, 0, 0, 1000 - o.protectedM, 0, 0], unpavedM: 0 }, rides: [] },
}) as unknown as Plan;

describe("describePlans", () => {
  it("names what each route is best at", () => {
    const d = describePlans([plan({ id: "a", stops: ["a", "b"], total: 10, cost: 0 }), plan({ id: "b", stops: ["a", "b"], total: 14, cost: 8 })]);
    expect(d.a).toMatch(/^Fastest/);
    expect(d.b).not.toMatch(/Fastest/);
  });
  it("says which route is cheapest and most protected, and explains swaps", () => {
    const direct = plan({ id: "direct", stops: ["a", "b"], total: 12, cost: 8, protectedM: 300 });
    const swap = plan({ id: "swap", stops: ["a", "m", "b"], total: 16, cost: 0, protectedM: 800 });
    const d = describePlans([direct, swap]);
    expect(d.direct).toBe("Fastest · No swaps");
    expect(d.swap).toBe("Cheapest · Swaps at M");
  });
  it("names a dock only when it differs from the top route's", () => {
    const d = describePlans([plan({ id: "a", stops: ["x", "z"], total: 10 }), plan({ id: "b", stops: ["y", "z"], total: 10 }), plan({ id: "c", stops: ["x", "w"], total: 10 })]);
    expect(d.a).toBe("Direct");
    expect(d.b).toBe("Pick up at Y");
    expect(d.c).toBe("Drop off at W");
  });
  it("names both docks when both differ", () => {
    const d = describePlans([plan({ id: "a", stops: ["x", "z"], total: 10 }), plan({ id: "b", stops: ["y", "w"], total: 10 })]);
    expect(d.b).toBe("Pick up at Y · Drop off at W");
  });
  it("doesn't claim a win by a hair or on missing data", () => {
    const d = describePlans([plan({ id: "a", stops: ["a", "b"], total: 10.3, protectedM: 500 }), plan({ id: "b", stops: ["a", "b"], total: 10.6 })]);
    expect(d.a).toBe("Direct");
    expect(d.b).toBe("Direct");
  });
  it("never gives two routes the same description", () => {
    const d = describePlans([
      plan({ id: "a", stops: ["x", "z"], total: 10 }), plan({ id: "b", stops: ["y", "z"], total: 10 }), plan({ id: "c", stops: ["w", "z"], total: 10 }),
      plan({ id: "d", stops: ["y", "z"], total: 10, cost: 8 }),
    ]);
    expect(new Set(Object.values(d)).size).toBe(4);
    expect(d.d).toBe("Pick up at Y · +$8");
  });
  it("covers a single route and skips walk-only and custom routes", () => {
    expect(describePlans([plan({ id: "only", stops: ["a", "b"], total: 9 })])).toEqual({ only: "Direct" });
    expect(describePlans([plan({ id: "w", stops: [], total: 5, walkOnly: true }), plan({ id: "custom", stops: ["a", "b"], total: 5 })])).toEqual({});
  });
  it("measures how much of a route is on paths and protected lanes", () => {
    expect(protectedShare(plan({ id: "a", stops: ["a", "b"], total: 1, protectedM: 250 }))).toBeCloseTo(0.25);
    expect(protectedShare(plan({ id: "a", stops: ["a", "b"], total: 1 }))).toBeNull();
  });
});
