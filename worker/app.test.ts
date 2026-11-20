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

// --- Bike-timer pushes ---------------------------------------------------------------------------------------
import { b64uEncode, type PushSub } from "./webpush";

const NOW = 1_800_000_000_000;
const sub = (): PushSub => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: b64uEncode(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, i) => i)])), auth: b64uEncode(new Uint8Array(16).fill(7)) },
});
function timerSetup(over: Partial<Deps> = {}) {
  const started: { sub: PushSub; startedAt: number }[] = [];
  const stopped: string[] = [];
  const t = setup({ now: () => NOW, publicKey: "PUBKEY", timers: { start: async (s, startedAt) => { started.push({ sub: s, startedAt }); }, stop: async (e) => { stopped.push(e); } }, ...over });
  return { ...t, started, stopped };
}
const timerReq = (path: string, body: unknown, init: { origin?: string | null; method?: string } = {}) =>
  new Request(`https://badgergo.app${path}`, { method: init.method ?? "POST", headers: init.origin === null ? {} : { Origin: init.origin ?? ORIGIN }, ...(init.method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

describe("GET /api/push/key", () => {
  it("gives the public key the phone subscribes with", async () => {
    const t = timerSetup();
    const r = await handle(new Request("https://badgergo.app/api/push/key"), t.deps);
    expect(await r.json()).toEqual({ key: "PUBKEY" });
  });
  it("says it isn't set up when there is no key, so the app keeps its own notifications", async () => {
    const t = timerSetup({ publicKey: undefined, timers: undefined });
    expect((await handle(new Request("https://badgergo.app/api/push/key"), t.deps)).status).toBe(404);
  });
});

describe("POST /api/timer", () => {
  it("starts pushes for a ride", async () => {
    const t = timerSetup();
    const r = await handle(timerReq("/api/timer", { subscription: sub(), startedAt: NOW - 60_000 }), t.deps);
    expect(r.status).toBe(200);
    expect(t.started).toEqual([{ sub: sub(), startedAt: NOW - 60_000 }]);
  });
  it("only from the site's own pages, and only when push is set up", async () => {
    const t = timerSetup();
    for (const origin of ["https://evil.example", null]) expect((await handle(timerReq("/api/timer", { subscription: sub(), startedAt: NOW }, { origin }), t.deps)).status).toBe(403);
    expect((await handle(timerReq("/api/timer", { subscription: sub(), startedAt: NOW }, { method: "GET" }), t.deps)).status).toBe(405);
    const off = timerSetup({ timers: undefined });
    expect((await handle(timerReq("/api/timer", { subscription: sub(), startedAt: NOW }), off.deps)).status).toBe(404);
    expect(t.started).toEqual([]);
  });
  it("only sends to real push services, so the Worker can't be pointed at other sites", async () => {
    const t = timerSetup();
    for (const endpoint of ["https://evil.example/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://169.254.169.254/", "nope", 5]) {
      const r = await handle(timerReq("/api/timer", { subscription: { ...sub(), endpoint }, startedAt: NOW }), t.deps);
      expect(r.status, String(endpoint)).toBe(400);
    }
    for (const endpoint of ["https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
      expect((await handle(timerReq("/api/timer", { subscription: { ...sub(), endpoint }, startedAt: NOW }), t.deps)).status, endpoint).toBe(200);
    }
  });
  it("refuses bad keys and bad start times", async () => {
    const t = timerSetup();
    const good = sub();
    const bads: unknown[] = [
      { subscription: { ...good, keys: { ...good.keys, auth: b64uEncode(new Uint8Array(15)) } }, startedAt: NOW },
      { subscription: { ...good, keys: { ...good.keys, p256dh: b64uEncode(new Uint8Array(65).fill(5)) } }, startedAt: NOW }, // not an uncompressed point
      { subscription: { ...good, keys: { p256dh: "***", auth: good.keys.auth } }, startedAt: NOW },
      { subscription: { endpoint: good.endpoint }, startedAt: NOW },
      { subscription: good, startedAt: NOW - 4 * 3600_000 },
      { subscription: good, startedAt: NOW + 3600_000 },
      { subscription: good, startedAt: "now" },
      { subscription: good, startedAt: 1.5 },
      [], "{nope",
    ];
    for (const b of bads) expect((await handle(timerReq("/api/timer", b), t.deps)).status, JSON.stringify(b)).toBe(400);
    expect(t.started).toEqual([]);
  });
  it("refuses a big body", async () => {
    const t = timerSetup();
    expect((await handle(timerReq("/api/timer", "x".repeat(5000)), t.deps)).status).toBe(413);
  });
});

describe("POST /api/timer/stop", () => {
  it("ends the pushes", async () => {
    const t = timerSetup();
    expect((await handle(timerReq("/api/timer/stop", { endpoint: sub().endpoint }), t.deps)).status).toBe(200);
    expect(t.stopped).toEqual([sub().endpoint]);
  });
  it("same rules: the site's own pages, a real push service", async () => {
    const t = timerSetup();
    expect((await handle(timerReq("/api/timer/stop", { endpoint: sub().endpoint }, { origin: "https://evil.example" }), t.deps)).status).toBe(403);
    expect((await handle(timerReq("/api/timer/stop", { endpoint: "https://evil.example" }), t.deps)).status).toBe(400);
    expect(t.stopped).toEqual([]);
  });
});
