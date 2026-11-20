import { describe, expect, it } from "vitest";
import { USAGE } from "../src/core/usageConfig";
import { addDays, firstOfDay } from "../src/core/usage";
import type { UsageFirst } from "../src/core/usageTypes";
import { activeNow, applyUsage, dailyUsers, emptyDay, summarize, uniqueUsers, type UsageDayRecord } from "./usageCore";

const first = (gap: number | null, o: Partial<UsageFirst> = {}): UsageFirst => ({ gap, platform: "ios", installed: false, ...o });
const at = { window: 100, hour: 9 };

describe("counting a report", () => {
  it("counts an open, its first of the day, the hour and the platform", () => {
    const d = emptyDay();
    const r = applyUsage(d, null, { kind: "open", first: first(null, { installed: true }) }, at);
    expect(d).toMatchObject({ opens: 1, newUsers: 1, installed: 1, platforms: { ios: 1 }, peakActive: 1 });
    expect(d.beats[9]).toBe(1);
    expect(r).toEqual({ state: { window: 100, count: 1, previous: 0 }, newDevice: true });
  });
  it("puts a returning device in the histogram by its gap, and never counts it as new", () => {
    const d = emptyDay();
    const r = applyUsage(d, null, { kind: "open", first: first(3) }, at);
    expect(d.gaps[2]).toBe(1);
    expect(d.newUsers).toBe(0);
    expect(r.newDevice).toBe(false);
  });
  it("a check-in without a first (a repeat the same day) adds activity but no user", () => {
    const d = emptyDay();
    applyUsage(d, null, { kind: "beat", first: null }, at);
    expect(dailyUsers(d)).toBe(0);
    expect(d.opens).toBe(0);
    expect(d.beats[9]).toBe(1);
  });
  it("counts an event on its own and leaves the check-in window alone", () => {
    const d = emptyDay();
    const state = { window: 100, count: 2, previous: 0 };
    const r = applyUsage(d, state, { kind: "event", name: "share" }, at);
    expect(d.counts).toEqual({ share: 1 });
    expect(r.state).toBe(state);
  });
  it("tracks who is active now across windows", () => {
    let s = applyUsage(emptyDay(), null, { kind: "beat", first: null }, { window: 10, hour: 0 }).state;
    s = applyUsage(emptyDay(), s, { kind: "beat", first: null }, { window: 10, hour: 0 }).state;
    expect(activeNow(s, 10)).toBe(2);
    expect(activeNow(s, 11)).toBe(2); // still the previous window
    expect(activeNow(s, 12)).toBe(0);
    s = applyUsage(emptyDay(), s, { kind: "beat", first: null }, { window: 11, hour: 0 }).state;
    expect(activeNow(s, 11)).toBe(2); // the busier of this and the last window
  });
});

/** Brute force: the unique devices in a window versus what the gap histograms say, for devices active on random days. */
describe("unique devices without identifiers", () => {
  const today = "2026-11-20";
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;

  it("matches counting the devices directly, for every window length", () => {
    const span = 120;
    const days = Array.from({ length: span }, (_, i) => addDays(today, -(span - 1) + i));
    const records = new Map<string, UsageDayRecord>(days.map((d) => [d, emptyDay()]));
    const activity: number[][] = []; // per device: the indexes of days it was active
    for (let n = 0; n < 150; n++) {
      const p = 0.02 + rand() * 0.3;
      const active = days.map((_, i) => i).filter(() => rand() < p);
      if (!active.length) continue;
      activity.push(active);
      // What the device reports: on its first open of each active day, the days since its previous active day.
      let memory: { day: string | null; window: null } = { day: null, window: null };
      for (const i of active) {
        const f = firstOfDay(memory, days[i]!, USAGE.maxGapDays)!;
        applyUsage(records.get(days[i]!)!, null, { kind: "open", first: first(f.gap) }, at);
        memory = { day: days[i]!, window: null };
      }
    }
    for (const length of [1, 7, 30, 90]) {
      for (const end of [length - 1 + 29, 80, 100, span - 1]) {
        if (end - length + 1 < 0) continue;
        const direct = activity.filter((a) => a.some((i) => i > end - length && i <= end)).length;
        expect(uniqueUsers(records, days[end]!, length), `${length} days ending ${days[end]}`).toBe(direct);
      }
    }
  });

  it("caps long gaps: a device back after more than 90 days counts as new to every window", () => {
    const records = new Map([[today, emptyDay()]]);
    applyUsage(records.get(today)!, null, { kind: "open", first: first(USAGE.maxGapDays) }, at);
    expect(uniqueUsers(records, today, 7)).toBe(1);
    expect(uniqueUsers(records, today, 90)).toBe(1);
  });
});

describe("the dashboard's numbers", () => {
  it("covers the days asked for, oldest first, ending today, with empty days as zeros", () => {
    const today = "2026-11-20";
    const records = new Map([[today, emptyDay()], [addDays(today, -1), emptyDay()]]);
    applyUsage(records.get(today)!, null, { kind: "open", first: first(null) }, at);
    applyUsage(records.get(addDays(today, -1))!, null, { kind: "open", first: first(40) }, at); // back after 40 days: outside the 7- and 30-day windows
    const s = summarize(records, { today, days: 7, nowMs: 5, window: 100, state: { window: 100, count: 3, previous: 0 }, allTime: 12, since: "2026-11-01" });
    expect(s.days).toHaveLength(7);
    expect(s.days.at(-1)).toMatchObject({ day: today, users: 1, newUsers: 1, users7: 2, users30: 2 });
    expect(s.days[0]).toMatchObject({ day: "2026-11-14", users: 0, users7: 0 });
    expect(s).toMatchObject({ activeNow: 3, allTimeUsers: 12, since: "2026-11-01", timeZone: "America/Chicago" });
  });
});
