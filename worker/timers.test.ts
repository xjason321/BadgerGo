import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RIDE_MS, nextPushAt } from "../src/core/timerPush";
import { Timers } from "./timers";
import { b64uEncode } from "./webpush";

const T0 = Date.UTC(2026, 10, 20, 18, 0, 0);

async function setup() {
  const kv = new Map<string, unknown>();
  const alarm = { at: null as number | null };
  const storage = {
    get: async (k: string) => structuredClone(kv.get(k)),
    put: async (k: string, v: unknown) => { kv.set(k, structuredClone(v)); },
    setAlarm: async (t: number) => { alarm.at = t; },
    deleteAlarm: async () => { alarm.at = null; },
    deleteAll: async () => { kv.clear(); },
  };
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const env = {
    VAPID_PUBLIC_KEY: b64uEncode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
  };
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: b64uEncode(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer)), auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))) },
  };
  return { kv, alarm, sub, obj: new Timers({ storage } as never, env as never) };
}

let status = 201;
let sent = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  status = 201; sent = 0;
  vi.stubGlobal("fetch", async () => { sent++; return new Response(null, { status }); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Timers", () => {
  it("starting a ride schedules the first push for a second after the first minute", async () => {
    const { obj, alarm, sub } = await setup();
    await obj.start(sub, T0);
    expect(alarm.at).toBe(nextPushAt(T0, T0));
  });
  it("starting again (the page reloaded) just keeps the same schedule", async () => {
    const { obj, alarm, sub } = await setup();
    await obj.start(sub, T0);
    vi.setSystemTime(T0 + 20_000);
    await obj.start(sub, T0);
    expect(alarm.at).toBe(nextPushAt(T0, T0));
  });
  it("each alarm sends one push and schedules the next minute", async () => {
    const { obj, alarm, sub } = await setup();
    await obj.start(sub, T0);
    for (let i = 1; i <= 3; i++) {
      vi.setSystemTime(alarm.at!);
      await obj.alarm();
      expect(sent).toBe(i);
      expect(alarm.at).toBe(T0 + (i + 1) * 60_000 + 1000);
    }
  });
  it("an alarm that is woken late skips to the next minute instead of sending a backlog", async () => {
    const { obj, alarm, sub } = await setup();
    await obj.start(sub, T0);
    vi.setSystemTime(T0 + 5 * 60_000 + 30_000);
    await obj.alarm();
    expect(sent).toBe(1);
    expect(alarm.at).toBe(T0 + 6 * 60_000 + 1000);
  });
  it("stopping the ride ends the pushes and forgets the phone", async () => {
    const { obj, alarm, kv, sub } = await setup();
    await obj.start(sub, T0);
    await obj.stop();
    expect(alarm.at).toBeNull();
    expect(kv.size).toBe(0);
    await obj.alarm(); // a stray alarm does nothing
    expect(sent).toBe(0);
  });
  it("a phone that dropped the subscription (410 / 404) is forgotten", async () => {
    for (const s of [410, 404]) {
      const { obj, alarm, kv, sub } = await setup();
      await obj.start(sub, T0);
      status = s;
      vi.setSystemTime(alarm.at!);
      await obj.alarm();
      expect(alarm.at).toBeNull();
      expect(kv.size).toBe(0);
    }
  });
  it("other failures (a hiccup at the push service, no network) try again next minute", async () => {
    const { obj, alarm, kv, sub } = await setup();
    await obj.start(sub, T0);
    status = 503;
    vi.setSystemTime(alarm.at!);
    await obj.alarm();
    expect(alarm.at).toBe(T0 + 2 * 60_000 + 1000);
    vi.stubGlobal("fetch", async () => { throw new TypeError("network"); });
    vi.setSystemTime(alarm.at!);
    await obj.alarm();
    expect(alarm.at).toBe(T0 + 3 * 60_000 + 1000);
    expect(kv.size).toBe(1);
  });
  it("rides stop after 3 hours", async () => {
    const { obj, alarm, kv, sub } = await setup();
    await obj.start(sub, T0);
    vi.setSystemTime(T0 + MAX_RIDE_MS + 1000);
    await obj.alarm();
    expect(sent).toBe(0);
    expect(alarm.at).toBeNull();
    expect(kv.size).toBe(0);
  });
  it("without push set up (no secrets) it sends nothing and clears itself", async () => {
    const { kv, alarm, sub } = await setup();
    const bare = new Timers({ storage: { get: async (k: string) => kv.get(k), put: async (k: string, v: unknown) => { kv.set(k, v); }, setAlarm: async () => {}, deleteAlarm: async () => { alarm.at = null; }, deleteAll: async () => { kv.clear(); } } } as never, {} as never);
    await bare.start(sub, T0);
    await bare.alarm();
    expect(sent).toBe(0);
    expect(kv.size).toBe(0);
  });
});

