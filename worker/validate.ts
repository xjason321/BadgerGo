// Checks on what the Worker is sent. Anything malformed is refused with a 400, never counted.
import { USAGE } from "../src/core/usageConfig";
import type { UsageFirst, UsagePlatform, UsageRequest } from "../src/core/usageTypes";

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
export async function readJsonBody(request: Request): Promise<unknown> {
  const max = USAGE.maxBodyBytes;
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
