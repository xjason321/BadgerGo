import { describe, expect, it } from "vitest";
import { bearing, legViews, streetViewUrl, viewUrl } from "./streetView";

const o = { lat: 43.07, lon: -89.4 };

describe("bearing", () => {
  it("points to the four directions", () => {
    expect(bearing(o, { lat: 43.08, lon: -89.4 })).toBeCloseTo(0, 0);
    expect(bearing(o, { lat: 43.07, lon: -89.39 })).toBeCloseTo(90, 0);
    expect(bearing(o, { lat: 43.06, lon: -89.4 })).toBeCloseTo(180, 0);
    expect(bearing(o, { lat: 43.07, lon: -89.41 })).toBeCloseTo(270, 0);
  });
  it("stays within 0-360", () => {
    for (const d of [[0.01, 0.01], [-0.01, -0.01], [0.01, -0.01], [-0.01, 0.01]]) {
      const b = bearing(o, { lat: o.lat + d[0], lon: o.lon + d[1] });
      expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(360);
    }
  });
});

describe("streetViewUrl", () => {
  it("builds a pano link at a point", () => expect(streetViewUrl(o)).toBe("https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.070000,-89.400000"));
  it("adds the heading, level pitch and a normal field of view", () => expect(streetViewUrl(o, 90.4)).toBe("https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.070000,-89.400000&heading=90&pitch=0&fov=90"));
  it("wraps a heading of 360 back to 0", () => expect(streetViewUrl(o, 359.9)).toContain("heading=0&"));
});

describe("legViews", () => {
  // A route that goes north ~220 m, then east ~220 m.
  const g: [number, number][] = [[43.07, -89.4], [43.0710, -89.4], [43.0720, -89.4], [43.0720, -89.3985], [43.0720, -89.397]];
  it("faces the way the route leaves, and the way it arrives", () => {
    const v = legViews(g)!;
    expect(v.start.point).toEqual({ lat: 43.07, lon: -89.4 });
    expect(v.start.heading).toBeCloseTo(0, 0);
    expect(v.end.point).toEqual({ lat: 43.072, lon: -89.397 });
    expect(v.end.heading).toBeCloseTo(90, 0);
  });
  it("skips tiny wiggles near the start when finding the direction", () => {
    const wiggly: [number, number][] = [[43.07, -89.4], [43.07, -89.40001], [43.0705, -89.40001], [43.0715, -89.40001]];
    const h = legViews(wiggly)!.start.heading;
    expect(Math.min(h, 360 - h)).toBeLessThan(10); // roughly north, however it wraps
  });
  it("returns null with no usable geometry", () => {
    expect(legViews([])).toBeNull();
    expect(legViews([[43.07, -89.4]])).toBeNull();
    expect(legViews([[43.07, -89.4], [43.07, -89.4]])).toBeNull();
  });
  it("viewUrl uses the view's point and heading", () => expect(viewUrl({ point: o, heading: 180 })).toContain("heading=180"));
});
