import { SWAP_MINUTES } from "../config";
import { haversine } from "./geo";
import { overageCost } from "./pricing";
import { exposureM } from "./roads";
import { RIDE_SPEED_KPH } from "../config";
import type { RoutingProvider } from "./routing";
import { STUDENT_PLAN, type LatLng, type Plan, type PricingPlan, type Segment, type Station } from "./types";

export interface PlanOptions {
  /** Longest single ride between docks you want, in minutes. */
  maxRideMinutes: number;
  /** Most docks to swap bikes at on the way (0 = one ride only). Default: no limit; the search stops when it can't improve. */
  maxSwaps?: number;
  pricing?: PricingPlan;
  /** How many nearby docks to consider for pick-up and drop-off. */
  candidatesPerEnd?: number;
  /** How many on-the-way docks to try as the next stop from each dock. */
  swapCandidates?: number;
  /** Cap on dock-to-dock timing requests per pick-up dock; protects the routing server. */
  maxExpansions?: number;
  /**
   * After the quick search, also check every combination of up to this many swaps among the docks
   * near the trip, and keep anything faster (default 2; 0 turns the check off).
   */
  verifySwaps?: number;
  /** Pick-up and drop-off docks further than this walk away are skipped (unless none are closer). */
  maxWalkMinutes?: number;
  /** How many plans to return. */
  maxPlans?: number;
  /** Time for docking and re-renting at a swap stop. */
  swapMinutes?: number;
  /** Multiplies provider ride time (e.g. 0.8 if e-bikes beat the routing profile's speed). */
  rideTimeFactor?: number;
  /**
   * Called with each real ride before it is used. Return a replacement (e.g. re-routed to avoid
   * something) or throw to drop every plan that uses this ride.
   */
  refineRide?: (ride: Segment, from: LatLng, to: LatLng) => Promise<Segment>;
}

