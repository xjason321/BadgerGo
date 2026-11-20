import { describe, expect, it } from "vitest";
import { clock, crossed, readTimer, timerState, writeTimer } from "./bikeTimer";

const T0 = 1_000_000_000_000;
const at = (sec: number) => T0 + sec * 1000;

describe("timerState", () => {
  it("is free early, warns in the last 5 minutes, then goes over", () => {
    expect(timerState(T0, at(0)).phase).toBe("free");
    expect(timerState(T0, at(24 * 60 + 59)).phase).toBe("free");
    expect(timerState(T0, at(25 * 60)).phase).toBe("warn");
    expect(timerState(T0, at(30 * 60 - 1)).phase).toBe("warn");
    expect(timerState(T0, at(30 * 60)).phase).toBe("over");
  });
  it("counts down and tracks cost with the student plan", () => {
    const s = timerState(T0, at(21 * 60 + 26));
    expect(s.remainingSec).toBe(8 * 60 + 34);
    expect(s.cost).toBe(0);
    expect(s.nextChargeSec).toBe(8 * 60 + 34);
    expect(timerState(T0, at(30 * 60)).cost).toBe(0); // exactly 30:00 is still free
    expect(timerState(T0, at(30 * 60 + 1)).cost).toBe(8);
    expect(timerState(T0, at(60 * 60 + 1)).cost).toBe(16);
  });
  it("says when the next charge starts once over", () => {
    expect(timerState(T0, at(30 * 60 + 90)).nextChargeSec).toBe(30 * 60 - 90);
    expect(timerState(T0, at(30 * 60 + 90)).remainingSec).toBe(-90);
  });
  it("never goes negative before the start and caps the bar at 1", () => {
    expect(timerState(T0, at(-5)).elapsedSec).toBe(0);
    expect(timerState(T0, at(99 * 60)).fraction).toBe(1);
  });
});

describe("crossed", () => {
  it("reports the warning, the limit and each extra charge once", () => {
    expect(crossed(25 * 60 - 1, 25 * 60)).toBe("warn");
    expect(crossed(25 * 60, 25 * 60 + 1)).toBeNull();
    expect(crossed(30 * 60 - 1, 30 * 60)).toBe("limit");
    expect(crossed(60 * 60 - 1, 60 * 60)).toBe("block");
    expect(crossed(60 * 60 - 1, 60 * 60 + 1)).toBe("block");
    expect(crossed(10, 11)).toBeNull();
  });
  it("reports the most serious alert after a long gap", () => {
    expect(crossed(20 * 60, 31 * 60)).toBe("limit");
    expect(crossed(20 * 60, 61 * 60)).toBe("block");
  });
  it("ignores time going backwards", () => expect(crossed(100, 50)).toBeNull());
});

describe("clock", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(8 * 60 + 34)).toBe("8:34");
    expect(clock(21 * 60 + 5)).toBe("21:05");
    expect(clock(3600 + 7 * 60 + 3)).toBe("1:07:03");
  });
});

describe("persisted start", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it("round-trips and drops old or invalid values", () => {
    const st = mem();
    writeTimer(T0, st);
    expect(readTimer(T0 + 60_000, st)).toBe(T0);
    expect(readTimer(T0 + 4 * 3600_000, st)).toBeNull(); // older than 3 hours
    writeTimer(null, st);
    expect(readTimer(T0, st)).toBeNull();
    st.setItem("badgergo.bikeTimer", "junk");
    expect(readTimer(T0, st)).toBeNull();
  });
});

describe("timer started part-way through the free window", () => {
  it("counts the minutes already used", () => {
    const now = 1_000_000_000;
    const st = timerState(now - 10 * 60_000, now);
    expect(Math.round(st.remainingSec / 60)).toBe(20);
    expect(st.phase).toBe("free");
    expect(timerState(now - 26 * 60_000, now).phase).toBe("warn");
  });
});