// --- The dock the rider is heading for ----------------------------------------------------------------------------
import { phone } from "./test/phone";

describe("Timers with an end dock", () => {
  type Msg = { title: string; body: string; tag: string; alert: boolean };
  const station = { id: "d1", name: "Capitol Square" };
  /** The live feed's numbers for the station; `feedStatus` other than 200 is BCycle's feed being down. */
  const feed = { docks: 5, bikes: 7, status: 200, fetches: 0 };

  async function ride() {
    const kv = new Map<string, unknown>();
    const alarm = { at: null as number | null };
    const storage = {
      get: async (k: string) => structuredClone(kv.get(k)),
      put: async (k: string, v: unknown) => { kv.set(k, structuredClone(v)); },
      setAlarm: async (t: number) => { alarm.at = t; },
      deleteAlarm: async () => { alarm.at = null; },
      deleteAll: async () => { kv.clear(); },
    };
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const env = {
      VAPID_PUBLIC_KEY: b64uEncode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
      VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    };
    const ph = await phone();
    const pushes: Msg[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("gbfs.bcycle.com")) {
        feed.fetches++;
        return feed.status !== 200
          ? new Response("down", { status: feed.status })
          : Response.json({ data: { stations: [{ station_id: "d1", num_bikes_available: feed.bikes, num_docks_available: feed.docks, is_renting: 1, is_returning: 1 }] } });
      }
      pushes.push(JSON.parse(await ph.open(init!.body as Uint8Array)));
      return new Response(null, { status: 201 });
    });
    const obj = new Timers({ storage } as never, env as never);
    /** The next alarm goes off: the pushes it sent. */
    const tick = async () => {
      const before = pushes.length;
      vi.setSystemTime(alarm.at!);
      await obj.alarm();
      return pushes.slice(before);
    };
    return { obj, alarm, kv, pushes, sub: ph.sub(), tick };
  }
  beforeEach(() => { feed.docks = 5; feed.bikes = 7; feed.status = 200; feed.fetches = 0; });

  it("every push says how many open docks and bikes are left at the end dock", async () => {
    const r = await ride();
    await r.obj.start(r.sub, T0, { ...station, docks: 5 });
    const [p] = await r.tick();
    expect(p).toMatchObject({ alert: false, title: "29 min left free", body: "Capitol Square: 5 open docks, 7 bikes. Dock before it runs out to avoid the $8 charge." });
    feed.docks = 4; feed.bikes = 6;
    expect((await r.tick())[0]!.body).toContain("Capitol Square: 4 open docks, 6 bikes");
  });
  it("the alerts at 10 and 5 minutes say it too", async () => {
    const r = await ride();
    await r.obj.start(r.sub, T0 - 24 * 60_000, { ...station, docks: 5 });
    await r.tick(); // 24:01, the countdown
    const [p] = await r.tick(); // 25:01
    expect(p).toMatchObject({ alert: true, title: "5 min left on your free ride", body: expect.stringContaining("Capitol Square: 5 open docks, 7 bikes") });
  });

  describe("the warning", () => {
    it("goes out, once and as its own loud notification, when the dock falls from safe to few", async () => {
      const r = await ride();
      await r.obj.start(r.sub, T0, { ...station, docks: 5 });
      expect(await r.tick()).toHaveLength(1);
      feed.docks = 2;
      const pushed = await r.tick();
      expect(pushed).toHaveLength(2);
      expect(pushed[0]).toMatchObject({ alert: false, body: expect.stringContaining("2 open docks") }); // the countdown, as usual
      expect(pushed[1]).toEqual({ alert: true, tag: "badgergo-timer-dock", title: "Only 2 open docks left at Capitol Square", body: expect.stringContaining("risky") });
      feed.docks = 1;
      expect(await r.tick()).toHaveLength(1); // still risky: no second warning
      feed.docks = 2;
      expect(await r.tick()).toHaveLength(1);
    });
    it("also when it falls straight to none", async () => {
      const r = await ride();
      await r.obj.start(r.sub, T0, { ...station, docks: 6 });
      await r.tick();
      feed.docks = 0;
      expect((await r.tick())[1]).toMatchObject({ alert: true, title: "No open docks at Capitol Square" });
    });
    it("warns again if it recovers to safe and then falls again", async () => {
      const r = await ride();
      await r.obj.start(r.sub, T0, { ...station, docks: 5 });
      feed.docks = 2; expect(await r.tick()).toHaveLength(2);
      feed.docks = 4; expect(await r.tick()).toHaveLength(1);
      feed.docks = 1; expect(await r.tick()).toHaveLength(2);
    });
    it("doesn't warn about a dock that was already risky when the ride began (the app showed that then)", async () => {
      const r = await ride();
      feed.docks = 1;
      await r.obj.start(r.sub, T0, { ...station, docks: 1 });
      expect(await r.tick()).toHaveLength(1);
      feed.docks = 0;
      expect(await r.tick()).toHaveLength(1);
    });
    it("with no starting number from the app, the first look is the baseline", async () => {
      const r = await ride();
      feed.docks = 1;
      await r.obj.start(r.sub, T0, station);
      expect(await r.tick()).toHaveLength(1); // risky from the start: nothing to compare
      const r2 = await ride();
      feed.docks = 6;
      await r2.obj.start(r2.sub, T0, station);
      await r2.tick();
      feed.docks = 2;
      expect(await r2.tick()).toHaveLength(2); // safe on the first look, then it fell
    });
    it("a page that reloads mid-ride doesn't reset what the server knows", async () => {
      const r = await ride();
      await r.obj.start(r.sub, T0, { ...station, docks: 5 });
      await r.tick();
      feed.docks = 2;
      expect(await r.tick()).toHaveLength(2); // warned
      await r.obj.start(r.sub, T0, { ...station, docks: 5 }); // the reloaded page still has old numbers
      expect(await r.tick()).toHaveLength(1); // no second warning
    });
    it("riding to another dock starts fresh", async () => {
      const r = await ride();
      await r.obj.start(r.sub, T0, { ...station, docks: 5 });
      feed.docks = 2;
      await r.tick();
      await r.obj.start(r.sub, T0, { id: "d2", name: "Union South", docks: 5 }); // same ride, different end dock
      expect(((await r.tick())[0]!).body).not.toContain("Capitol");
    });
  });

  it("when BCycle's feed is down the countdown still goes out, just without the dock line, and nothing is warned", async () => {
    const r = await ride();
    await r.obj.start(r.sub, T0, { ...station, docks: 5 });
    feed.status = 503;
    const pushed = await r.tick();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.body).not.toContain("open dock");
    expect(r.alarm.at).not.toBeNull(); // and it keeps going
  });
  it("a ride with no end dock never asks BCycle for anything", async () => {
    const r = await ride();
    await r.obj.start(r.sub, T0);
    await r.tick();
    expect(feed.fetches).toBe(0);
  });
  it("stops when the phone drops the subscription, even mid-warning", async () => {
    const r = await ride();
    await r.obj.start(r.sub, T0, { ...station, docks: 5 });
    vi.stubGlobal("fetch", async (url: string) => (url.includes("gbfs") ? Response.json({ data: { stations: [{ station_id: "d1", num_bikes_available: 1, num_docks_available: 0 }] } }) : new Response(null, { status: 410 })));
    vi.setSystemTime(r.alarm.at!);
    await r.obj.alarm();
    expect(r.alarm.at).toBeNull();
    expect(r.kv.size).toBe(0);
  });
});