export function nearestStations(
  stations: Station[],
  to: LatLng,
  k: number,
  usable: (s: Station) => boolean,
  exclude?: Set<string>,
): Station[] {
  return stations
    .filter((s) => usable(s) && !exclude?.has(s.id))
    .map((s) => ({ s, d: haversine(s, to) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.s);
}

const RIDE_M_PER_MIN = (RIDE_SPEED_KPH * 1000) / 60;
/**
 * Docks near the line from start to end, spread along the whole trip (best few per tenth of it)
 * rather than the overall closest to the line, since docks bunch up downtown.
 */
export function corridorDocks(
  stations: Station[],
  origin: LatLng,
  destination: LatLng,
  exclude: Set<string>,
  max: number,
): Station[] {
  const direct = haversine(origin, destination);
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  const dx = (destination.lon - origin.lon) * cosLat;
  const dy = destination.lat - origin.lat;
  const len2 = dx * dx + dy * dy || 1;
  const scored = stations
    .filter((s) => s.isReturning && s.docksAvailable > 0 && !exclude.has(s.id))
    .map((s) => ({
      s,
      t: ((s.lon - origin.lon) * cosLat * dx + (s.lat - origin.lat) * dy) / len2, // 0 = start, 1 = end
      detour: haversine(origin, s) + haversine(s, destination) - direct,
    }))
    .filter((x) => x.t > 0.05 && x.t < 0.95)
    .sort((a, b) => a.detour - b.detour);
  const BUCKETS = 10;
  const perBucket = Math.max(1, Math.floor(max / BUCKETS));
  const count = new Array(BUCKETS).fill(0);
  const chosen: typeof scored = [];
  for (const x of scored) {
    const bk = Math.min(BUCKETS - 1, Math.floor(x.t * BUCKETS));
    if (count[bk] < perBucket && chosen.length < max) {
      count[bk]++;
      chosen.push(x);
    }
  }
  for (const x of scored) if (chosen.length < max && !chosen.includes(x)) chosen.push(x);
  return chosen.map((x) => x.s);
}

/** Real roads wind: a ride is roughly this much longer than the straight line. */
const ROAD_FACTOR = 1.35;

/**
 * Where is your limit likely to run out? About `limit` minutes of riding from `from` toward
 * `to` (straight line, allowing for winding roads). The docks nearest that point, among those
 * you can reach in time and that get you meaningfully closer, are the best next swap stops.
 */
export function nextStops(
  from: Station,
  to: LatLng,
  stations: Station[],
  limitMin: number,
  k: number,
): Station[] {
  const toDest = haversine(from, to);
  const reachM = (limitMin * RIDE_M_PER_MIN) / ROAD_FACTOR;
  const f = toDest ? Math.min(1, reachM / toDest) : 0;
  const target = { lat: from.lat + (to.lat - from.lat) * f, lon: from.lon + (to.lon - from.lon) * f };
  return stations
    .filter(
      (c) =>
        c.id !== from.id &&
        c.isReturning &&
        c.docksAvailable > 0 &&
        haversine(c, to) < toDest - 100 && // must make progress
        haversine(from, c) / RIDE_M_PER_MIN <= limitMin, // can't be faster than a straight line
    )
    .map((c) => ({ c, d: haversine(c, target) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.c);
}

/** Only look for a walking shortcut within this much of the ride's start/end. */
const SHORTCUT_MAX_ALONG_M = 400;
/** A ride must wander at least this much further than the straight line to be worth a look. */
const SHORTCUT_MIN_EXCESS_M = 80;
/** Walking the bike must save at least this long to be used. */
const SHORTCUT_MIN_SAVE_MIN = 0.2;

/**
 * Where, near the start of a ride, does the route loop around (one-way streets, no turns) such
 * that a point further along is much closer in a straight line than by the route? Returns that
 * point, or null. `geom` runs away from `end`.
 */
export function loopCandidate(geom: [number, number][], end: LatLng): { point: LatLng; alongM: number } | null {
  let along = 0;
  let best: { point: LatLng; alongM: number; excess: number } | null = null;
  for (let i = 1; i < geom.length; i++) {
    along += haversine({ lat: geom[i - 1][0], lon: geom[i - 1][1] }, { lat: geom[i][0], lon: geom[i][1] });
    if (along > SHORTCUT_MAX_ALONG_M) break;
    const point = { lat: geom[i][0], lon: geom[i][1] };
    const straight = haversine(end, point);
    const excess = along - straight * 1.3;
    if (along >= 60 && straight <= 300 && excess >= SHORTCUT_MIN_EXCESS_M && (!best || excess > best.excess)) {
      best = { point, alongM: along, excess };
    }
  }
  return best && { point: best.point, alongM: best.alongM };
}

/** Rough walking time used only to rank candidates before real routes are fetched. */
const walkEstimate = (a: LatLng, b: LatLng) => (haversine(a, b) * 1.3) / 1.35 / 60;

interface Chain {
  /** Pick-up, swaps..., drop-off. */
  path: Station[];
  legs: number[];
  cost: number;
  withinLimit: boolean;
  /** Walk estimates + rides + swaps. Used for ranking only. */
  score: number;
}

/**
 * Suggest walk -> ride -> (swap -> ride)* -> walk plans.
 *
 * Docking ends a ride and starts a fresh clock, so a trip longer than your limit can be split at
 * docks on the way, as many as it takes. From each pick-up dock we search outward: ask the router
 * how long it takes to reach the docks near where your limit would run out (and the drop-off
 * docks), and continue from the ones that fit. States are tried most-promising first (time so
 * far plus a straight-line estimate of what's left), and dropped as soon as they can't beat what
 * we've already found, or when a dock was already reached sooner some other way.
 */
export async function planRoutes(
  origin: LatLng,
  destination: LatLng,
  stations: Station[],
  provider: RoutingProvider,
  opts: PlanOptions,
): Promise<Plan[]> {
  const k = opts.candidatesPerEnd ?? 3;
  const maxSwaps = opts.maxSwaps ?? Infinity;
  const maxPlans = opts.maxPlans ?? 6;
  const swapMin = opts.swapMinutes ?? SWAP_MINUTES;
  const pricing = opts.pricing ?? STUDENT_PLAN;
  const factor = opts.rideTimeFactor ?? 1;
  const limit = opts.maxRideMinutes;
  const fanout = opts.swapCandidates ?? 6;
  const budget = opts.maxExpansions ?? 40;

  const maxWalk = opts.maxWalkMinutes ?? 20;
  // The k nearest usable docks, dropping any that are an unreasonable walk away.
  const near = (to: LatLng, usable: (s: Station) => boolean) => {
    const all = nearestStations(stations, to, k, usable);
    const close = all.filter((s) => walkEstimate(to, s) <= maxWalk);
    return close.length ? close : all;
  };
  const starts = near(origin, (s) => s.isRenting && s.bikesAvailable > 0);
  const ends = near(destination, (s) => s.isReturning && s.docksAvailable > 0);
  if (!starts.length) throw new Error("No docks with available bikes found.");
  if (!ends.length) throw new Error("No docks with open spaces found.");
  const endIds = new Set(ends.map((e) => e.id));

  // Bike minutes from a dock to its next-stop candidates plus every drop-off dock (cached per dock).
  const rowCache = new Map<string, Promise<Map<string, number>>>();
  const timesFrom = (dock: Station) => {
    let p = rowCache.get(dock.id);
    if (!p) {
      const stops = nextStops(dock, destination, stations, limit, fanout);
      const targets = [...stops, ...ends.filter((e) => e.id !== dock.id && !stops.some((s) => s.id === e.id))];
      p = provider.row(dock, targets).then((row) => {
        const out = new Map<string, number>();
        targets.forEach((t, i) => {
          if (row[i] != null) out.set(t.id, row[i]! * factor);
        });
        return out;
      });
      rowCache.set(dock.id, p);
      p.catch(() => rowCache.delete(dock.id));
    }
    return p.then((times) => ({ times, stops: [...times.keys()].map((id) => byId.get(id)!) }));
  };
  const byId = new Map(stations.map((s) => [s.id, s]));

  const directTimes = new Map<string, number>(); // `${start}>${end}` -> minutes
  const directs: Chain[] = [];
  const found: Chain[] = [];
  const visited = new Map<string, Station>(); // every dock the quick search considered stopping at
  const SLACK_MIN = 3; // keep near-equal alternatives, drop anything clearly worse

  const search = async (start: Station) => {
    let expansions = 0;
    const bestG = new Map<string, number>([[start.id, 0]]);
    const bestPerEnd = new Map<string, Chain>();
    let bestTotal = Infinity;
    const h = (d: LatLng) => haversine(d, destination) / RIDE_M_PER_MIN;
    interface State { dock: Station; g: number; path: Station[]; legs: number[] }
    const open: State[] = [{ dock: start, g: 0, path: [start], legs: [] }];
    // Time so far + estimate of what's left. Order by a deliberately pessimistic estimate (W > 1,
    // "weighted A*"): it favours states that have got further along, so the search runs toward
    // the destination instead of fanning out sideways among near-equal docks. The pruning bound
    // below uses the plain optimistic estimate.
    const W = 1.6;
    const priority = (s: State) => s.g + W * h(s.dock);
    const optimistic = (s: State) => s.g + h(s.dock);
    const walkIn = walkEstimate(origin, start);

    while (open.length && expansions < budget) {
      open.sort((a, b) => priority(a) - priority(b));
      const cur = open.shift()!;
      if (walkIn + optimistic(cur) > bestTotal + SLACK_MIN) continue; // can't beat what we have
      expansions++;
      const { times } = await timesFrom(cur.dock);
      for (const [id, t] of times) {
        const to = byId.get(id)!;
        if (cur.path.some((p) => p.id === id)) continue;
        const fits = t <= limit;
        const isEnd = endIds.has(id);
        const first = cur.path.length === 1;
        if (isEnd) {
          if (first) directTimes.set(`${start.id}>${id}`, t);
          if (fits || first) {
            const legs = [...cur.legs, t];
            const path = [...cur.path, to];
            const swapsUsed = path.length - 2;
            const total = legs.reduce((a, b) => a + b, 0) + swapsUsed * swapMin;
            const chain: Chain = {
              path,
              legs,
              cost: legs.reduce((c, l) => c + overageCost(l, pricing), 0),
              withinLimit: legs.every((l) => l <= limit),
              score: walkIn + total + walkEstimate(to, destination),
            };
            if (first) directs.push(chain);
            if (!first || chain.withinLimit) {
              const prev = bestPerEnd.get(id);
              if (!prev || chain.score < prev.score) bestPerEnd.set(id, chain);
              if (chain.withinLimit) bestTotal = Math.min(bestTotal, chain.score);
            }
          }
        }
        // Continue from here as a swap stop (the ride must fit; the dock must not be a drop-off).
        if (!isEnd && fits && cur.path.length <= maxSwaps) {
          const g = cur.g + t + swapMin;
          if (g >= (bestG.get(id) ?? Infinity) - 1e-9) continue; // reached sooner another way
          const next: State = { dock: to, g, path: [...cur.path, to], legs: [...cur.legs, t] };
          if (walkIn + optimistic(next) > bestTotal + SLACK_MIN) continue; // can't beat what we have
          bestG.set(id, g);
          visited.set(id, to);
          open.push(next);
        }
      }
    }
    found.push(...bestPerEnd.values());
  };
  for (const s of starts) await search(s);

  const rank = (a: Chain, b: Chain) =>
    Number(b.withinLimit) - Number(a.withinLimit) || a.cost - b.cost || a.score - b.score;

  // Check: is there a faster route the quick search missed? Try every combination of up to
  // `verifySwaps` swaps among the docks it visited plus those near the line, all timed in one
  // matrix. Anything that beats (or newly offers) a pick-up/drop-off pair replaces it.
  const verify = Math.min(opts.verifySwaps ?? 2, maxSwaps);
  if (verify > 0) {
    try {
      const skip = new Set([...starts, ...ends].map((x) => x.id));
      const pool = new Map<string, Station>();
      for (const v of visited.values()) if (!skip.has(v.id)) pool.set(v.id, v);
      for (const c of corridorDocks(stations, origin, destination, skip, 14)) pool.set(c.id, c);
      const nodes = [...starts, ...ends.filter((e) => !starts.includes(e)), ...pool.values()];
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      const T = (await provider.matrix(nodes)).map((row) => row.map((v) => (v == null ? null : v * factor)));
      const mid = [...pool.values()].map((n) => idx.get(n.id)!);
      const walkIn = (s: Station) => walkEstimate(origin, s);
      const best = new Map<string, Chain>();
      const consider = (ids: number[]) => {
        const legs: number[] = [];
        for (let i = 1; i < ids.length; i++) {
          const t = T[ids[i - 1]][ids[i]];
          if (t == null || t > limit) return;
          legs.push(t);
        }
        const path = ids.map((i) => nodes[i]);
        const last = path[path.length - 1];
        const chain: Chain = {
          path,
          legs,
          cost: 0,
          withinLimit: true,
          score: walkIn(path[0]) + legs.reduce((a, b) => a + b, 0) + (path.length - 2) * swapMin + walkEstimate(last, destination),
        };
        const key = `${path[0].id}>${last.id}`;
        const prev = best.get(key);
        if (!prev || chain.score < prev.score) best.set(key, chain);
      };
      for (const s of starts) {
        for (const e of ends) {
          if (s.id === e.id) continue;
          const si = idx.get(s.id)!;
          const ei = idx.get(e.id)!;
          for (const x of mid) {
            if (verify >= 1) consider([si, x, ei]);
            if (verify >= 2) for (const y of mid) if (y !== x) consider([si, x, y, ei]);
          }
        }
      }
      for (const c of best.values()) {
        const key = `${c.path[0].id}>${c.path[c.path.length - 1].id}`;
        const i = found.findIndex((f) => `${f.path[0].id}>${f.path[f.path.length - 1].id}` === key);
        if (i < 0) found.push(c);
        else if (rank(c, found[i]) < 0) found[i] = c;
      }
    } catch {
      /* the check is a bonus: if the router can't do the matrix, keep the quick search's answer */
    }
  }
  if (!found.length && !directs.length) throw new Error("No bike route found between nearby docks.");

  const chains = [...found].sort(rank);

  // Best few, at most one per pick-up/drop-off pair, so the list has variety.
  const perPair = new Set<string>();
  const picked: Chain[] = [];
  for (const c of chains) {
    const key = `${c.path[0].id}>${c.path[c.path.length - 1].id}`;
    if (perPair.has(key)) continue;
    perPair.add(key);
    picked.push(c);
    if (picked.length >= maxPlans) break;
  }
  // Always include the quickest straight-through ride for comparison.
  const bestDirect = [...directs].sort((a, b) => a.score - b.score)[0];
  if (bestDirect && !picked.some((c) => c.path.length === 2 && c.path[0] === bestDirect.path[0] && c.path[1] === bestDirect.path[1])) {
    picked.push(bestDirect);
  }

  // Real routes for the picked chains. Cache so shared docks / hops are only routed once.
  const walkCache = new Map<string, Promise<Segment>>();
  const walk = (from: LatLng, to: LatLng, key: string) => {
    let p = walkCache.get(key);
    if (!p) {
      p = provider.route("walk", from, to, false).then((r) => {
        if (!r.length) throw new Error("No walking route");
        return r[0];
      });
      walkCache.set(key, p);
    }
    return p;
  };
  const first = (r: Segment[]) => {
    if (!r.length) throw new Error("No route");
    return r[0];
  };
  /**
   * Walking the bike a short way can beat a long loop around a block (one-way streets). Try it at
   * each end of the ride; keep it only if the real, re-routed ride comes out faster overall.
   */
  const shortcut = async (seg: Segment, from: LatLng, to: LatLng): Promise<Segment> => {
    let cur = seg;
    let start = from;
    let end = to;
    try {
      const head = loopCandidate(cur.geometry, start);
      if (head && head.alongM / RIDE_M_PER_MIN >= SHORTCUT_MIN_SAVE_MIN) {
        const w = first(await provider.route("walk", start, head.point, false));
        console.debug("[walk shortcut: start]", { rideMin: head.alongM / RIDE_M_PER_MIN, walkMin: w.durationMin });
        if (head.alongM / RIDE_M_PER_MIN - w.durationMin >= SHORTCUT_MIN_SAVE_MIN) {
          const r = first(await provider.route("bike", head.point, end, false));
          if (w.durationMin + r.durationMin < cur.durationMin - 0.15) {
            cur = { ...r, durationMin: w.durationMin + r.durationMin, walkBefore: w };
            start = head.point;
          }
        }
      }
      const tail = loopCandidate([...cur.geometry].reverse(), end);
      if (tail && tail.alongM / RIDE_M_PER_MIN >= SHORTCUT_MIN_SAVE_MIN) {
        const w = first(await provider.route("walk", tail.point, end, false));
        console.debug("[walk shortcut: end]", { rideMin: tail.alongM / RIDE_M_PER_MIN, walkMin: w.durationMin });
        if (tail.alongM / RIDE_M_PER_MIN - w.durationMin >= SHORTCUT_MIN_SAVE_MIN) {
          const r = first(await provider.route("bike", start, tail.point, false));
          const before = cur.walkBefore?.durationMin ?? 0;
          if (before + r.durationMin + w.durationMin < cur.durationMin - 0.15) {
            cur = { ...r, durationMin: before + r.durationMin + w.durationMin, walkBefore: cur.walkBefore, walkAfter: w };
          }
        }
      }
    } catch {
      /* a shortcut is a bonus: any trouble and we keep the plain ride */
    }
    return cur;
  };
  const rideCache = new Map<string, Promise<Segment>>();
  const ride = (a: Station, b: Station) => {
    const key = `${a.id}>${b.id}`;
    let p = rideCache.get(key);
    if (!p) {
      p = provider.route("bike", a, b, false).then(async (r) => {
        if (!r.length) throw new Error("No bike route");
        let seg = opts.refineRide ? await opts.refineRide(r[0], a, b) : r[0];
        const short = await shortcut(seg, a, b);
        if (short !== seg) {
          // The shortcut re-routes from a new point: the hard block (if any) must still hold.
          try {
            const startsAt = short.walkBefore ? short.walkBefore.geometry[short.walkBefore.geometry.length - 1] : null;
            const from = startsAt ? { lat: startsAt[0], lon: startsAt[1] } : a;
            const endsAt = short.walkAfter ? short.walkAfter.geometry[0] : null;
            const to = endsAt ? { lat: endsAt[0], lon: endsAt[1] } : b;
            if (opts.refineRide) await opts.refineRide(short, from, to);
            seg = short;
          } catch {
            /* keep the plain ride */
          }
        }
        return { ...seg, durationMin: seg.durationMin * factor };
      });
      rideCache.set(key, p);
    }
    return p;
  };

  const built = await Promise.allSettled(
    picked.map(async (c, n): Promise<Plan> => {
      const first = c.path[0];
      const last = c.path[c.path.length - 1];
      const [walkTo, walkFrom, ...rides] = await Promise.all([
        walk(origin, first, `o>${first.id}`),
        walk(last, destination, `${last.id}>d`),
        ...c.path.slice(1).map((to, i) => ride(c.path[i], to)),
      ]);
      const mins = rides.map((r) => r.durationMin);
      const rideMinutes = mins.reduce((a, b) => a + b, 0);
      const swapsUsed = c.path.length - 2;
      const directMin = directTimes.get(`${first.id}>${last.id}`) ?? null;
      return {
        id: c.path.map((x) => x.id).join(">") + `#${n}`,
        stations: c.path,
        walkToDock: walkTo,
        rides,
        walkFromDock: walkFrom,
        rideMinutes,
        longestRideMinutes: Math.max(...mins),
        swapMinutes: swapsUsed * swapMin,
        overageCost: mins.reduce((a, m) => a + overageCost(m, pricing), 0),
        withinLimit: mins.every((m) => m <= limit),
        totalMinutes: walkTo.durationMin + rideMinutes + swapsUsed * swapMin + walkFrom.durationMin,
        directRideMinutes: directMin,
        detourMinutes: directMin == null ? 0 : Math.max(0, rideMinutes + swapsUsed * swapMin - directMin),
        label: "",
      };
    }),
  );
  const plans = built.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!plans.length) {
    const err = built.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw new Error(err ? String(err.reason?.message ?? err.reason) : "No routes found.");
  }

  return rankPlans(plans);
}


/** Above this share of a route on bikeways less separated than your limit, it ranks behind cleaner ones. */
export const EXPOSURE_TOLERANCE = 0.1;

/** Metres (and share) of a plan on bikeways less separated than `level`; null if road data is missing. */
export function trafficExposure(plan: Plan, level: number): { m: number; share: number } | null {
  const b = plan.roads?.breakdown;
  if (!b || !b.totalM) return null;
  const m = exposureM(b, level);
  return { m, share: m / b.totalM };
}

/**
 * Order plans: every ride within the limit first, then cheapest, then those that stay within your
 * traffic limit (when road data and a level are given), then quickest. Also (re)labels them.
 */
export function rankPlans(plans: Plan[], trafficLevel?: number): Plan[] {
  const dirty = (p: Plan) => {
    if (trafficLevel == null) return 0;
    const e = trafficExposure(p, trafficLevel);
    return e && e.share > EXPOSURE_TOLERANCE ? 1 : 0;
  };
  return [...plans]
    .sort(
      (x, y) =>
        Number(y.withinLimit) - Number(x.withinLimit) ||
        x.overageCost - y.overageCost ||
        dirty(x) - dirty(y) ||
        x.totalMinutes - y.totalMinutes,
    )
    .map((p, i) => {
      const swapsUsed = p.stations.length - 2;
      const kind = swapsUsed === 0 ? "Direct" : swapsUsed === 1 ? "1 swap" : `${swapsUsed} swaps`;
      return { ...p, label: `${i === 0 ? "Recommended" : `Option ${i + 1}`} · ${kind}` };
    });
}

/** The "just walk there" option. It uses plain walking directions and ignores swaps, limits and terrain preferences. */
export function walkOnlyPlan(walk: Segment): Plan {
  const none: Segment = { mode: "walk", durationMin: 0, distanceM: 0, geometry: [] };
  return {
    id: "walk-only",
    stations: [],
    walkToDock: walk,
    rides: [],
    walkFromDock: none,
    rideMinutes: 0,
    longestRideMinutes: 0,
    swapMinutes: 0,
    overageCost: 0,
    withinLimit: true,
    totalMinutes: walk.durationMin,
    directRideMinutes: null,
    detourMinutes: 0,
    label: "Walk · Straight to your destination",
    walkOnly: true,
  };
}
