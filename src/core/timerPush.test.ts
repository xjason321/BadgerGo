import { describe, expect, it } from "vitest";
import { MAX_RIDE_MS, nextPushAt, pushFor, TICK_OFFSET_MS } from "./timerPush";

const T0 = Date.UTC(2026, 10, 20, 18, 0, 0);
const min = (n: number) => n * 60_000;

describe("when pushes go out", () => {
  it("one a second after each whole minute of the ride", () => {
    expect(nextPushAt(T0, T0)).toBe(T0 + min(1) + TICK_OFFSET_MS);
    expect(nextPushAt(T0, T0 + min(1))).toBe(T0 + min(1) + TICK_OFFSET_MS);
    expect(nextPushAt(T0, T0 + min(2) + 500)).toBe(T0 + min(2) + TICK_OFFSET_MS);
  });
  it("always moves forward, even from exactly a push moment", () => {
    for (let t = T0; t < T0 + min(6); t += 17_000) expect(nextPushAt(T0, t)).toBeGreaterThan(t);
    const at = T0 + min(3) + TICK_OFFSET_MS;
    expect(nextPushAt(T0, at)).toBe(at + min(1));
  });
  it("a ride unlocked earlier still lines up with its own start", () => {
    const started = T0 - min(12) - 30_000;
    expect(nextPushAt(started, T0)).toBe(started + min(13) + TICK_OFFSET_MS);
  });
  it("rides are forgotten after the same 3 hours as the saved timer", () => expect(MAX_RIDE_MS).toBe(3 * 3600_000));
});

describe("what a push says", () => {
  const at = (m: number) => T0 + min(m) + TICK_OFFSET_MS;
  it("the countdown, quietly, minute by minute", () => {
    const a = pushFor(T0, at(1)), b = pushFor(T0, at(2));
    expect(a).toMatchObject({ alert: false, tag: "badgergo-timer-live", title: "29 min left free" });
    expect(b.title).toBe("28 min left free");
  });
  it("the 10 and 5 minute warnings and the time-up alert are alerts, on their own tag", () => {
    expect(pushFor(T0, at(20))).toMatchObject({ alert: true, tag: "badgergo-timer-alert", title: "10 min left on your free ride" });
    expect(pushFor(T0, at(25))).toMatchObject({ alert: true, title: "5 min left on your free ride" });
    expect(pushFor(T0, at(30))).toMatchObject({ alert: true, title: "Your free time is up" });
  });
  it("each further charge is an alert and the minutes between them go back to the countdown", () => {
    expect(pushFor(T0, at(60))).toMatchObject({ alert: true, title: expect.stringContaining("charge started") });
    expect(pushFor(T0, at(31))).toMatchObject({ alert: false, title: "Over the free time by 2 min" }); // the label rounds up, as in the app
    expect(pushFor(T0, at(45))).toMatchObject({ alert: false, title: "Over the free time by 16 min" });
  });
  it("a push that lands between alert moments is just the countdown", () => {
    expect(pushFor(T0, at(19) + 500)).toMatchObject({ alert: false, title: "11 min left free" });
  });
  it("a ride unlocked 26 minutes in warns about the 5 minutes at the right moment", () => {
    const started = T0 - min(21);
    expect(pushFor(started, started + min(25) + TICK_OFFSET_MS)).toMatchObject({ alert: true, title: "5 min left on your free ride" });
  });
});
