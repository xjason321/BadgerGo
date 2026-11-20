// Checks on what the Worker is sent. Anything malformed is refused with a 400, never counted.
import { MAX_RIDE_MS } from "../src/core/timerPush";
import { USAGE } from "../src/core/usageConfig";
import type { UsageFirst, UsagePlatform, UsageRequest } from "../src/core/usageTypes";
import { b64uDecode, type PushSub } from "./webpush";

/** An error the Worker answers with `status` and a short message (never internal details). */
export class AppError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const bad = (m: string) => new AppError(400, m);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const PLATFORMS: readonly UsagePlatform[] = ["ios", "android", "desktop"];

function usageFirst(v: unknown): UsageFirst {
  if (!isObj(v)) throw bad("Invalid first");
  const gap = v.gap;
  if (gap !== null && !(typeof gap === "number" && Number.isInteger(gap) && gap >= 1 && gap <= USAGE.maxGapDays)) throw bad("Invalid gap");
  const platform = PLATFORMS.find((p) => p === v.platform);
  if (!platform) throw bad("Invalid platform");
  if (typeof v.installed !== "boolean") throw bad("Invalid installed");
  return { gap, platform, installed: v.installed };
}

export function usageRequest(body: unknown): UsageRequest {
  if (!isObj(body)) throw bad("Invalid body");
  if (body.kind === "event") {
    const name = USAGE.events.find((e) => e === body.name);
    if (!name) throw bad("Unknown event");
    return { kind: "event", name };
  }
  if (body.kind !== "open" && body.kind !== "beat") throw bad("Invalid kind");
  return { kind: body.kind, first: body.first === null || body.first === undefined ? null : usageFirst(body.first) };
}

/** ?days= for the dashboard: an integer in [1, USAGE.maxReportDays] (default 90). */
export function reportDays(raw: string | null): number {
  if (raw === null) return 90;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > USAGE.maxReportDays) throw bad("Invalid days");
  return n;
}

/** The request's JSON body: at most USAGE.maxBodyBytes, also when it is streamed without a Content-Length. */
export async function readJsonBody(request: Request, max: number = USAGE.maxBodyBytes): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? "0") > max) throw new AppError(413, "Body too large");
  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new AppError(413, "Body too large");
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    text = new TextDecoder().decode(all);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw bad("Body must be JSON");
  }
}

// --- Timer pushes ---------------------------------------------------------------------------------------------
/** Only real push services: the Worker sends a request to whatever address it is given, so it must not be an open relay. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];

function pushEndpoint(v: unknown): string {
  if (typeof v !== "string" || v.length > 700) throw bad("Invalid endpoint");
  let u: URL;
  try { u = new URL(v); } catch { throw bad("Invalid endpoint"); }
  if (u.protocol !== "https:" || u.port || u.username || u.password || !PUSH_HOSTS.some((re) => re.test(u.hostname))) throw bad("Invalid endpoint");
  return u.href;
}

function pushKey(v: unknown, bytes: number, first?: number): string {
  if (typeof v !== "string" || v.length > 200) throw bad("Invalid key");
  let raw: Uint8Array;
  try { raw = b64uDecode(v); } catch { throw bad("Invalid key"); }
  if (raw.length !== bytes || (first !== undefined && raw[0] !== first)) throw bad("Invalid key");
  return v;
}

function pushSubscription(v: unknown): PushSub {
  if (!isObj(v) || !isObj(v.keys)) throw bad("Invalid subscription");
  return { endpoint: pushEndpoint(v.endpoint), keys: { p256dh: pushKey(v.keys.p256dh, 65, 4), auth: pushKey(v.keys.auth, 16) } };
}

/** POST /api/timer: a ride started at `startedAt` (ms), to be pushed to `subscription`. */
export function timerStartRequest(body: unknown, now: number): { subscription: PushSub; startedAt: number } {
  if (!isObj(body)) throw bad("Invalid body");
  const { startedAt } = body;
  if (typeof startedAt !== "number" || !Number.isInteger(startedAt) || startedAt < now - MAX_RIDE_MS || startedAt > now + 5 * 60_000) throw bad("Invalid start");
  return { subscription: pushSubscription(body.subscription), startedAt };
}

/** POST /api/timer/stop */
export function timerStopRequest(body: unknown): { endpoint: string } {
  if (!isObj(body)) throw bad("Invalid body");
  return { endpoint: pushEndpoint(body.endpoint) };
}
