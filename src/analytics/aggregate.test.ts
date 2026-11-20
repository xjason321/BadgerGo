import { describe, expect, it } from "vitest";
import type { StatsDay, StatsResponse } from "../core/usageTypes";
import { change, formatCount, niceTicks, summarizeRange } from "./aggregate";

const day = (n: number, o: Partial<StatsDay> = {}): StatsDay => ({
  day: `2026-11-${String(n).padStart(2, "0")}`, users: 0, users7: 0, users30: 0, users90: 0, newUsers: 0, opens: 0, peakActive: 0,
  beats: Array.from({ length: 24 }, () => 0), counts: {}, platforms: {}, installed: 0, ...o,
});
/** Days 1..20 of the month, with whatever `f` says about each. */
const stats = (f: (n: number) => Partial<StatsDay>, o: Partial<StatsResponse> = {}): StatsResponse => ({
  timeZone: "America/Chicago", generatedAtMs: 0, activeNow: 0, allTimeUsers: 0, since: "2026-11-01", days: Array.from({ length: 20 }, (_, i) => day(i + 1, f(i + 1))), ...o,
});

describe("the chosen range", () => {
  it("takes the last N days and the unique-user count as of the last day", () => {
    const s = summarizeRange(stats((n) => ({ users: 2, newUsers: 1, opens: 3, users7: n * 10 })), 7);
    expect(s.days).toHaveLength(7);
    expect(s.users).toBe(200); // users7 of day 20
    expect(s.newUsers).toBe(7);
    expect(s.opens).toBe(21);
    expect(s.today).toBe(2);
  });
  it("compares with the period before, only if counting had started by then", () => {
    const f = (n: number) => ({ users7: n });
    expect(summarizeRange(stats(f), 7)).toMatchObject({ users: 20, usersBefore: 13 }); // day 13 ends the week before
    expect(summarizeRange(stats(f, { since: "2026-11-15" }), 7).usersBefore).toBeNull(); // counting began mid-way
    expect(summarizeRange(stats(f, { since: null }), 7).usersBefore).toBeNull();
    expect(summarizeRange(stats(f), 30).usersBefore).toBeNull(); // not enough days yet
  });
  it("adds up routes, rides and every feature, listing unused ones as zero", () => {
    const s = summarizeRange(stats(() => ({ counts: { route_search: 4, ride_start: 1, share: 2 } })), 7);
    expect(s).toMatchObject({ routes: 28, ridesStarted: 7 });
    expect(s.features.find((x) => x.key === "share")?.value).toBe(14);
    expect(s.features.find((x) => x.key === "alerts_on")?.value).toBe(0);
    expect(s.features.map((x) => x.key)).toContain("nearest_dock");
  });
  it("splits device-days into browser and Home Screen, and ranks devices", () => {
    const s = summarizeRange(stats(() => ({ users: 10, installed: 4, platforms: { ios: 6, desktop: 3, android: 1 } })), 7);
    expect(s.howUsed).toEqual([{ key: "browser", value: 42 }, { key: "installed", value: 28 }]);
    expect(s.platforms.map((p) => p.key)).toEqual(["ios", "desktop", "android"]);
  });
  it("averages devices open by hour (a check-in is a 5-minute window, 12 an hour)", () => {
    const s = summarizeRange(stats(() => ({ beats: Array.from({ length: 24 }, (_, h) => (h === 9 ? 24 : 0)) })), 7);
    expect(s.hourly[9]).toBe(2);
    expect(s.hourly[10]).toBe(0);
  });
  it("copes with no data at all", () => {
    const s = summarizeRange({ timeZone: "America/Chicago", generatedAtMs: 0, activeNow: 0, allTimeUsers: 0, since: null, days: [] }, 30);
    expect(s).toMatchObject({ users: 0, usersBefore: null, today: 0, routes: 0, platforms: [] });
    expect(s.hourly).toHaveLength(24);
  });
});

describe("number helpers", () => {
  it("relative change", () => {
    expect(change(12, 10)).toBeCloseTo(0.2);
    expect(change(5, 10)).toBe(-0.5);
    expect(change(5, 0)).toBeNull();
    expect(change(5, null)).toBeNull();
  });
  it("round axis ticks that cover the data", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(130)).toEqual([0, 50, 100, 150]);
    for (const max of [1, 3, 9, 41, 250, 1234]) expect(niceTicks(max).at(-1)!).toBeGreaterThanOrEqual(max);
  });
  it("readable counts", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(2.5)).toBe("2.5");
    expect(formatCount(12_900)).toBe("12.9K");
  });
});
