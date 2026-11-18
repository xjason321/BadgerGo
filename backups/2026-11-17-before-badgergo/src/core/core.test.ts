import { describe, expect, it } from "vitest";
import { joinStations } from "./gbfs";
import { planRoutes } from "./planner";
import { overageCost } from "./pricing";
import { bicycleCosting } from "./prefs";
import { decodePolyline } from "./polyline";
import { analyzeEdges, exposureM, offendingPoints } from "./roads";
import { corridorDocks, loopCandidate, nextStops, rankPlans, trafficExposure } from "./planner";
import { FallbackProvider, NoRouteError, OsrmProvider, ValhallaProvider, type RoutingProvider } from "./routing";
import { DEFAULT_PREFS, STUDENT_PLAN, type LatLng, type Segment, type Station } from "./types";

describe("overageCost (student plan: 30 min free, $8 per extra 30)", () => {
  it.each([
    [0, 0], [29.9, 0], [30, 0], [30.1, 8], [60, 8], [60.1, 16], [90, 16], [90.5, 24],
  ])("%d min -> $%d", (min, cost) => expect(overageCost(min, STUDENT_PLAN)).toBe(cost));
});

describe("joinStations", () => {
  it("joins info and status, drops unmatched, defaults flags", () => {
    const out = joinStations(
      [
        { station_id: "a", name: "A", lat: 1, lon: 2 },
        { station_id: "b", name: "B", lat: 3, lon: 4 },
      ],
      [{ station_id: "a", num_bikes_available: 4, num_docks_available: 2, is_renting: 1, is_returning: 0 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", bikesAvailable: 4, isRenting: true, isReturning: false });
  });
});

const st = (id: string, lat: number, lon: number, bikes = 3, docks = 3): Station => ({
  id, name: id, lat, lon, bikesAvailable: bikes, docksAvailable: docks, isRenting: true, isReturning: true,
});

/** Fake provider: straight lines; bike 4 m/s, walk 1.4 m/s. */
const distM = (a: LatLng, b: LatLng) => Math.hypot((b.lat - a.lat) * 111_000, (b.lon - a.lon) * 111_000 * 0.73);
const fake: RoutingProvider = {
  async route(mode, from: LatLng, to: LatLng): Promise<Segment[]> {
    const d = distM(from, to);
    return [{
      mode, distanceM: d, durationMin: d / (mode === "bike" ? 4 : 1.4) / 60,
      geometry: [[from.lat, from.lon], [to.lat, to.lon]],
    }];
  },
  async row(from, targets) {
    return targets.map((b) => distM(from, b) / 4 / 60);
  },
  async matrix(points) {
    return points.map((a) => points.map((b) => distM(a, b) / 4 / 60));
  },
};

describe("planRoutes", () => {
  const stations = [
    st("empty", 43.0001, -89.0, 0, 5), // no bikes: must not be a start
    st("s1", 43.001, -89.0),
    st("s2", 43.002, -89.0),
    st("e1", 43.05, -89.0),
    st("full", 43.0501, -89.0, 5, 0), // no docks: must not be an end
  ];
  const origin = { lat: 43.0, lon: -89.0 };
  const dest = { lat: 43.0502, lon: -89.0 };

  it("only uses docks with bikes at start and open docks at end", async () => {
    const plans = await planRoutes(origin, dest, stations, fake, { maxRideMinutes: 30 });
    for (const p of plans) {
      expect(p.stations[0].bikesAvailable).toBeGreaterThan(0);
      expect(p.stations[p.stations.length - 1].docksAvailable).toBeGreaterThan(0);
    }
  });

  it("throws a clear error when nothing is rentable", async () => {
    await expect(
      planRoutes(origin, dest, [st("x", 43, -89, 0, 0)], fake, { maxRideMinutes: 30 }),
    ).rejects.toThrow(/available bikes/);
  });

  describe("trip longer than the limit", () => {
    // ~13 km straight north = ~55 min direct on the fake bike.
    const far = { lat: 43.12, lon: -89.0 };
    const base = [
      st("start", 43.001, -89.0),
      st("end", 43.119, -89.0),
      st("onLine", 43.06, -89.0), // ~27 min each way
      st("offLine", 43.06, -89.03), // ~2.4 km off the line, ~29 min each way
      st("tooFar", 43.06, -88.9), // ~8 km off the line: legs would exceed 30 min
    ];

    it("docks midway so every ride fits and is free", async () => {
      const plans = await planRoutes(origin, far, base, fake, { maxRideMinutes: 30 });
      const best = plans[0];
      expect(best.withinLimit).toBe(true);
      expect(best.overageCost).toBe(0);
      expect(best.stations.map((s) => s.id)).toEqual(["start", "onLine", "end"]);
      for (const r of best.rides) expect(r.durationMin).toBeLessThanOrEqual(30);
      expect(best.longestRideMinutes).toBeLessThanOrEqual(30);
    });

    it("picks the swap dock with the smallest detour", async () => {
      const plans = await planRoutes(origin, far, base, fake, { maxRideMinutes: 30 });
      const swapIds = plans.filter((p) => p.withinLimit).map((p) => p.stations[1].id);
      expect(swapIds[0]).toBe("onLine");
      expect(swapIds).not.toContain("tooFar");
      const best = plans[0];
      const offLine = plans.find((p) => p.stations[1]?.id === "offLine");
      if (offLine) expect(offLine.detourMinutes).toBeGreaterThan(best.detourMinutes);
      expect(best.detourMinutes).toBeLessThan(5); // swap time + a hair, not a different route
    });

    it("still lists the straight-through ride with its price for comparison", async () => {
      const plans = await planRoutes(origin, far, base, fake, { maxRideMinutes: 30 });
      const direct = plans.find((p) => p.stations.length === 2)!;
      expect(direct).toBeDefined();
      expect(direct.withinLimit).toBe(false);
      expect(direct.overageCost).toBe(8);
      expect(plans.indexOf(direct)).toBeGreaterThan(0);
    });

    it("never swaps when swaps are disallowed", async () => {
      const plans = await planRoutes(origin, far, base, fake, { maxRideMinutes: 30, maxSwaps: 0 });
      expect(plans.every((p) => p.stations.length === 2)).toBe(true);
      expect(plans[0].withinLimit).toBe(false);
    });

    it("chains two swaps when one is not enough", async () => {
      // ~20 km (~83 min): three rides of ~27 min, so two swaps at a 30 min limit.
      const veryFar = { lat: 43.18, lon: -89.0 };
      const line = [
        st("a", 43.001, -89.0), st("m1", 43.06, -89.0), st("m2", 43.12, -89.0), st("b", 43.179, -89.0),
      ];
      const one = await planRoutes(origin, veryFar, line, fake, { maxRideMinutes: 30, maxSwaps: 1 });
      expect(one[0].withinLimit).toBe(false);
      const two = await planRoutes(origin, veryFar, line, fake, { maxRideMinutes: 30, maxSwaps: 2 });
      expect(two[0].withinLimit).toBe(true);
      expect(two[0].stations.map((s) => s.id)).toEqual(["a", "m1", "m2", "b"]);
    });

    it("has no swap cap: a short limit on a long trip chains as many docks as it takes", async () => {
      // ~13 km (~55 min) with a dock every ~2.2 km (~9 min) and a 10 min limit: needs 5 swaps.
      const dense = Array.from({ length: 7 }, (_, i) => st(`d${i}`, 43.001 + i * 0.02, -89.0));
      const plans = await planRoutes(origin, { lat: 43.121, lon: -89.0 }, dense, fake, { maxRideMinutes: 10 });
      expect(plans[0].withinLimit).toBe(true);
      expect(plans[0].stations.length).toBeGreaterThanOrEqual(6);
      for (const r of plans[0].rides) expect(r.durationMin).toBeLessThanOrEqual(10);
    });

    it("the verification pass finds a faster chain the quick search missed", async () => {
      // Starve the quick search (one lookup per pick-up dock) so it only ever sees the over-limit direct ride.
      const quick = await planRoutes(origin, far, base, fake, { maxRideMinutes: 30, maxExpansions: 1, verifySwaps: 0 });
      expect(quick.some((p) => p.withinLimit)).toBe(false);
      const checked = await planRoutes(origin, far, base, fake, { maxRideMinutes: 30, maxExpansions: 1 });
      expect(checked[0].withinLimit).toBe(true);
      expect(checked[0].stations.map((s) => s.id)).toEqual(["start", "onLine", "end"]);
    });

    it("prunes: tries few docks, not every combination", async () => {
      const dock = Array.from({ length: 60 }, (_, i) => st(`p${i}`, 43.001 + (i % 20) * 0.006, -89.0 + Math.floor(i / 20) * 0.004));
      let rows = 0;
      const counting: RoutingProvider = { ...fake, row: async (f, t) => { rows++; return fake.row(f, t); } };
      const plans = await planRoutes(origin, { lat: 43.12, lon: -89.0 }, dock, counting, { maxRideMinutes: 12 });
      expect(plans[0].withinLimit).toBe(true);
      expect(rows).toBeLessThanOrEqual(3 * 40); // 3 pick-up docks x the expansion budget
      expect(rows).toBeLessThan(60); // far fewer than one lookup per dock
    });

    it("won't swap at a dock with no open spaces", async () => {
      const full = base.map((s) => (s.id === "onLine" ? { ...s, docksAvailable: 0 } : s));
      const plans = await planRoutes(origin, far, full, fake, { maxRideMinutes: 30 });
      expect(plans.some((p) => p.stations.some((s) => s.id === "onLine" && p.stations.length > 2))).toBe(false);
    });
  });
});

describe("walking shortcut", () => {
  const m = (north: number, east: number): [number, number] => [43 + north / 111_000, -89 + east / (111_000 * Math.cos((43 * Math.PI) / 180))];
  const dock = { lat: 43, lon: -89 };
  it("finds the point where a ride loops back near its start", () => {
    // out 150 m east, up 60 m, back 150 m west to a point 60 m north of the dock, then on north
    const geom = [m(0, 0), m(0, 75), m(0, 150), m(30, 150), m(60, 150), m(60, 75), m(60, 0), m(160, 0), m(260, 0)];
    const c = loopCandidate(geom, dock)!;
    expect(c).not.toBeNull();
    expect(c.point.lat).toBeGreaterThan(43.0004); // 60+ m north
    expect(c.alongM).toBeGreaterThan(300);
  });
  it("ignores a ride that heads straight away", () => {
    expect(loopCandidate([m(0, 0), m(100, 0), m(200, 0), m(300, 0)], dock)).toBeNull();
  });
});

describe("corridor docks", () => {
  it("spreads picks along the trip even when docks bunch up at the start", () => {
    const mk = (id: string, lat: number, lon: number): Station => ({ id, name: id, lat, lon, isRenting: true, isReturning: true, bikesAvailable: 5, docksAvailable: 5 });
    const crowd = Array.from({ length: 30 }, (_, i) => mk(`c${i}`, 43.072 + i * 0.0002, -89.399));
    const mid = mk("mid", 43.105, -89.388);
    const picked = corridorDocks([...crowd, mid], { lat: 43.07, lon: -89.4 }, { lat: 43.13, lon: -89.37 }, new Set(), 14).map((s) => s.id);
    expect(picked).toContain("mid");
  });
});

describe("next stops", () => {
  const mk = (id: string, lat: number, lon: number): Station => ({ id, name: id, lat, lon, isRenting: true, isReturning: true, bikesAvailable: 5, docksAvailable: 5 });
  it("prefers docks near where the limit runs out, not the crowd next to the start", () => {
    const from = mk("from", 43.07, -89.4);
    const dest = { lat: 43.2, lon: -89.4 };
    const crowd = Array.from({ length: 30 }, (_, i) => mk(`c${i}`, 43.0705 + i * 0.0001, -89.4)); // right next to the start
    const far = mk("far", 43.115, -89.4); // ~5 km on: about 20 minutes of riding
    const picked = nextStops(from, dest, [...crowd, far], 25, 5).map((s) => s.id);
    expect(picked[0]).toBe("far");
  });
  it("skips docks that go backwards, are full, or are out of reach", () => {
    const from = mk("from", 43.07, -89.4);
    const dest = { lat: 43.2, lon: -89.4 };
    const ok = mk("ok", 43.1, -89.4);
    const back = mk("back", 43.05, -89.4);
    const full = { ...mk("full", 43.11, -89.4), docksAvailable: 0 };
    const tooFar = mk("tooFar", 43.19, -89.4); // ~13 km: over 25 min even in a straight line
    const picked = nextStops(from, dest, [ok, back, full, tooFar], 25, 5).map((s) => s.id);
    expect(picked).toEqual(["ok"]);
  });
});

describe("decodePolyline", () => {
  it("decodes the reference example (precision 5)", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [38.5, -120.2], [40.7, -120.95], [43.252, -126.453],
    ]);
  });
});

