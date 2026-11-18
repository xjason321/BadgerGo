import { VALHALLA_URL } from "../config";
import { bicycleCosting } from "./prefs";
import { decodePolyline } from "./polyline";
import type { LatLng, RoadPrefs, Segment } from "./types";

/**
 * A routing provider turns two points into routes and a set of docks into a ride-time matrix.
 * Swap implementations (Valhalla, OSRM, Google Directions) behind this interface.
 */
export interface RoutingProvider {
  /** `exclude`: points whose nearest road edges must not be used (bike routing, Valhalla only). */
  route(mode: "walk" | "bike", from: LatLng, to: LatLng, alternatives: boolean, exclude?: LatLng[]): Promise<Segment[]>;
  /** Bike minutes from one point to each of `targets`; null where there is no route. */
  row(from: LatLng, targets: LatLng[]): Promise<(number | null)[]>;
  /** Bike minutes from every point to every other point; null where there is no route. */
  matrix(points: LatLng[]): Promise<(number | null)[][]>;
}

/** The router answered but there is genuinely no route (as opposed to being down). */
export class NoRouteError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaultFetch: typeof fetch = (i, o) => fetch(i, o);

// ---------------------------------------------------------------------------------------------
// Valhalla (public FOSSGIS instance): honours road-type preferences.
// ---------------------------------------------------------------------------------------------
/** The public server rejects matrix requests with more than 100 source-target pairs. */
const BLOCK = 10;
/**
 * A dock's map point snaps to the nearest street, which may be a one-way or the wrong one for
 * the direction you want to leave in, forcing a loop around the block. With a radius the router
 * considers every street within this many metres and starts from whichever is best.
 */
const DOCK_RADIUS_M = 30;
const REQUEST_TIMEOUT_MS = 10_000;
/** Identical requests (same prefs, same points) are answered from memory, sparing the free server. */
const responseCache = new Map<string, any>();
const cacheKey = (base: string, path: string, body: unknown) => `${base}${path}|${JSON.stringify(body)}`;

export class ValhallaProvider implements RoutingProvider {
  /**
   * Don't store bare `fetch` and call it as `this.f(...)`: browsers throw "Illegal invocation"
   * when fetch runs with any `this` other than window.
   */
  constructor(
    private prefs: RoadPrefs,
    private f: typeof fetch = defaultFetch,
    private baseUrl: string = VALHALLA_URL,
  ) {}

  /** text/plain keeps this a "simple" CORS request (no preflight) and avoids URL length limits. */
  private async post(path: string, body: unknown, retry = true): Promise<any> {
    const key = cacheKey(this.baseUrl, path, body);
    if (responseCache.has(key)) return responseCache.get(key);
    const data = await this.fetchJson(path, body, retry);
    responseCache.set(key, data);
    return data;
  }

  private async fetchJson(path: string, body: unknown, retry: boolean): Promise<any> {
    // Fail fast so a struggling free server hands over to the backup router quickly.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.f(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      // Network error, timeout, or a throttling 429 the browser hides behind a CORS failure.
      if (retry && !ctl.signal.aborted) {
        await sleep(800);
        return this.fetchJson(path, body, false);
      }
      throw new Error(ctl.signal.aborted ? "Routing timed out" : "Routing service unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && retry) {
      await sleep(800);
      return this.fetchJson(path, body, false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = `Routing failed (${res.status}${data?.error ? `: ${data.error}` : ""})`;
      // 171 / 442: no suitable edges / no path. Not an outage.
      if ([171, 442, 443].includes(data?.error_code)) throw new NoRouteError(msg);
      throw new Error(msg);
    }
    return data;
  }

  private costing(mode: "walk" | "bike") {
    return mode === "bike"
      ? { costing: "bicycle", costing_options: bicycleCosting(this.prefs) }
      : { costing: "pedestrian" };
  }

  async route(mode: "walk" | "bike", from: LatLng, to: LatLng, alternatives: boolean, exclude?: LatLng[]): Promise<Segment[]> {
    const data = await this.post("/route", {
      ...(exclude?.length ? { exclude_locations: exclude.map((p) => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) })) } : {}),
      locations: [
        { lat: from.lat, lon: from.lon, ...(mode === "bike" ? { radius: DOCK_RADIUS_M } : {}) },
        { lat: to.lat, lon: to.lon, ...(mode === "bike" ? { radius: DOCK_RADIUS_M } : {}) },
      ],
      ...this.costing(mode),
      directions_type: "none",
      ...(alternatives ? { alternates: 2 } : {}),
    });
    const trips = [data.trip, ...(data.alternates ?? []).map((a: any) => a.trip)].filter(Boolean);
    return trips.map((t: any): Segment => {
      const shape: string = t.legs[0].shape;
      return {
        mode,
        durationMin: t.summary.time / 60,
        distanceM: t.summary.length * 1000,
        geometry: decodePolyline(shape),
        shape,
      };
    });
  }

  async row(from: LatLng, targets: LatLng[]): Promise<(number | null)[]> {
    const pt = (p: LatLng) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), radius: DOCK_RADIUS_M });
    const out: (number | null)[] = targets.map(() => null);
    const CHUNK = 100; // the matrix limit is on source-target pairs
    for (let j = 0; j < targets.length; j += CHUNK) {
      const data = await this.post("/sources_to_targets", {
        sources: [pt(from)],
        targets: targets.slice(j, j + CHUNK).map(pt),
        ...this.costing("bike"),
      });
      for (const c of data.sources_to_targets[0] as any[]) out[j + c.to_index] = c.time == null ? null : c.time / 60;
    }
    return out;
  }

  async matrix(points: LatLng[]): Promise<(number | null)[][]> {
    const pts = points.map((p) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), radius: DOCK_RADIUS_M }));
    const out: (number | null)[][] = pts.map(() => pts.map(() => null));
    const jobs: (() => Promise<void>)[] = [];
    for (let i = 0; i < pts.length; i += BLOCK) {
      for (let j = 0; j < pts.length; j += BLOCK) {
        jobs.push(async () => {
          const data = await this.post("/sources_to_targets", {
            sources: pts.slice(i, i + BLOCK),
            targets: pts.slice(j, j + BLOCK),
            ...this.costing("bike"),
          });
          for (const row of data.sources_to_targets as any[][]) {
            for (const c of row) out[i + c.from_index][j + c.to_index] = c.time == null ? null : c.time / 60;
          }
        });
      }
    }
    // A few at a time: be polite to the free public server.
    const queue = [...jobs];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let job = queue.shift(); job; job = queue.shift()) await job();
      }),
    );
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// OSRM (public FOSSGIS servers): backup router. Ignores road-type preferences.
// ---------------------------------------------------------------------------------------------
const OSRM: Record<"walk" | "bike", string> = {
  bike: "https://routing.openstreetmap.de/routed-bike",
  walk: "https://routing.openstreetmap.de/routed-foot",
};

