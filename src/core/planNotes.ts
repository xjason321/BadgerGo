import type { Plan } from "./types";

/** Share of a route on shared-use paths, side paths and separated bike lanes (KINDS 0-2), or null without road data. */
export function protectedShare(p: Plan): number | null {
  const b = p.roads?.breakdown;
  if (!b || !b.totalM) return null;
  return (b.byKind[0] + b.byKind[1] + b.byKind[2]) / b.totalM;
}

const walkMin = (p: Plan) => p.walkToDock.durationMin + p.walkFromDock.durationMin;
const swaps = (p: Plan) => p.stations.length - 2;

/** The one plan with the strictly lowest `value`, if it beats every other by at least `margin`. */
function uniqueBest(plans: Plan[], value: (p: Plan) => number | null, margin: number, higherIsBetter = false): Plan | null {
  const scored = plans.map((p) => ({ p, v: value(p) })).filter((x): x is { p: Plan; v: number } => x.v != null);
  if (scored.length < plans.length) return null; // can't compare plans we have no data for
  const sign = higherIsBetter ? -1 : 1;
  scored.sort((a, b) => sign * (a.v - b.v));
  return scored.length >= 2 && Math.abs(scored[1].v - scored[0].v) >= margin ? scored[0].p : null;
}

const distinct = (xs: string[]) => new Set(xs).size > 1;

/**
 * A short line for each bike route saying how it differs from the others: what it's best at (fastest,
 * cheapest, most protected from traffic, least riding or walking) and what is structurally different
 * (swaps, pick-up dock, drop-off dock). Keys are plan ids; walk-only and custom routes get none.
 */
export function describePlans(all: Plan[]): Record<string, string> {
  const plans = all.filter((p) => !p.walkOnly && p.id !== "custom" && p.stations.length >= 2);
  const out: Record<string, string> = {};
  if (!plans.length) return out;

  const tags = new Map<string, string[]>();
  const give = (p: Plan | null, text: string) => { if (p) tags.set(p.id, [...(tags.get(p.id) ?? []), text]); };
  if (plans.length >= 2) {
    give(uniqueBest(plans, (p) => p.totalMinutes, 1), "Fastest");
    // When going faster would cost money, say which route is quickest without paying anything extra.
    const free = plans.filter((p) => p.overageCost === 0);
    const fastestOverall = uniqueBest(plans, (p) => p.totalMinutes, 1);
    if (free.length && free.length < plans.length && !(fastestOverall && fastestOverall.overageCost === 0)) {
      give(free.length === 1 ? free[0] : uniqueBest(free, (p) => p.totalMinutes, 1), free.length === 1 ? "Only free route" : "Fastest that's free");
    }
    give(uniqueBest(plans, (p) => p.overageCost, 1), "Cheapest");
    give(uniqueBest(plans, protectedShare, 0.1, true), "Most protected from traffic");
    give(uniqueBest(plans, (p) => p.rideMinutes, 1), "Least time on a bike");
    give(uniqueBest(plans, walkMin, 2), "Least walking");
  }

  // Structure is described against the first (top-ranked) bike route, so a dock is only named when it's not what that route uses.
  const base = plans[0];
  const swapDiffers = distinct(plans.map((p) => String(swaps(p))));
  const swapText = (p: Plan) => (swaps(p) === 0 ? "No swaps" : swaps(p) === 1 ? `Swaps at ${p.stations[1].name}` : `${swaps(p)} swaps`);
  const lastOf = (p: Plan) => p.stations[p.stations.length - 1];
  const structure = (p: Plan): string[] => {
    const s: string[] = [];
    if (swapDiffers && (p === base || swaps(p) !== swaps(base))) s.push(swapText(p));
    if (p !== base && p.stations[0].id !== base.stations[0].id) s.push(`Pick up at ${p.stations[0].name}`);
    if (p !== base && lastOf(p).id !== lastOf(base).id) s.push(`Drop off at ${lastOf(p).name}`);
    return s;
  };
  /** Used only to tell two otherwise identical descriptions apart: what it costs, or how much slower it is. */
  const fastest = Math.min(...plans.map((p) => p.totalMinutes));
  const extra = (p: Plan): string[] => (p.overageCost > 0 ? [`+$${p.overageCost}`] : Math.round(p.totalMinutes - fastest) >= 1 ? [`${Math.round(p.totalMinutes - fastest)} min slower`] : []);

  const seen = new Set<string>();
  for (const p of plans) {
    const pieces = [...(tags.get(p.id) ?? []).slice(0, 1), ...structure(p)];
    const fallback = swaps(p) === 0 ? "Direct" : swaps(p) === 1 ? "1 swap" : `${swaps(p)} swaps`;
    let take = Math.min(2, pieces.length);
    let text = pieces.slice(0, take).join(" · ") || fallback;
    // Two routes must never read the same: add detail until this one is different.
    while (seen.has(text) && take < pieces.length) text = pieces.slice(0, ++take).join(" · ");
    if (seen.has(text)) text = [text, ...extra(p)].join(" · ");
    seen.add(text);
    out[p.id] = text;
  }
  return out;
}