describe("road preferences", () => {
  it("maps the traffic level and other prefs to Valhalla costing", () => {
    const c = bicycleCosting({ traffic: 0, strict: false, unpaved: "avoid", hills: "avoid" }).bicycle;
    expect(c.use_roads).toBe(0);
    expect(c.avoid_bad_surfaces).toBe(1);
    expect(c.use_hills).toBeLessThan(0.3);
    const d = bicycleCosting({ traffic: 5, strict: false, unpaved: "ok", hills: "ok" }).bicycle;
    expect(d.use_roads).toBe(1);
    expect(d.avoid_bad_surfaces).toBe(0);
    const levels = [0, 1, 2, 3, 4, 5].map((t) => bicycleCosting({ ...DEFAULT_PREFS, traffic: t }).bicycle.use_roads);
    expect([...levels].sort((x, y) => x - y)).toEqual(levels);
    expect(bicycleCosting(DEFAULT_PREFS).bicycle.bicycle_type).toBe("Hybrid");
  });

  const shape: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]];
  const edges = [
    { length: 1, use: "cycleway", surface: "paved_smooth", begin_shape_index: 0, end_shape_index: 1 },
    { length: 1, use: "road", cycle_lane: "separated", begin_shape_index: 1, end_shape_index: 2 },
    { length: 1, use: "road", cycle_lane: "dedicated", begin_shape_index: 2, end_shape_index: 3 },
    { length: 1, use: "road", cycle_lane: "none", shoulder: true, begin_shape_index: 3, end_shape_index: 4 },
    { length: 0.5, use: "pedestrian_crossing", begin_shape_index: 4, end_shape_index: 5 }, // inherits shoulder
    { length: 1, use: "path", surface: "gravel", begin_shape_index: 5, end_shape_index: 6 },
  ];

  it("classifies edges into bikeway kinds and tracks unpaved", () => {
    const { breakdown: b } = analyzeEdges(edges, shape);
    expect(b.byKind[0]).toBeCloseTo(2000); // cycleway + gravel path
    expect(b.byKind[2]).toBeCloseTo(1000);
    expect(b.byKind[3]).toBeCloseTo(1000);
    expect(b.byKind[4]).toBeCloseTo(1500);
    expect(b.unpavedM).toBeCloseTo(1000);
    expect(b.totalM).toBeCloseTo(5500);
    expect(exposureM(b, 3)).toBeCloseTo(1500); // shoulders+shared are "closer than bike lane"
  });

  it("builds map segments, merging neighbours of the same kind", () => {
    const { segments } = analyzeEdges(edges, shape);
    expect(segments.map((s) => [s.kind, s.unpaved])).toEqual([[0, false], [2, false], [3, false], [4, false], [4, false], [0, true]]
      .filter((_, i) => i !== 4));
    expect(segments[3].geometry).toEqual([[0, 3], [0, 4], [0, 5]]);
  });

  it("hard block: ignores short stretches and the first/last 150 m of a ride", () => {
    const line = (a: number, b: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let m = a; m < b; m += 20) out.push([43 + m / 111_000, -89]);
      out.push([43 + b / 111_000, -89]);
      return out;
    };
    // metres along the ride: 0-40 shared (dock), 40-500 bike lane, 500-550 shared (short), 550-900 lane,
    // 900-1300 shared (long, mid-ride), 1300-1400 lane
    const segs = [
      { kind: 5, unpaved: false, geometry: line(0, 40) },
      { kind: 3, unpaved: false, geometry: line(40, 500) },
      { kind: 5, unpaved: false, geometry: line(500, 550) },
      { kind: 3, unpaved: false, geometry: line(550, 900) },
      { kind: 5, unpaved: false, geometry: line(900, 1300) },
      { kind: 3, unpaved: false, geometry: line(1300, 1400) },
    ];
    const pts = offendingPoints(segs, 3);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    for (const p of pts) {
      const m = (p.lat - 43) * 111_000;
      expect(m).toBeGreaterThanOrEqual(900); // only the long mid-ride stretch
      expect(m).toBeLessThanOrEqual(1300);
    }
    expect(offendingPoints(segs, 5)).toEqual([]);
    // a ride that is only a short shared stretch near its dock is fine
    expect(offendingPoints([{ kind: 5, unpaved: false, geometry: line(0, 200) }], 3)).toEqual([]);
  });

  it("ranks cleaner routes first among equals and reports exposure", () => {
    const mk = (id: string, shared: number): any => ({
      id, stations: [{}, {}], withinLimit: true, overageCost: 0, totalMinutes: id === "fast" ? 10 : 12,
      roads: { breakdown: { totalM: 1000, byKind: [1000 - shared, 0, 0, 0, 0, shared], unpavedM: 0 }, rides: [] },
    });
    const ranked = rankPlans([mk("fast", 600), mk("calm", 0)], 3);
    expect(ranked[0].id).toBe("calm");
    expect(trafficExposure(ranked[1], 3)?.share).toBeCloseTo(0.6);
    expect(rankPlans([mk("fast", 600), mk("calm", 0)])[0].id).toBe("fast"); // no level: time decides
  });
});

