// The Worker's request handling, with no Cloudflare imports so it can be tested: POST /api/usage counts an
// anonymous report, GET /api/analytics gives the dashboard's numbers. The site itself is static and is not served here.
import { USAGE } from "../src/core/usageConfig";
import type { StatsResponse, UsageRequest } from "../src/core/usageTypes";
import { AppError, readJsonBody, reportDays, usageRequest } from "./validate";

/** The Usage Durable Object's methods. */
export interface UsageRpc {
  record(req: UsageRequest): Promise<void>;
  report(days: number): Promise<StatsResponse>;
}

export interface Deps {
  usage: UsageRpc;
  /** Per-client-IP limit (Cloudflare's rate limiting binding); absent: no limit (tests, local dev). */
  limiter?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  now: () => number;
}

/** The dashboard is public, so a shared link must not turn into one Durable Object read per visit. */
const CACHE_MS = 30_000;
const cache = new Map<number, { atMs: number; body: StatsResponse }>();
/** Test hook. */
export const resetCache = (): void => cache.clear();

/** Crawlers, link previews, monitors and scripts are not visitors. A request with no User-Agent is one too. */
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|uptime|curl|wget|python|go-http|node-fetch|axios|java\//i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

async function limit(deps: Deps, request: Request): Promise<void> {
  const key = request.headers.get("CF-Connecting-IP") ?? "local";
  if (deps.limiter && !(await deps.limiter.limit({ key })).success) throw new AppError(429, "Too many requests");
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  try {
    const url = new URL(request.url);
    const method = request.method;
    if (url.pathname === "/api/usage") {
      if (method !== "POST") throw new AppError(405, "Method not allowed");
      // Browsers always send Origin on a POST: only the site itself may report (scripts can forge it; the rate limit is the backstop).
      if (!(USAGE.origins as readonly string[]).includes(request.headers.get("Origin") ?? "")) throw new AppError(403, "Forbidden");
      await limit(deps, request);
      const report = usageRequest(await readJsonBody(request));
      const ua = request.headers.get("User-Agent") ?? "";
      if (ua && !BOT_UA.test(ua)) await deps.usage.record(report);
      return json({ ok: true });
    }
    if (url.pathname === "/api/analytics") {
      if (method !== "GET") throw new AppError(405, "Method not allowed");
      await limit(deps, request);
      const days = reportDays(url.searchParams.get("days"));
      const hit = cache.get(days);
      if (hit && deps.now() - hit.atMs < CACHE_MS) return json(hit.body);
      const body = await deps.usage.report(days);
      cache.set(days, { atMs: deps.now(), body });
      return json(body);
    }
    throw new AppError(404, "Not found");
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    return json({ error: "Something went wrong" }, 500); // details stay in the Worker's logs
  }
}
