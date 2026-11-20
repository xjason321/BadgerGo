import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyBytes, startPush, stopPush } from "./timerPush";

const KEY = "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x", auth: "y" } };

function phone(o: { push?: boolean; key?: number; existing?: boolean | "other-key"; subscribeFails?: number; server?: number } = {}) {
  const calls: { url: string; body?: any }[] = [];
  const options = (other: boolean) => ({ applicationServerKey: other ? new Uint8Array(65).buffer : keyBytes(KEY).buffer });
  const subs = { current: o.existing ? { endpoint: SUB.endpoint, options: options(o.existing === "other-key"), toJSON: () => SUB, unsubscribe: async () => { subs.current = null; return true; } } : null } as { current: any };
  let failsLeft = o.subscribeFails ?? 0;
  const subscribed: unknown[] = [];
  const pushManager = {
    getSubscription: async () => subs.current,
    subscribe: async (opts: unknown) => {
      if (failsLeft-- > 0) throw new DOMException("different key", "InvalidStateError");
      subscribed.push(opts);
      subs.current = { endpoint: SUB.endpoint, options: options(false), toJSON: () => SUB, unsubscribe: async () => { subs.current = null; return true; } };
      return subs.current;
    },
  };
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => (o.push === false ? undefined : { pushManager }) } });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/push/key") return o.key === 404 ? new Response("{}", { status: 404 }) : Response.json({ key: KEY });
    return new Response("{}", { status: o.server ?? 200 });
  });
  return { calls, subs, subscribed };
}
beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("starting pushes", () => {
  it("subscribes with the server's key and tells the server about the ride", async () => {
    const p = phone();
    expect(await startPush(1234)).toBe(true);
    expect(p.subscribed).toEqual([{ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }]);
    expect(p.calls.at(-1)).toEqual({ url: "/api/timer", body: { subscription: SUB, startedAt: 1234 } });
  });
  it("tells the server which dock the ride is heading for, and how many open docks it has now", async () => {
    const p = phone();
    await startPush(1234, { id: "d1", name: "Capitol Square", docks: 4 });
    expect(p.calls.at(-1)).toEqual({ url: "/api/timer", body: { subscription: SUB, startedAt: 1234, endDock: { id: "d1", name: "Capitol Square", docks: 4 } } });
  });
  it("reuses the phone's subscription for the next ride, or after a reload", async () => {
    const p = phone({ existing: true });
    expect(await startPush(1234)).toBe(true);
    expect(p.subscribed).toEqual([]);
  });
  it("replaces a subscription made with another key, even when the browser doesn't object", async () => {
    const p = phone({ existing: "other-key" });
    expect(await startPush(1234)).toBe(true);
    expect(p.subscribed).toEqual([{ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }]);
  });
  it("and when the browser refuses a second subscription until the old one is dropped", async () => {
    const p = phone({ existing: true, subscribeFails: 1 });
    p.subs.current = null; // nothing reported, but subscribing still throws once
    expect(await startPush(1234)).toBe(true);
    expect(p.subscribed).toHaveLength(1);
  });
  it("says no, without trouble, when push can't work: no service worker, not set up, server refuses, no network", async () => {
    phone({ push: false });
    expect(await startPush(1)).toBe(false);
    phone({ key: 404 });
    expect(await startPush(1)).toBe(false);
    phone({ server: 503 });
    expect(await startPush(1)).toBe(false);
    phone({ subscribeFails: 5 });
    expect(await startPush(1)).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await startPush(1)).toBe(false);
  });
});

describe("stopping pushes", () => {
  it("tells the server which phone, and only if there is a subscription", async () => {
    const p = phone({ existing: true });
    await stopPush();
    expect(p.calls).toEqual([{ url: "/api/timer/stop", body: { endpoint: SUB.endpoint } }]);
    const q = phone();
    await stopPush();
    expect(q.calls).toEqual([]);
  });
  it("never throws", async () => {
    vi.stubGlobal("navigator", {});
    await expect(stopPush()).resolves.toBeUndefined();
  });
});

describe("the key", () => {
  it("decodes base64url to the 65-byte public key", () => {
    const b = keyBytes(KEY);
    expect(b).toHaveLength(65);
    expect(b[0]).toBe(4);
    expect(b[62]).toBe(62);
  });
});