describe("providers call fetch without a bad `this`", () => {
  it("OsrmProvider default fetch (browser 'Illegal invocation')", async () => {
    const real = globalThis.fetch;
    let thisArg: unknown = "unset";
    globalThis.fetch = async function (this: unknown) {
      thisArg = this;
      return new Response(JSON.stringify({
        code: "Ok",
        routes: [{ duration: 600, distance: 2000, geometry: { coordinates: [[-89, 43], [-89.1, 43.1]] } }],
      }));
    } as typeof fetch;
    try {
      const r = await new OsrmProvider().route("bike", { lat: 43, lon: -89 }, { lat: 43.1, lon: -89.1 }, true);
      expect(thisArg === undefined || thisArg === globalThis).toBe(true);
      expect(r[0]).toMatchObject({ mode: "bike", durationMin: 10, geometry: [[43, -89], [43.1, -89.1]] });
    } finally { globalThis.fetch = real; }
  });

  it("ValhallaProvider matrix batches into <=100-pair requests and reassembles", async () => {
    const real = globalThis.fetch;
    const sizes: number[] = [];
    globalThis.fetch = async function (this: unknown, _url: unknown, init?: RequestInit) {
      expect(this === undefined || this === globalThis).toBe(true);
      const q = JSON.parse(String(init!.body));
      sizes.push(q.sources.length * q.targets.length);
      const rows = q.sources.map((s: LatLng, i: number) =>
        q.targets.map((t: LatLng, j: number) => ({
          from_index: i, to_index: j, time: Math.abs(s.lat - t.lat) * 6000, // 0.01 deg = 60 s
        })),
      );
      return new Response(JSON.stringify({ sources_to_targets: rows }));
    } as typeof fetch;
    try {
      const pts = Array.from({ length: 23 }, (_, i) => ({ lat: 43 + i * 0.01, lon: -89 }));
      const m = await new ValhallaProvider(DEFAULT_PREFS).matrix(pts);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
      expect(m).toHaveLength(23);
      expect(m[0][22]).toBeCloseTo(22, 5); // 22 * 0.01 deg -> 22 min
      expect(m[22][3]).toBeCloseTo(19, 5);
      expect(m[5][5]).toBe(0);
    } finally { globalThis.fetch = real; }
  });
});

