import { describe, expect, it } from "vitest";
import swSource from "../../public/sw.js?raw";

/** Load public/sw.js against an in-memory Cache API and a controllable network. */
function worker() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => (typeof r === "string" ? new URL(r, "https://badgergo.app").href : r.url);
  const open = async (n: string) => {
    if (!stores.has(n)) stores.set(n, new Map());
    const m = stores.get(n)!;
    return { match: async (r: Request | string) => m.get(key(r))?.clone(), put: async (r: Request | string, v: Response) => { m.delete(key(r)); m.set(key(r), v); }, delete: async (r: string) => m.delete(key(r)), keys: async () => [...m.keys()].map((u) => new Request(u)) };
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
  const self = { addEventListener: (t: string, h: (e: any) => void) => { handlers[t] = h; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
  new Function("self", "caches", "fetch", "location", "setTimeout", "Response", "URL", swSource)(self, caches, fetcher, { origin: "https://badgergo.app" }, setTimeout, Response, URL);
  /** Run a request through the worker: its response, or null when the worker doesn't touch it. */
  const run = async (url: string, init: { method?: string; mode?: string } = {}): Promise<Response | null> => {
    const req = { url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" } as unknown as Request;
    let out: Promise<Response> | null = null;
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => { out = p; } });
    return out;
  };
  return { run, net, stores };
}
const text = async (r: Response | null) => (r ? r.text() : null);

describe("service worker", () => {
  it("leaves writes and live data alone", async () => {
    const w = worker();
    expect(await w.run("https://badgergo.app/x", { method: "POST" })).toBeNull();
    for (const u of ["https://gbfs.bcycle.com/bcycle_madison/station_status.json", "https://api.open-meteo.com/v1/forecast", "https://nominatim.openstreetmap.org/search", "https://routes.badgergo.app/route", "https://badgergo.app/valhalla/route"]) expect(await w.run(u)).toBeNull();
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
