// Anonymous usage counts, pure part: how a report from the app is counted into a day's record, and how the
// dashboard's numbers come out of the records. The Usage Durable Object (worker/usage.ts) stores the records.
//
// Unique devices without identifiers: a device reports only its first open of each day, with the number of
// days since its previous active day ("gap"; null for a new device). A device active in the window [S, E] is
// counted exactly once, on its first active day d in the window, which is the day whose gap reaches back
// before S (gap > d - S). So per day we keep a histogram of gaps, and the unique devices in any window of up
// to USAGE.maxGapDays days are a sum over it.
import { USAGE } from "../src/core/usageConfig";
import type { StatsDay, StatsResponse, UsageEvent, UsageFirst, UsagePlatform, UsageRequest } from "../src/core/usageTypes";
import { addDays } from "../src/core/usage";

/** One day's counts (USAGE.timeZone). Nothing in it can tell devices apart. */
export interface UsageDayRecord {
  /** Returning devices by days since their previous active day: [g - 1] for gap g (the last one: that many or more). */
  gaps: number[];
  newUsers: number;
  opens: number;
  /** Check-ins (a device with the app open in one window) by hour of day. */
  beats: number[];
  peakActive: number;
  counts: Partial<Record<UsageEvent, number>>;
  platforms: Partial<Record<UsagePlatform, number>>;
  /** The Home Screen web app. */
  installed: number;
}

/** Check-ins in the current window and the one before ("active now"). */
export interface WindowState {
  window: number;
  count: number;
  previous: number;
}

export function emptyDay(): UsageDayRecord {
  return {
    gaps: Array.from({ length: USAGE.maxGapDays }, () => 0),
    newUsers: 0,
    opens: 0,
    beats: Array.from({ length: 24 }, () => 0),
    peakActive: 0,
    counts: {},
    platforms: {},
    installed: 0,
  };
}

function inc<K extends string>(record: Partial<Record<K, number>>, key: K): void {
  record[key] = (record[key] ?? 0) + 1;
}

function countFirst(day: UsageDayRecord, first: UsageFirst): void {
  if (first.gap === null) day.newUsers++;
  else {
    const i = Math.min(Math.max(first.gap, 1), USAGE.maxGapDays) - 1;
    day.gaps[i] = (day.gaps[i] ?? 0) + 1;
  }
  inc(day.platforms, first.platform);
  if (first.installed) day.installed++;
}

/** The window state after one more check-in in `window`. */
function checkIn(state: WindowState | null, window: number): WindowState {
  if (!state || window > state.window + 1) return { window, count: 1, previous: 0 };
  if (window === state.window + 1) return { window, count: 1, previous: state.count };
  return { ...state, count: state.count + 1 }; // this window (or a late one, counted as this one)
}

/**
 * Counts one report into today's record (mutated). Returns the new window state and whether it was a device
 * never seen before (for the all-time total).
 */
export function applyUsage(day: UsageDayRecord, state: WindowState | null, req: UsageRequest, at: { window: number; hour: number }): { state: WindowState | null; newDevice: boolean } {
  if (req.kind === "event") {
    inc(day.counts, req.name);
    return { state, newDevice: false };
  }
  if (req.kind === "open") day.opens++;
  if (req.first) countFirst(day, req.first);
  const next = checkIn(state, at.window);
  day.beats[at.hour] = (day.beats[at.hour] ?? 0) + 1;
  day.peakActive = Math.max(day.peakActive, next.count);
  return { state: next, newDevice: req.first?.gap === null };
}

/** Devices with the app open now: the current window's check-ins, or the previous window's if more. */
export function activeNow(state: WindowState | null, window: number): number {
  if (!state) return 0;
  if (state.window === window) return Math.max(state.count, state.previous);
  return state.window === window - 1 ? state.count : 0;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Unique devices active on a day. */
export const dailyUsers = (d: UsageDayRecord): number => d.newUsers + sum(d.gaps);

/**
 * The devices a day counts toward a window that starts k days before it, for k = 0 ... gaps.length: new devices,
 * plus those whose previous active day is outside the window (gap > k). Suffix sums of the gap histogram.
 */
function windowCounts(d: UsageDayRecord): number[] {
  const out = Array.from({ length: d.gaps.length + 1 }, () => d.newUsers);
  for (let i = d.gaps.length - 1, acc = d.newUsers; i >= 0; i--) {
    acc += d.gaps[i] ?? 0;
    out[i] = acc;
  }
  return out;
}

/** Unique devices in the `length` days ending at index `end` of `days` (each day's windowCounts, or null). */
function uniqueIn(days: ReadonlyArray<number[] | null>, end: number, length: number): number {
  let total = 0;
  for (let k = 0; k < length; k++) {
    const c = days[end - length + 1 + k];
    // k = days since the window's start; the previous active day is outside the window when gap > k.
    if (c) total += c[Math.min(k, c.length - 1)] ?? 0;
  }
  return total;
}

/** Unique devices active in the `length` days ending `end` (length <= USAGE.maxGapDays). */
export function uniqueUsers(records: ReadonlyMap<string, UsageDayRecord>, end: string, length: number): number {
  const days = Array.from({ length }, (_, i) => {
    const d = records.get(addDays(end, i - length + 1));
    return d ? windowCounts(d) : null;
  });
  return uniqueIn(days, length - 1, length);
}

/** The dashboard: `days` days ending `today`, from the stored records (which must reach back far enough). */
export function summarize(
  records: ReadonlyMap<string, UsageDayRecord>,
  o: { today: string; days: number; nowMs: number; window: number; state: WindowState | null; allTime: number; since: string | null },
): StatsResponse {
  // Every day the windows reach, oldest first, each with its window counts worked out once.
  const span = o.days + USAGE.maxGapDays - 1;
  const first = addDays(o.today, -(span - 1));
  const keys = Array.from({ length: span }, (_, i) => addDays(first, i));
  const counts = keys.map((k) => {
    const r = records.get(k);
    return r ? windowCounts(r) : null;
  });
  const days: StatsDay[] = [];
  for (let i = o.days - 1; i >= 0; i--) {
    const at = span - 1 - i;
    const day = keys[at]!;
    const r = records.get(day) ?? emptyDay();
    days.push({
      day,
      users: dailyUsers(r),
      users7: uniqueIn(counts, at, 7),
      users30: uniqueIn(counts, at, 30),
      users90: uniqueIn(counts, at, 90),
      newUsers: r.newUsers,
      opens: r.opens,
      peakActive: r.peakActive,
      beats: r.beats,
      counts: r.counts,
      platforms: r.platforms,
      installed: r.installed,
    });
  }
  return { timeZone: USAGE.timeZone, generatedAtMs: o.nowMs, activeNow: activeNow(o.state, o.window), allTimeUsers: o.allTime, since: o.since, days };
}