describe("FallbackProvider", () => {
  const down: RoutingProvider = {
    route: async () => { throw new Error("Routing timed out"); },
    row: async () => { throw new Error("Routing timed out"); },
    matrix: async () => { throw new Error("Routing timed out"); },
  };
  it("uses the backup when the main router is down, and remembers why", async () => {
    const p = new FallbackProvider(down, fake);
    const r = await p.route("bike", { lat: 43, lon: -89 }, { lat: 43.001, lon: -89 }, false);
    expect(r).toHaveLength(1);
    expect(p.fellBack).toBe(true);
    expect(p.reason).toMatch(/timed out/);
  });
  it("sends walking straight to the backup without touching the main router", async () => {
    let primaryCalls = 0;
    const counting: RoutingProvider = { ...down, route: async () => { primaryCalls++; throw new Error("x"); } };
    const p = new FallbackProvider(counting, fake);
    await p.route("walk", { lat: 43, lon: -89 }, { lat: 43.001, lon: -89 }, false);
    expect(primaryCalls).toBe(0);
    expect(p.fellBack).toBe(false);
  });
  it("does not fall back when the router answered 'no route'", async () => {
    const noRoute: RoutingProvider = { ...down, route: async () => { throw new NoRouteError("none"); } };
    const p = new FallbackProvider(noRoute, fake);
    await expect(p.route("bike", { lat: 43, lon: -89 }, { lat: 43.1, lon: -89 }, false)).rejects.toThrow("none");
    expect(p.fellBack).toBe(false);
  });
});

