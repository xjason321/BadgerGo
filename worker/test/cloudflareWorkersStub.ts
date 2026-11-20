// Stands in for the "cloudflare:workers" module in unit tests (vite.config.ts aliases it here).
export class DurableObject {
  constructor(readonly ctx: unknown, readonly env: unknown) {}
}
