import { describe, expect, it } from "vitest";
import { clearSession, MAX_AGE_MS, readSession, saveSession, slim, type Session } from "./rideSession";
import type { Plan } from "./types";

const mem = () => { const m: Record<string, string> = {}; return { m, s: { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; }, removeItem: (k: string) => { delete m[k]; } } }; };
const plan = { id: "p1", stations: [{ id: "a" }, { id: "b" }], roads: { breakdown: [1, 2, 3] }, label: "x" } as unknown as Plan;
const sess = (over: Partial<Session> = {}): Session => ({ plan, origin: { lat: 1, lon: 2, label: "A" }, destination: { lat: 3, lon: 4, label: "B" }, index: 1, savedAt: 1_000_000, ...over });

describe("ride session", () => {
  it("round-trips a ride, without the heavy road data", () => {
    const { s } = mem();
    saveSession(sess(), s);
    const back = readSession(1_000_500, s)!;
    expect(back.index).toBe(1);
    expect(back.plan.id).toBe("p1");
    expect((back.plan as Plan).roads).toBeUndefined();
    expect(back.destination.label).toBe("B");
  });
  it("slim keeps everything else", () => expect(slim(plan)).toMatchObject({ id: "p1", label: "x" }));
  it("is gone once cleared", () => {
    const { s } = mem();
    saveSession(sess(), s); clearSession(s);
    expect(readSession(1_000_500, s)).toBeNull();
  });
  it("expires after three hours", () => {
    const { s } = mem();
    saveSession(sess(), s);
    expect(readSession(1_000_000 + MAX_AGE_MS - 1, s)).not.toBeNull();
    expect(readSession(1_000_000 + MAX_AGE_MS + 1, s)).toBeNull();
  });
  it("ignores damaged or incomplete data", () => {
    const { m, s } = mem();
    m["badgergo.ride"] = "{oops"; expect(readSession(1_000_500, s)).toBeNull();
    m["badgergo.ride"] = JSON.stringify({ ...sess(), plan: null }); expect(readSession(1_000_500, s)).toBeNull();
    m["badgergo.ride"] = JSON.stringify({ ...sess(), index: -1 }); expect(readSession(1_000_500, s)).toBeNull();
    m["badgergo.ride"] = JSON.stringify({ ...sess(), destination: { lat: "x" } }); expect(readSession(1_000_500, s)).toBeNull();
    m["badgergo.ride"] = JSON.stringify({ ...sess(), savedAt: 9e12 }); expect(readSession(1_000_500, s)).toBeNull();
  });
  it("returns null with no storage", () => expect(readSession(1, undefined as never)).toBeNull());
});
