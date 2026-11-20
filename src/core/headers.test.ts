import { describe, expect, it } from "vitest";
import headers from "../../public/_headers?raw";

describe("site headers", () => {
  it("stops other sites from framing the app and browsers from guessing file types", () => {
    expect(headers).toMatch(/X-Frame-Options: DENY/);
    expect(headers).toMatch(/frame-ancestors 'none'/);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
  });
  it("still allows location (ride mode needs it)", () => expect(headers).toMatch(/geolocation=\(self\)/));
  it("re-checks the service worker on every visit", () => expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache/));
});
