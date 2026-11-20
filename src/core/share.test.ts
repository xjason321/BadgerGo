import { describe, expect, it } from "vitest";
import { chainFromIds, decodeShare, encodeShare, readShareParam, shareFromPlan, shareUrl, type SharedRoute } from "./share";
import { myBikeStation } from "./myBike";
import { DEFAULT_PREFS, type Plan, type Station } from "./types";

const st = (id: string): Station => ({ id, name: id, lat: 43, lon: -89, bikesAvailable: 2, docksAvailable: 2, isRenting: true, isReturning: true });
const route = (over: Partial<SharedRoute> = {}): SharedRoute => ({
  origin: { lat: 43.07312, lon: -89.40123, label: "Memorial Union, Madison" },
  destination: { lat: 43.0766, lon: -89.4125, label: "Union South — café ☕" },
  stationIds: ["a1", "b2", "c3"],
  walkOnly: false,
  bikeLeft: null,
  swapsOn: true,
  maxRide: 25,
  prefs: { traffic: 2, strict: true, unpaved: "ok", hills: "avoid" },
  ...over,
});

describe("share links", () => {
  it("round-trips a route exactly, including unicode names and every preference", () => {
    expect(decodeShare(encodeShare(route()))).toEqual(route());
    const bike = route({ bikeLeft: 12, stationIds: ["x", "y"], swapsOn: false, maxRide: 15, prefs: DEFAULT_PREFS });
    expect(decodeShare(encodeShare(bike))).toEqual(bike);
    const walk = route({ walkOnly: true, stationIds: [] });
    expect(decodeShare(encodeShare(walk))).toEqual(walk);
  });

  it("makes a URL-safe token and reads it back from a full address", () => {
    const url = shareUrl("https://badgergo.app/?old=1#x", route());
    expect(url.startsWith("https://badgergo.app/?r=")).toBe(true);
    expect(new URL(url).searchParams.get("r")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readShareParam(new URL(url).search)).toEqual(route());
    expect(url).not.toContain("old=1");
  });

  it("stays short enough for a message", () => {
    expect(shareUrl("https://badgergo.app/", route()).length).toBeLessThan(500);
  });

  it("rejects garbage, other versions and out-of-range values without throwing", () => {
    const bad = (j: unknown) => decodeShare(btoa(JSON.stringify(j)).replace(/=+$/, ""));
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("not base64 !!")).toBeNull();
    expect(decodeShare(btoa("{oops"))).toBeNull();
    expect(readShareParam("?other=1")).toBeNull();
    expect(readShareParam("?r=%%%")).toBeNull();
    const ascii = route({ destination: { lat: 43.0766, lon: -89.4125, label: "Union South" } });
    const ok = JSON.parse(atob(encodeShare(ascii).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encodeShare(ascii).length % 4)) % 4)));
    expect(bad({ ...ok, v: 2 })).toBeNull();
    expect(bad({ ...ok, o: [95, 0, "x"] })).toBeNull();
    expect(bad({ ...ok, d: [43, "a", "x"] })).toBeNull();
    expect(bad({ ...ok, s: ["only-one"] })).toBeNull(); // a bike route needs two docks
    expect(bad({ ...ok, s: Array.from({ length: 40 }, (_, i) => `d${i}`) })).toBeNull();
    expect(bad({ ...ok, s: [1, 2] })).toBeNull();
    expect(bad({ ...ok, p: [99, 0, 0, 0] })).toBeNull();
    expect(bad({ ...ok, p: [1, 0, 7, 0] })).toBeNull();
  });

  it("describes a plan, dropping the stand-in 'your bike' dock", () => {
    const origin = { lat: 43, lon: -89, label: "here" };
    const ctx = { origin, destination: { lat: 43.1, lon: -89, label: "there" }, swapsOn: true, maxRide: 25, prefs: DEFAULT_PREFS };
    const base = { id: "p", rides: [], walkToDock: {}, walkFromDock: {} } as unknown as Plan;
    const normal = shareFromPlan({ ...base, stations: [st("a"), st("b")] }, ctx);
    expect(normal).toMatchObject({ stationIds: ["a", "b"], bikeLeft: null, walkOnly: false });
    const onBike = shareFromPlan({ ...base, stations: [myBikeStation(origin), st("b"), st("c")], startMinutesLeft: 12 }, ctx);
    expect(onBike).toMatchObject({ stationIds: ["b", "c"], bikeLeft: 12 });
    expect(decodeShare(encodeShare(onBike))).toEqual(onBike);
    const walk = shareFromPlan({ ...base, stations: [], walkOnly: true }, ctx);
    expect(walk).toMatchObject({ walkOnly: true, stationIds: [] });
  });

  it("finds the docks in order, or reports one is gone", () => {
    const live = [st("a1"), st("b2"), st("c3"), st("z")];
    expect(chainFromIds(["c3", "a1"], live)?.map((s) => s.id)).toEqual(["c3", "a1"]);
    expect(chainFromIds(["a1", "gone"], live)).toBeNull();
  });
});