/** OSRM fetch that gives up after 8 s (the public server sometimes just hangs). */
const osrmFetch: typeof fetch = (i, o) => fetch(i, { ...o, signal: AbortSignal.timeout(8000) });

export class OsrmProvider implements RoutingProvider {
  constructor(private f: typeof fetch = osrmFetch) {}

  async route(mode: "walk" | "bike", from: LatLng, to: LatLng, alternatives: boolean): Promise<Segment[]> {
    const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
    const url = `${OSRM[mode]}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=${alternatives}`;
    const res = await this.f(url);
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const data = await res.json();
    if (data.code === "NoRoute") throw new NoRouteError("No route");
    if (data.code !== "Ok") throw new Error(`Routing error: ${data.code}`);
    return data.routes.map((r: any): Segment => ({
      mode,
      durationMin: r.duration / 60,
      distanceM: r.distance,
      geometry: r.geometry.coordinates.map(([lon, lat]: [number, number]) => [lat, lon]),
    }));
  }

  async row(from: LatLng, targets: LatLng[]): Promise<(number | null)[]> {
    const all = [from, ...targets];
    const coords = all.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    const dest = targets.map((_, i) => i + 1).join(";");
    const res = await this.f(`${OSRM.bike}/table/v1/driving/${coords}?sources=0&destinations=${dest}&annotations=duration`);
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const data = await res.json();
    if (data.code !== "Ok") throw new Error(`Routing error: ${data.code}`);
    return data.durations[0].map((s: number | null) => (s == null ? null : s / 60));
  }

  async matrix(points: LatLng[]): Promise<(number | null)[][]> {
    const coords = points.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    const res = await this.f(`${OSRM.bike}/table/v1/driving/${coords}?annotations=duration`);
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const data = await res.json();
    if (data.code !== "Ok") throw new Error(`Routing error: ${data.code}`);
    return data.durations.map((row: (number | null)[]) => row.map((s) => (s == null ? null : s / 60)));
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * Use `primary` for bike routing; if it is down (not just "no route"), quietly use `secondary`
 * and remember why. Walking has no road-type preferences, so it always goes to `secondary`
 * and never touches the (rate-limited) preference router.
 */
export class FallbackProvider implements RoutingProvider {
  fellBack = false;
  reason = "";
  constructor(private primary: RoutingProvider, private secondary: RoutingProvider) {}

  private async bike<T>(fn: (p: RoutingProvider) => Promise<T>): Promise<T> {
    if (!this.fellBack) {
      try {
        return await fn(this.primary);
      } catch (e) {
        if (e instanceof NoRouteError) throw e;
        this.fellBack = true;
        this.reason = (e as Error).message;
      }
    }
    return fn(this.secondary);
  }
  route(mode: "walk" | "bike", from: LatLng, to: LatLng, alternatives: boolean, exclude?: LatLng[]) {
    if (mode === "walk") {
      // Pedestrian routing on our own server (no bike preferences apply); public OSRM only if that fails.
      return this.primary.route(mode, from, to, alternatives).catch((e) => {
        if (e instanceof NoRouteError) throw e;
        return this.secondary.route(mode, from, to, alternatives);
      });
    }
    return this.bike((p) => p.route(mode, from, to, alternatives, exclude));
  }
  row(from: LatLng, targets: LatLng[]) {
    return this.bike((p) => p.row(from, targets));
  }
  matrix(points: LatLng[]) {
    return this.bike((p) => p.matrix(points));
  }
}
