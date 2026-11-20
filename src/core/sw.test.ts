import { describe, expect, it } from "vitest";
import swSource from "../../public/sw.js?raw";

/** Load public/sw.js against an in-memory Cache API and a controllable network. */
function worker() {
  const stores = new Map<string, Map<string, Response>>();
  const disk = { full: false };
  const key = (r: Request | string) => (typeof r === "string" ? new URL(r, "https://badgergo.app").href : r.url);
  const open = async (n: string) => {
    if (!stores.has(n)) stores.set(n, new Map());
    const m = stores.get(n)!;
    return { match: async (r: Request | string) => m.get(key(r))?.clone(), put: async (r: Request | string, v: Response) => { if (disk.full) throw new DOMException("quota", "QuotaExceededError"); m.delete(key(r)); m.set(key(r), v); }, delete: async (r: string) => m.delete(key(r)), keys: async () => [...m.keys()].map((u) => new Request(u)) };
  };
  const caches = { open, keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) };
  const net = { up: true, calls: [] as string[] };
  const fetcher = async (r: Request) => {
    const u = typeof r === "string" ? r : r.url;
    net.calls.push(u);
    if (!net.up) throw new TypeError("offline");
    return new Response(`net:${u}`, { status: 200 });
  };
  const handlers: Record<string, (e: any) => void> = {};
  const opened: string[] = []; const focused: number[] = []; const wins: { focus: () => Promise<void> }[] = [];
  const self = { addEventListener: (t: string, h: (e: any) => void) => { handlers[t] = h; }, skipWaiting: () => {}, clients: { claim: async () => {}, matchAll: async () => wins, openWindow: async (u: string) => { opened.push(u); } } };
  new Function("self", "caches", "fetch", "location", "setTimeout", "Response", "URL", swSource)(self, caches, fetcher, { origin: "https://badgergo.app" }, setTimeout, Response, URL);
  /** Run a request through the worker: its response, or null when the worker doesn't touch it. */
  const run = async (url: string, init: { method?: string; mode?: string } = {}): Promise<Response | null> => {
    const req = { url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" } as unknown as Request;
    let out: Promise<Response> | null = null;
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => { out = p; } });
    return out;
  };
  /** Tap a notification: whether it closed, and what the worker did with the app window. */
  const tap = async () => {
    let closed = false; let work: Promise<unknown> | null = null;
    handlers.notificationclick({ notification: { close: () => { closed = true; } }, waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;
    return { closed };
  };
  return { run, net, stores, tap, opened, focused, wins, disk };
}
const text = async (r: Response | null) => (r ? r.text() : null);

describe("service worker", () => {
  it("leaves writes and live data alone", async () => {
    const w = worker();
    expect(await w.run("https://badgergo.app/x", { method: "POST" })).toBeNull();
    for (const u of ["https://gbfs.bcycle.com/bcycle_madison/station_status.json", "https://api.open-meteo.com/v1/forecast", "https://nominatim.openstreetmap.org/search", "https://routes.badgergo.app/route", "https://badgergo.app/valhalla/route"]) expect(await w.run(u)).toBeNull();
  });
  it("never keeps the usage dashboard or its numbers", async () => {
    const w = worker();
    expect(await w.run("https://badgergo.app/analytics", { mode: "navigate" })).toBeNull();
    expect(await w.run("https://badgergo.app/analytics.html", { mode: "navigate" })).toBeNull();
    expect(await w.run("https://badgergo.app/api/analytics?days=180")).toBeNull();
    // ...and visiting the dashboard doesn't replace the saved copy of the app that opens offline
    await w.run("https://badgergo.app/", { mode: "navigate" });
    w.net.up = false;
    expect(await text(await w.run("https://badgergo.app/", { mode: "navigate" }))).toBe("net:https://badgergo.app/");
  });
  it("keeps map tiles and serves them with no signal", async () => {
    const w = worker();
    const u = "https://tile.openstreetmap.org/15/8000/11000.png";
    expect(await text(await w.run(u))).toBe(`net:${u}`);
    w.net.up = false; w.net.calls.length = 0;
    expect(await text(await w.run(u))).toBe(`net:${u}`);
    expect(w.net.calls).toEqual([]); // came from the cache
  });
  it("fails a tile quietly when it was never seen and there's no signal", async () => {
    const w = worker(); w.net.up = false;
    expect((await w.run("https://tile.openstreetmap.org/1/1/1.png"))!.type).toBe("error");
  });
  it("opens the app from the last copy when offline", async () => {
    const w = worker();
    expect(await text(await w.run("https://badgergo.app/", { mode: "navigate" }))).toBe("net:https://badgergo.app/");
    w.net.up = false;
    expect(await text(await w.run("https://badgergo.app/?x=1", { mode: "navigate" }))).toBe("net:https://badgergo.app/");
  });
  it("can't open the app offline on a first visit", async () => {
    const w = worker(); w.net.up = false;
    expect((await w.run("https://badgergo.app/", { mode: "navigate" }))!.type).toBe("error");
  });
  it("reuses scripts and styles it has seen", async () => {
    const w = worker();
    await w.run("https://badgergo.app/assets/index-abc.js");
    await new Promise((r) => setTimeout(r, 0));
    w.net.up = false;
    expect(await text(await w.run("https://badgergo.app/assets/index-abc.js"))).toBe("net:https://badgergo.app/assets/index-abc.js");
  });
  it("never keeps more than 600 tiles", async () => {
    const w = worker();
    for (let i = 0; i < 605; i++) await w.run(`https://tile.openstreetmap.org/15/${i}/1.png`);
    await new Promise((r) => setTimeout(r, 20));
    const tiles = [...w.stores.entries()].find(([n]) => n.includes("tiles"))![1];
    expect(tiles.size).toBeLessThanOrEqual(600);
  });
});

describe("notification taps", () => {
  it("opens the app when it isn't open", async () => {
    const w = worker();
    expect((await w.tap()).closed).toBe(true);
    expect(w.opened).toEqual(["/"]);
  });
  it("brings the open app forward instead of opening another", async () => {
    const w = worker();
    w.wins.push({ focus: async () => { w.focused.push(1); } });
    await w.tap();
    expect(w.focused).toEqual([1]);
    expect(w.opened).toEqual([]);
  });
});

const proc = (globalThis as unknown as { process: { on: (e: string, f: (x: unknown) => void) => void; off: (e: string, f: (x: unknown) => void) => void } }).process;

describe("a full disk", () => {
  it("still shows tiles, pages and scripts (saving the copy just fails quietly)", async () => {
    const w = worker(); w.disk.full = true;
    const unhandled: unknown[] = []; const on = (e: unknown) => unhandled.push(e);
    proc.on("unhandledRejection", on);
    try {
      expect(await text(await w.run("https://tile.openstreetmap.org/15/1/1.png"))).toBe("net:https://tile.openstreetmap.org/15/1/1.png");
      expect(await text(await w.run("https://badgergo.app/", { mode: "navigate" }))).toBe("net:https://badgergo.app/");
      expect(await text(await w.run("https://badgergo.app/assets/a.js"))).toBe("net:https://badgergo.app/assets/a.js");
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally { proc.off("unhandledRejection", on); }
  });
  it("keeps the app's own files to a fixed number, but always the page", async () => {
    const w = worker();
    await w.run("https://badgergo.app/", { mode: "navigate" });
    for (let i = 0; i < 90; i++) { await w.run(`https://badgergo.app/assets/f${i}.js`); await new Promise((r) => setTimeout(r, 0)); }
    await new Promise((r) => setTimeout(r, 10));
    const app = [...w.stores.entries()].find(([k]) => k.startsWith("badgergo-app"))![1];
    expect(app.size).toBeLessThanOrEqual(81);
    expect(app.has("https://badgergo.app/")).toBe(true);
  });
});
