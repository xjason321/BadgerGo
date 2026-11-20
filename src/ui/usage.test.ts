import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USAGE } from "../core/usageConfig";
import { countUse, platform, resetUsageCounting, usageCountingOn } from "./usage";
import * as usage from "./usage";

const NOON = Date.UTC(2026, 10, 20, 18, 0); // Friday 12:00 in Chicago
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

/** A browser: storage, a network that can be down, and the privacy signals. */
function browser(o: { dnt?: string | null; gpc?: boolean; webdriver?: boolean; storage?: boolean; online?: boolean } = {}) {
  const mem: Record<string, string> = {};
  const sent: { url: string; body: any }[] = [];
  const net = { online: o.online ?? true };
  vi.stubGlobal("navigator", { userAgent: IPHONE, maxTouchPoints: 5, platform: "iPhone", doNotTrack: o.dnt ?? null, globalPrivacyControl: o.gpc, webdriver: o.webdriver });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => { if (o.storage === false) throw new Error("blocked"); mem[k] = v; },
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!net.online) throw new TypeError("offline");
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true } as Response;
  });
  return { mem, sent, net };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const stored = (b: { mem: Record<string, string> }) => JSON.parse(b.mem["badgergo.usage"] ?? "null");

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOON); resetUsageCounting(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("what a device reports", () => {
  it("a new device: its first open says it is new, with its kind of device and nothing else", async () => {
    const b = browser();
    // The hook's check-in, reached through the exported helper below.
    usage.reportCheckIn("open");
    await flush();
    expect(b.sent).toEqual([{ url: "/api/usage", body: { kind: "open", first: { gap: null, platform: "ios", installed: false } } }]);
    expect(stored(b)).toMatchObject({ day: "2026-11-20" });
  });
  it("a later check-in the same day carries no first", async () => {
    const b = browser();
    usage.reportCheckIn("open"); await flush();
    vi.setSystemTime(NOON + USAGE.beatMs + 1000);
    usage.reportCheckIn("beat"); await flush();
    expect(b.sent[1]!.body).toEqual({ kind: "beat", first: null });
  });
  it("a device back after three days reports the gap", async () => {
    const b = browser();
    b.mem["badgergo.usage"] = JSON.stringify({ day: "2026-11-17", window: 1 });
    usage.reportCheckIn("open"); await flush();
    expect(b.sent[0]!.body.first).toMatchObject({ gap: 3 });
  });
  it("offline: the day's first is kept for the next report, not lost", async () => {
    const b = browser({ online: false });
    usage.reportCheckIn("open"); await flush();
    expect(b.sent).toEqual([]);
    expect(stored(b).day).toBeNull(); // not marked as reported
    b.net.online = true;
    vi.setSystemTime(NOON + USAGE.beatMs + 1000);
    usage.reportCheckIn("beat"); await flush();
    expect(b.sent[0]!.body).toEqual({ kind: "beat", first: { gap: null, platform: "ios", installed: false } });
  });
  it("two tabs: the second one sees the window already taken", () => {
    const b = browser();
    b.mem["badgergo.usage"] = JSON.stringify({ day: "2026-11-20", window: Math.floor(NOON / USAGE.beatMs) });
    expect(usage.shouldBeat()).toBe(false);
    vi.setSystemTime(NOON + USAGE.beatMs);
    expect(usage.shouldBeat()).toBe(true);
  });
});

describe("when nothing is sent", () => {
  it.each([["Do Not Track", { dnt: "1" }], ["Global Privacy Control", { gpc: true }], ["an automated browser", { webdriver: true }]])("%s", async (_n, o) => {
    const b = browser(o);
    expect(usageCountingOn()).toBe(false);
    countUse("share"); await flush();
    expect(b.sent).toEqual([]);
  });
  it("storage blocked: a device couldn't tell a new day from a repeat, so it says nothing", async () => {
    const b = browser({ storage: false });
    usage.reportCheckIn("open"); await flush();
    expect(b.sent).toEqual([]);
  });
});

describe("feature counts and device kinds", () => {
  it("sends a feature use as just its name", async () => {
    const b = browser();
    countUse("ride_start"); await flush();
    expect(b.sent).toEqual([{ url: "/api/usage", body: { kind: "event", name: "ride_start" } }]);
  });
  it("tells iPhone, iPad (which says it is a Mac), Android and a computer apart", () => {
    expect(platform(IPHONE, 5, "iPhone")).toBe("ios");
    expect(platform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "MacIntel")).toBe("ios");
    expect(platform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "MacIntel")).toBe("desktop");
    expect(platform("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5, "Linux armv8l")).toBe("android");
    expect(platform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "Win32")).toBe("desktop");
  });
});
