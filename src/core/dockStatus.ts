import type { Station } from "./types";

/** pickup: renting a bike here to start. dropoff: returning a bike (to swap or finish). other: not on the route. */
export type DockRole = "pickup" | "dropoff" | "other";
export type Level = "ok" | "low" | "none";

export const RING_COLORS = { ok: "#22c55e", low: "#facc15", none: "#ef4444", fill: "#2563eb" } as const;
/** "Few" means this many or fewer. */
export const FEW = 2;

export type Ring = { kind: "status"; level: Level; color: string } | { kind: "fill"; ratio: number };

export const levelOf = (n: number): Level => (n > FEW ? "ok" : n > 0 ? "low" : "none");

/**
 * What a dock's outline shows. On the route it's about the one thing you need there: a bike to take
 * (pick-up) or a space to return one (swap or end). Off the route it's how full the dock is, as a
 * share of its capacity, shown as a fill level.
 */
export function dockRing(s: Station, role: DockRole): Ring {
  if (role === "pickup") {
    const level = levelOf(s.isRenting ? s.bikesAvailable : 0);
    return { kind: "status", level, color: RING_COLORS[level] };
  }
  if (role === "dropoff") {
    const level = levelOf(s.isReturning ? s.docksAvailable : 0);
    return { kind: "status", level, color: RING_COLORS[level] };
  }
  const total = s.bikesAvailable + s.docksAvailable;
  return { kind: "fill", ratio: total > 0 ? Math.min(1, Math.max(0, s.bikesAvailable / total)) : 0 };
}

export type StopKind = "start" | "swap" | "end";
export interface DockNote { text: string; level: Level }

const worst = (a: Level, b: Level): Level => (a === "none" || b === "none" ? "none" : a === "low" || b === "low" ? "low" : "ok");

/** One line telling the rider what this dock means for their route. */
export function dockNote(s: Station, kind: StopKind): DockNote {
  const bikes = s.isRenting ? s.bikesAvailable : 0;
  const docks = s.isReturning ? s.docksAvailable : 0;
  const pick = (lvl: Level, ok: string, low: string, none: string): DockNote => ({ level: lvl, text: lvl === "ok" ? ok : lvl === "low" ? low : none });
  if (kind === "start")
    return pick(levelOf(bikes), "Plenty of bikes to pick up", "Few bikes left. Pick-up is risky", "No bikes to pick up. Choose another start dock");
  if (kind === "end")
    return pick(levelOf(docks), "Plenty of open docks for your bike", "Few open docks. Returning here is risky", "No open docks for your bike. Choose another end dock");
  const b = levelOf(bikes), d = levelOf(docks);
  if (b === "ok" && d === "ok") return { level: "ok", text: "Plenty of docks to swap here and bikes to take" };
  if (d === "none") return { level: "none", text: "No open docks to return your bike. Swap won't work here" };
  if (b === "none") return { level: "none", text: "No bikes to swap onto here. Swap won't work" };
  return { level: worst(b, d), text: d === "low" && b === "low" ? "Few docks and few bikes. Swapping here is risky" : d === "low" ? "Few open docks to return your bike. Swapping here is risky" : "Few bikes to swap onto. Swapping here is risky" };
}