describe("dock snapping", () => {
  it("bike routes (not walks) let the router pick any street within a radius of each dock", async () => {
    const bodies: any[] = [];
    const f = (async (_u: unknown, o: any) => {
      bodies.push(JSON.parse(o.body));
      return new Response(JSON.stringify({ trip: { summary: { time: 600, length: 1 }, legs: [{ shape: "" }] } }));
    }) as unknown as typeof fetch;
    const v = new ValhallaProvider(DEFAULT_PREFS, f, "http://x");
    await v.route("bike", { lat: 43.01, lon: -89.01 }, { lat: 43.02, lon: -89.02 }, false);
    await v.route("walk", { lat: 43.03, lon: -89.03 }, { lat: 43.04, lon: -89.04 }, false);
    expect(bodies[0].locations.map((l: any) => l.radius)).toEqual([30, 30]);
    expect(bodies[1].locations.map((l: any) => l.radius)).toEqual([undefined, undefined]);
  });
});

describe("ValhallaProvider failures", () => {
  it("times out / retries once on network errors, then throws a plain error", async () => {
    let calls = 0;
    const f = (async () => { calls++; throw new TypeError("Failed to fetch"); }) as typeof fetch;
    await expect(new ValhallaProvider(DEFAULT_PREFS, f).route("bike", { lat: 43, lon: -89 }, { lat: 43.1, lon: -89 }, false))
      .rejects.toThrow(/unreachable/);
    expect(calls).toBe(2);
  });
});
