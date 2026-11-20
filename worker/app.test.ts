import { beforeEach, describe, expect, it } from "vitest";
import { USAGE } from "../src/core/usageConfig";
import type { UsageRequest } from "../src/core/usageTypes";
import { handle, resetCache, type Deps } from "./app";

const ORIGIN = USAGE.origins[0];
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const stats = { timeZone: "America/Chicago", generatedAtMs: 1, activeNow: 2, allTimeUsers: 3, since: null, days: [] };

function setup(over: Partial<Deps> = {}) {
  const recorded: UsageRequest[] = [];
  let reports = 0;
  const deps: Deps = { usage: { record: async (r) => { recorded.push(r); }, report: async () => { reports++; return stats; } }, now: () => 1000, ...over };
  return { deps, recorded, reports: () => reports };
}
const post = (body: unknown, h: Record<string, string> = {}) =>
  new Request("https://badgergo.app/api/usage", { method: "POST", headers: { Origin: ORIGIN, "User-Agent": UA, ...h }, body: typeof body === "string" ? body : JSON.stringify(body) });
const open = { kind: "open", first: { gap: null, platform: "ios", installed: false } };

beforeEach(() => resetCache());

describe("POST /api/usage", () => {
  it("counts a report from the site", async () => {
    const t = setup();
    const r = await handle(post(open), t.deps);
    expect(r.status).toBe(200);
    expect(t.recorded).toEqual([open]);
  });
  it("only takes reports from the site's own pages", async () => {
    const t = setup();
    expect((await handle(post(open, { Origin: "https://evil.example" }), t.deps)).status).toBe(403);
    const none = new Request("https://badgergo.app/api/usage", { method: "POST", headers: { "User-Agent": UA }, body: JSON.stringify(open) });
    expect((await handle(none, t.deps)).status).toBe(403);
    expect(t.recorded).toEqual([]);
  });
  it("answers bots and scripts with success but doesn't count them", async () => {
    const t = setup();
    for (const ua of ["Googlebot/2.1", "curl/8.0", "python-requests/2.31", "HeadlessChrome/120", ""]) {
      expect((await handle(post(open, { "User-Agent": ua }), t.deps)).status).toBe(200);
    }
    expect(t.recorded).toEqual([]);
  });
  it("refuses anything malformed", async () => {
    const t = setup();
    for (const body of ["{nope", [], { kind: "x" }, { kind: "event", name: "hack" }, { kind: "open", first: { gap: 0, platform: "ios", installed: false } }, { kind: "open", first: { gap: 5, platform: "tv", installed: false } }, { kind: "open", first: { gap: 5, platform: "ios", installed: "yes" } }]) {
      expect((await handle(post(body), t.deps)).status, JSON.stringify(body)).toBe(400);
    }
    expect(t.recorded).toEqual([]);
  });
  it("refuses a big body, also when it is streamed with no length", async () => {
    const t = setup();
    expect((await handle(post("x".repeat(USAGE.maxBodyBytes + 1)), t.deps)).status).toBe(413);
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{" + " ".repeat(USAGE.maxBodyBytes + 5))); c.close(); } });
    const req = new Request("https://badgergo.app/api/usage", { method: "POST", headers: { Origin: ORIGIN, "User-Agent": UA }, body: stream, duplex: "half" } as RequestInit);
    expect((await handle(req, t.deps)).status).toBe(413);
  });
  it("is limited per client", async () => {
    const t = setup({ limiter: { limit: async ({ key }) => ({ success: key !== "9.9.9.9" }) } });
    expect((await handle(post(open, { "CF-Connecting-IP": "1.1.1.1" }), t.deps)).status).toBe(200);
    expect((await handle(post(open, { "CF-Connecting-IP": "9.9.9.9" }), t.deps)).status).toBe(429);
  });
  it("only accepts POST", async () => {
    expect((await handle(new Request("https://badgergo.app/api/usage"), setup().deps)).status).toBe(405);
  });
});

describe("GET /api/analytics", () => {
  const get = (q = "") => new Request(`https://badgergo.app/api/analytics${q}`);
  it("returns the numbers, with nothing cached by browsers or shared caches", async () => {
    const r = await handle(get("?days=30"), setup().deps);
    expect(await r.json()).toEqual(stats);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
  it("reads the Durable Object once per 30 seconds however many visits", async () => {
    let now = 1000;
    const t = setup({ now: () => now });
    await handle(get("?days=30"), t.deps); await handle(get("?days=30"), t.deps);
    expect(t.reports()).toBe(1);
    now += 31_000;
    await handle(get("?days=30"), t.deps);
    expect(t.reports()).toBe(2);
    await handle(get("?days=7"), t.deps); // another range is its own answer
    expect(t.reports()).toBe(3);
  });
  it("checks ?days=", async () => {
    for (const q of ["?days=0", "?days=366", "?days=abc", "?days=1.5"]) expect((await handle(get(q), setup().deps)).status, q).toBe(400);
    expect((await handle(get("?days=365"), setup().deps)).status).toBe(200);
    expect((await handle(get(), setup().deps)).status).toBe(200);
  });
  it("answers a failing Durable Object with a plain 500 and no details", async () => {
    const t = setup({ usage: { record: async () => {}, report: async () => { throw new Error("secret storage detail"); } } });
    const r = await handle(get(), t.deps);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toMatch(/secret/);
  });
});

it("knows nothing else", async () => {
  expect((await handle(new Request("https://badgergo.app/api/other"), setup().deps)).status).toBe(404);
});
