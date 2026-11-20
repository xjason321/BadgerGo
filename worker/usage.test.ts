import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USAGE } from "../src/core/usageConfig";
import { addDays } from "../src/core/usage";
import { Usage } from "./usage";

/** An in-memory stand-in for a Durable Object's storage. */
function storage() {
  const m = new Map<string, unknown>();
  return {
    m,
    get: async (k: string | string[]) => (Array.isArray(k) ? new Map(k.filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))])) : structuredClone(m.get(k))),
    put: async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
    delete: async (ks: string[]) => { for (const k of ks) m.delete(k); },
    list: async (o: { start?: string; end?: string; prefix?: string }) =>
      new Map([...m].filter(([k]) => (!o.prefix || k.startsWith(o.prefix)) && (!o.start || k >= o.start) && (!o.end || k < o.end)).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}
const make = () => { const s = storage(); return { s, obj: new Usage({ storage: s } as never, {} as never) }; };
const NOON = Date.UTC(2026, 10, 20, 18, 0); // 12:00 in Chicago
const first = (gap: number | null) => ({ gap, platform: "android" as const, installed: true });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOON); });
afterEach(() => vi.useRealTimers());

describe("Usage", () => {
  it("counts opens, new devices and the all-time total, and reports them", async () => {
    const { obj } = make();
    await obj.record({ kind: "open", first: first(null) });
    await obj.record({ kind: "open", first: first(null) });
    await obj.record({ kind: "open", first: first(4) });
    await obj.record({ kind: "event", name: "share" });
    const r = await obj.report(7);
    expect(r).toMatchObject({ allTimeUsers: 2, since: "2026-11-20", activeNow: 3 });
    expect(r.days.at(-1)).toMatchObject({ day: "2026-11-20", users: 3, newUsers: 2, opens: 3, installed: 3, counts: { share: 1 }, platforms: { android: 3 } });
    expect(r.days.at(-1)!.beats[12]).toBe(3);
  });
  it("sees yesterday's devices in the 7-day count", async () => {
    const { obj } = make();
    await obj.record({ kind: "open", first: first(null) });
    vi.setSystemTime(NOON + 86_400_000);
    await obj.record({ kind: "open", first: first(1) }); // the same device, back the next day
    const r = await obj.report(7);
    expect(r.days.at(-1)).toMatchObject({ day: "2026-11-21", users: 1, users7: 1 }); // one device, not two
    expect(r.allTimeUsers).toBe(1);
  });
  it("deletes days past the retention on a new day's first record", async () => {
    const { s, obj } = make();
    s.m.set(`d:${addDays("2026-11-20", -USAGE.keepDays - 3)}`, {});
    s.m.set(`d:${addDays("2026-11-20", -10)}`, {});
    await obj.record({ kind: "open", first: null });
    expect([...s.m.keys()].filter((k) => k.startsWith("d:"))).toEqual([`d:${addDays("2026-11-20", -10)}`, "d:2026-11-20"].sort());
  });
});
