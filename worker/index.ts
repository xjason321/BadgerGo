// Cloudflare Worker for BadgerGo's anonymous usage counts. It runs on badgergo.app/api/* (wrangler.jsonc); the
// site itself stays a static site. Deploy: npm run deploy:stats.
import { handle } from "./app";
import { Usage, USAGE_OBJECT } from "./usage";

export { Usage };

interface Env {
  USAGE: DurableObjectNamespace<Usage>;
  USAGE_LIMITER?: RateLimit;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, { usage: env.USAGE.get(env.USAGE.idFromName(USAGE_OBJECT)), limiter: env.USAGE_LIMITER, now: Date.now });
  },
} satisfies ExportedHandler<Env>;
