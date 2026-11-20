// Cloudflare Worker for BadgerGo's anonymous usage counts. It runs on badgergo.app/api/* (wrangler.stats.jsonc); the
// site itself stays a static site. Deploy: npm run deploy:stats.
import { handle } from "./app";
import { Timers, type TimersEnv } from "./timers";
import { Usage, USAGE_OBJECT } from "./usage";
import { vapidFromEnv } from "./webpush";

export { Timers, Usage };

/** One Timers instance per phone: named by a hash of its push address, which the Worker never logs or lists. */
async function timerId(env: Env, endpoint: string): Promise<DurableObjectId> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return env.TIMERS.idFromName(Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(""));
}

interface Env extends TimersEnv {
  USAGE: DurableObjectNamespace<Usage>;
  TIMERS: DurableObjectNamespace<Timers>;
  USAGE_LIMITER?: RateLimit;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const pushOn = vapidFromEnv(env) !== null;
    return handle(request, {
      usage: env.USAGE.get(env.USAGE.idFromName(USAGE_OBJECT)),
      limiter: env.USAGE_LIMITER,
      now: Date.now,
      publicKey: pushOn ? env.VAPID_PUBLIC_KEY : undefined,
      timers: pushOn
        ? {
            start: async (sub, startedAt) => env.TIMERS.get(await timerId(env, sub.endpoint)).start(sub, startedAt),
            stop: async (endpoint) => env.TIMERS.get(await timerId(env, endpoint)).stop(),
          }
        : undefined,
    });
  },
} satisfies ExportedHandler<Env>;
