import { describe, expect, it } from "vitest";
import { addDays, dayGap, dayKey, firstOfDay, hourOf, isDayKey, parseUsageMemory, windowOf } from "./usage";

const CHI = "America/Chicago";

describe("days in Chicago", () => {
  it("rolls over at local midnight, in winter and summer", () => {
    expect(dayKey(Date.UTC(2026, 10, 20, 5, 59), CHI)).toBe("2026-11-19"); // 23:59 CST
    expect(dayKey(Date.UTC(2026, 10, 20, 6, 0), CHI)).toBe("2026-11-20");
    expect(dayKey(Date.UTC(2026, 6, 20, 4, 59), CHI)).toBe("2026-07-19"); // 23:59 CDT
    expect(hourOf(Date.UTC(2026, 10, 20, 6, 0), CHI)).toBe(0);
    expect(hourOf(Date.UTC(2026, 10, 20, 18, 30), CHI)).toBe(12);
  });
  it("adds and measures calendar days across months and daylight saving", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayGap("2026-11-01", "2026-11-20")).toBe(19);
    expect(dayGap("2026-03-07", "2026-03-09")).toBe(2); // the spring-forward weekend
  });
  it("tells real days from junk", () => {
    expect(isDayKey("2026-11-20")).toBe(true);
    for (const v of ["2026-13-40x", "20261120", 5, null, "2026-11-2"]) expect(isDayKey(v)).toBe(false);
    expect(windowOf(600_000, 300_000)).toBe(2);
  });
});

describe("a device's first open of the day", () => {
  const today = "2026-11-20";
  it("is a new device with no memory", () => expect(firstOfDay({ day: null, window: null }, today, 90)).toEqual({ gap: null }));
  it("is not a first when it already reported today", () => expect(firstOfDay({ day: today, window: 1 }, today, 90)).toBeNull());
  it("reports the days since the last active day, capped", () => {
    expect(firstOfDay({ day: "2026-11-19", window: null }, today, 90)).toEqual({ gap: 1 });
    expect(firstOfDay({ day: "2026-01-01", window: null }, today, 90)).toEqual({ gap: 90 });
  });
  it("ignores a clock that went backwards", () => expect(firstOfDay({ day: "2026-11-25", window: null }, today, 90)).toBeNull());
  it("reads stored memory defensively", () => {
    expect(parseUsageMemory({ day: "2026-11-19", window: 7 })).toEqual({ day: "2026-11-19", window: 7 });
    expect(parseUsageMemory({ day: "junk", window: 1.5 })).toEqual({ day: null, window: null });
    expect(parseUsageMemory("x")).toEqual({ day: null, window: null });
  });
});
