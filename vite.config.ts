import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

/**
 * Content Security Policy for the built site: the page may only run its own scripts and talk to the services it uses,
 * so even if some text ever slipped into the page as HTML it couldn't run code or send data elsewhere.
 * Build only: the dev server injects its own inline scripts. Add a host here when the app starts using a new service.
 */
function csp(valhallaUrl: string | undefined): Plugin {
  let valhalla = "";
  try { if (valhallaUrl && /^https?:/.test(valhallaUrl)) valhalla = new URL(valhallaUrl).origin; } catch { /* relative (/valhalla) is covered by 'self' */ }
  const connect = [
    "'self'",
    valhalla,
    "https://valhalla1.openstreetmap.de",
    "https://routing.openstreetmap.de",
    "https://gbfs.bcycle.com",
    "https://nominatim.openstreetmap.org",
    "https://photon.komoot.io",
    "https://api.open-meteo.com",
    "https://cloudflareinsights.com",
  ].filter(Boolean);
  const policy = [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com", // Cloudflare adds its visitor-count script to the page
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Leaflet and the markers set inline styles
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return {
    name: "badgergo-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }],
  };
}

// `npm run tunnel` (see .env.tunnel) sends routing requests to /valhalla on the dev server, which forwards them to
// your Valhalla box pretending to be http://localhost:5173 (the origin it allows). That way a tunnel URL works on a phone.
const valhalla = process.env.VALHALLA_TARGET || "https://routes.badgergo.app";

/** The usage dashboard is a second page (analytics.html), served at /analytics. The built site gets this from its host; the dev and preview servers need it spelled out. */
function analyticsRoute(): Plugin {
  const rewrite = (req: { url?: string }) => { if (req.url && /^\/analytics(\?|$)/.test(req.url)) req.url = req.url.replace("/analytics", "/analytics.html"); };
  return {
    name: "badgergo-analytics-route",
    configureServer: (s) => { s.middlewares.use((req, _res, next) => { rewrite(req); next(); }); },
    configurePreviewServer: (s) => { s.middlewares.use((req, _res, next) => { rewrite(req); next(); }); },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), analyticsRoute(), csp(loadEnv(mode, process.cwd(), "VITE_").VITE_VALHALLA_URL)],
  build: { rollupOptions: { input: { main: resolve(process.cwd(), "index.html"), analytics: resolve(process.cwd(), "analytics.html") } } },
  server: {
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
    proxy: {
      "/valhalla": {
        target: valhalla,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/valhalla/, ""),
        configure: (proxy) => proxy.on("proxyReq", (req) => req.setHeader("Origin", "http://localhost:5173")),
      },
    },
  },
  test: { environment: "node", alias: { "cloudflare:workers": fileURLToPath(new URL("./worker/test/cloudflareWorkersStub.ts", import.meta.url)) } },
}));
