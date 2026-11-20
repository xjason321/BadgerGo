import { describe, expect, it } from "vitest";
import manifestSource from "../../public/manifest.webmanifest?raw";
import html from "../../index.html?raw";

const manifest = JSON.parse(manifestSource) as {
  id: string; name: string; short_name: string; start_url: string; scope: string; display: string;
  theme_color: string; background_color: string; icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

/** What Chrome needs before "Add to home screen" installs a real app (no title/address bar) instead of a plain shortcut. */
describe("web app manifest", () => {
  it("is linked from the page, with a matching theme colour", () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toContain(`name="theme-color" content="${manifest.theme_color}"`);
  });
  it("opens standalone, with an id and a scope that contains the start page", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.name && manifest.short_name).toBeTruthy();
    expect(manifest.id).toBe("/");
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });
  it("has 192 and 512 icons plus a maskable one, all PNGs", () => {
    const has = (size: string, purpose: string) => manifest.icons.some((i) => i.sizes === size && (i.purpose ?? "any") === purpose && i.type === "image/png");
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
  });
});
