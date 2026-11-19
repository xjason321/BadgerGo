import { overageCost } from "./pricing";
import { STUDENT_PLAN, type PricingPlan } from "./types";

/** How many minutes before the free limit the rider gets the first warning. */
export const WARN_BEFORE_MIN = 5;

export type TimerPhase = "free" | "warn" | "over";

export interface TimerState {
  elapsedSec: number;
  /** Seconds left in the free window (negative once it's over). */
  remainingSec: number;
  phase: TimerPhase;
  /** What this ride costs so far. */
  cost: number;
  /** Seconds until the next charge: the free limit, then each extra block. */
  nextChargeSec: number;
  /** 0..1 of the free window used (stays at 1 once over). */
  fraction: number;
}

export function timerState(startedAt: number, now: number, plan: PricingPlan = STUDENT_PLAN, warnMin = WARN_BEFORE_MIN): TimerState {
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const freeSec = plan.freeMinutes * 60;
  const blockSec = plan.blockMinutes * 60;
  const remainingSec = freeSec - elapsedSec;
  const phase: TimerPhase = elapsedSec >= freeSec ? "over" : elapsedSec >= freeSec - warnMin * 60 ? "warn" : "free";
  const nextChargeSec = elapsedSec < freeSec ? freeSec - elapsedSec : blockSec - ((elapsedSec - freeSec) % blockSec);
  return { elapsedSec, remainingSec, phase, cost: overageCost(elapsedSec / 60, plan), nextChargeSec, fraction: Math.min(1, elapsedSec / freeSec) };
}

/** Which alert, if any, the clock passed between two moments: the warning, the free limit, or a further charge. */
export type TimerAlert = "warn" | "limit" | "block";
export function crossed(prevSec: number, nextSec: number, plan: PricingPlan = STUDENT_PLAN, warnMin = WARN_BEFORE_MIN): TimerAlert | null {
  if (nextSec <= prevSec) return null;
  const freeSec = plan.freeMinutes * 60;
  const blockSec = plan.blockMinutes * 60;
  const passed = (t: number) => prevSec < t && nextSec >= t;
  // Check the later ones first so a long gap (a sleeping phone) reports the most serious one.
  const k = Math.floor((nextSec - freeSec) / blockSec);
  if (nextSec > freeSec && k >= 1 && passed(freeSec + k * blockSec)) return "block";
  if (passed(freeSec)) return "limit";
  if (passed(freeSec - warnMin * 60)) return "warn";
  return null;
}

/** 21:34 for a clock; for overtime pass the absolute value and add the sign yourself. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(r).padStart(2, "0")}`;
}

const KEY = "badgergo.bikeTimer";
const STALE_MS = 3 * 3600_000;
/** The start time is kept so a reload (or a trip to another app) doesn't lose the ride. */
export function readTimer(now = Date.now(), store: Pick<Storage, "getItem"> | null = safeStore()): number | null {
  try {
    const v = Number(store?.getItem(KEY));
    return Number.isFinite(v) && v > 0 && now - v < STALE_MS && v <= now + 1000 ? v : null;
  } catch { return null; }
}
export function writeTimer(startedAt: number | null, store: Pick<Storage, "setItem" | "removeItem"> | null = safeStore()) {
  try { if (startedAt == null) store?.removeItem(KEY); else store?.setItem(KEY, String(startedAt)); } catch { /* private mode */ }
}
function safeStore(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }
