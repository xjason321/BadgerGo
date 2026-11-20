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

describe("free routes", () => {
  it("labels the quickest route that costs nothing when a faster one doesn't", () => {
    const d = describePlans([plan({ id: "quick", stops: ["a", "b"], total: 10, cost: 8 }), plan({ id: "free1", stops: ["a", "c"], total: 13, cost: 0 }), plan({ id: "free2", stops: ["a", "d"], total: 16, cost: 0 })]);
    expect(d.quick).toMatch(/^Fastest/);
    expect(d.free1).toMatch(/^Fastest that's free/);
    expect(d.free2).not.toMatch(/free/i);
  });
  it("calls a lone free route the only free one", () => {
    const d = describePlans([plan({ id: "quick", stops: ["a", "b"], total: 10, cost: 8 }), plan({ id: "free", stops: ["a", "c"], total: 13, cost: 0 })]);
    expect(d.free).toMatch(/^Only free route/);
  });
  it("adds nothing when the fastest route is already free, or everything is", () => {
    const d1 = describePlans([plan({ id: "a", stops: ["a", "b"], total: 10 }), plan({ id: "b", stops: ["a", "c"], total: 13, cost: 8 })]);
    expect(d1.a).toMatch(/^Fastest/);
    expect(d1.a).not.toMatch(/free/i);
    const d2 = describePlans([plan({ id: "a", stops: ["a", "b"], total: 10 }), plan({ id: "b", stops: ["a", "c"], total: 13 })]);
    expect(Object.values(d2).join()).not.toMatch(/free/i);
  });
});

describe("describePlans", () => {
  it("names what each route is best at", () => {
    const d = describePlans([plan({ id: "a", stops: ["a", "b"], total: 10, cost: 0 }), plan({ id: "b", stops: ["a", "b"], total: 14, cost: 8 })]);
    expect(d.a).toMatch(/^Fastest/);
    expect(d.b).not.toMatch(/Fastest/);
  });
  it("labels the lone free route and explains swaps", () => {
    const direct = plan({ id: "direct", stops: ["a", "b"], total: 12, cost: 8, protectedM: 300 });
    const swap = plan({ id: "swap", stops: ["a", "m", "b"], total: 16, cost: 0, protectedM: 800 });
    const d = describePlans([direct, swap]);
    expect(d.direct).toBe("Fastest · No swaps");
    expect(d.swap).toBe("Only free route · Swaps at M");
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

describe("without swaps (cost hidden)", () => {
  const plans = () => [plan({ id: "quick", stops: ["a", "b"], total: 10, cost: 8 }), plan({ id: "free1", stops: ["a", "c"], total: 13, cost: 0 }), plan({ id: "free2", stops: ["a", "d"], total: 16, cost: 0 })];
  it("never mentions free, cheapest or dollar amounts", () => {
    const d = describePlans(plans(), { showCost: false });
    expect(Object.values(d).join(" | ")).not.toMatch(/free|cheap|\$/i);
    expect(d.quick).toMatch(/^Fastest/);
  });
  it("still tells identical routes apart, by minutes", () => {
    const d = describePlans([plan({ id: "x", stops: ["a", "b"], total: 10, cost: 8 }), plan({ id: "y", stops: ["a", "b"], total: 14, cost: 8 })], { showCost: false });
    expect(d.x).not.toBe(d.y);
    expect(Object.values(d).join()).not.toMatch(/\$/);
  });
  it("keeps cost wording by default", () => {
    expect(describePlans(plans()).free1).toMatch(/free/i);
  });
});
