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
