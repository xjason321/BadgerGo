import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `npm run tunnel` (see .env.tunnel) sends routing requests to /valhalla on the dev server, which forwards them to
// your Valhalla box pretending to be http://localhost:5173 (the origin it allows). That way a tunnel URL works on a phone.
const valhalla = process.env.VALHALLA_TARGET || "https://routes.badgergo.app";

export default defineConfig({
  plugins: [react()],
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
  test: { environment: "node" },
});
