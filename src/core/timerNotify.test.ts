import { describe, expect, it } from "vitest";
import { crossed, timerState } from "./bikeTimer";
import { alertNote, liveKey, liveNote, ALERT_TAG, LIVE_TAG } from "./timerNotify";

const at = (min: number, sec = 0) => timerState(0, (min * 60 + sec) * 1000);

describe("alert notifications", () => {
  it("says 10 minutes left, then 5, then that the free time is up", () => {
    const early = alertNote("early", at(20))!;
    expect(early.title).toBe("10 min left on your free ride");
    expect(early.body).toMatch(/\$8/);
    const warn = alertNote("warn", at(25))!;
    expect(warn.title).toBe("5 min left on your free ride");
    const limit = alertNote("limit", at(30))!;
    expect(limit.title).toBe("Your free time is up");
    expect(limit.body).toMatch(/\$8/);
    for (const n of [early, warn, limit]) expect(n.tag).toBe(ALERT_TAG);
  });
  it("announces each new charge with the running total", () => {
    const n = alertNote("block", at(60))!;
    expect(alertNote("block", at(90))!.body).toMatch(/\$24 so far/);
    expect(n.title).toBe("Another $8 charge started");
    expect(n.body).toMatch(/\$16 so far/);
  });
  it("drops an alert that arrives long after its moment (the phone was asleep)", () => {
    expect(alertNote("early", at(20, 100))).not.toBeNull();
    expect(alertNote("early", at(24))).toBeNull();
    expect(alertNote("warn", at(28))).toBeNull();
    expect(alertNote("limit", at(36))).toBeNull();
    expect(alertNote("block", at(75))).toBeNull();
  });
  it("lines up with the timer's own alerts", () => {
    const a = crossed(20 * 60 - 1, 20 * 60)!;
    expect(alertNote(a, at(20))?.title).toMatch(/10 min left/);
  });
});

describe("live notification", () => {
  it("counts the minutes left, rounding up so it never says 0 before the limit", () => {
    expect(liveNote(at(12)).title).toBe("18 min left free");
    expect(liveNote(at(29, 30)).title).toBe("1 min left free");
    expect(liveNote(at(12)).tag).toBe(LIVE_TAG);
  });
  it("switches to how far over you are, with the cost", () => {
    const n = liveNote(at(33));
    expect(n.title).toBe("Over the free time by 3 min");
    expect(n.body).toMatch(/\$8 so far/);
  });
  it("changes its key once a minute, not every second", () => {
    expect(liveKey(at(12, 1))).toBe(liveKey(at(12, 30)));
    expect(liveKey(at(12, 30))).not.toBe(liveKey(at(13, 30)));
    expect(liveKey(at(29))).toBeGreaterThan(0);
    expect(liveKey(at(31))).toBeLessThan(0);
  });
});

describe("with the dock the rider is heading for", () => {
  const line = "Capitol Square: 3 open docks, 7 bikes";
  it("the countdown says how many docks and bikes are left there", () => {
    const n = liveNote(at(12), undefined, line);
    expect(n.title).toBe("18 min left free");
    expect(n.body).toBe(`${line}. Dock before it runs out to avoid the $8 charge.`);
    expect(liveNote(at(34), undefined, line).body).toBe(`${line}. $8 so far. Dock now.`);
  });
  it("so does each alert, after what it already says", () => {
    expect(alertNote("warn", at(25), undefined, line)!.body).toBe(`Dock within 5 min to avoid the $8 charge. ${line}.`);
    expect(alertNote("limit", at(30), undefined, line)!.body).toContain(line);
  });
  it("without a dock they read as before", () => {
    expect(liveNote(at(12)).body).toMatch(/Updates every minute/);
    expect(alertNote("warn", at(25))!.body).not.toContain("open dock");
    expect(alertNote("early", at(24), undefined, line)).toBeNull(); // a stale alert is still dropped
  });
});
