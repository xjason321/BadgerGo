import { describe, expect, it } from "vitest";
import { cueFor, minutesText, readCues, writeCues } from "./cues";
import type { NavLeg } from "./navLinks";

const leg = (o: Partial<NavLeg>): NavLeg => ({ kind: "walk", to: { lat: 0, lon: 0 }, toName: "X", atStop: true, minutes: 3, meters: 100, geometry: [], via: [], ...o });

describe("minutesText", () => {
  it("pluralises and rounds", () => {
    expect(minutesText(0.2)).toBe("1 minute");
    expect(minutesText(1)).toBe("1 minute");
    expect(minutesText(4.6)).toBe("5 minutes");
    expect(minutesText(60)).toBe("1 hour");
    expect(minutesText(125)).toBe("2 hours 5 minutes");
    expect(minutesText(61)).toBe("1 hour 1 minute");
  });
});

describe("cueFor", () => {
  const legs = [
    leg({ kind: "walk", toName: "Memorial Union", minutes: 2 }),
    leg({ kind: "ride", toName: "Library Mall", minutes: 6, swap: true }),
    leg({ kind: "ride", toName: "Union South", minutes: 5 }),
    leg({ kind: "ride", toName: "a guide point", atStop: false, minutes: 4 }),
    leg({ kind: "walk", toName: "Class", minutes: 1, final: true }),
  ];
  it("announces a walk", () => expect(cueFor(legs, 0)).toEqual({ text: "Walk 2 minutes to Memorial Union.", pattern: [120] }));
  it("announces a swap ride with the dock-and-rent reminder", () => expect(cueFor(legs, 1)!.text).toBe("Ride 6 minutes to Library Mall. Dock your bike there, then rent another."));
  it("announces the last ride with the dock reminder", () => expect(cueFor(legs, 2)!.text).toBe("Ride 5 minutes to Union South. Dock your bike at the end."));
  it("says 'toward' for a ride part that ends mid-route", () => expect(cueFor(legs, 3)!.text).toBe("Ride 4 minutes toward a guide point."));
  it("announces arrival past the last leg", () => expect(cueFor(legs, legs.length)!.text).toBe("You've arrived. Enjoy!"));
  it("buzzes differently for walking, riding and arriving", () => {
    const p = [0, 1, legs.length].map((i) => cueFor(legs, i)!.pattern.join());
    expect(new Set(p).size).toBe(3);
  });
  it("says nothing when there are no legs", () => expect(cueFor([], 0)).toBeNull());
});

describe("cue setting", () => {
  it("is on by default and remembers off", () => {
    const m: Record<string, string> = {};
    const s = { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } };
    expect(readCues(s)).toBe(true);
    writeCues(false, s); expect(readCues(s)).toBe(false);
    writeCues(true, s); expect(readCues(s)).toBe(true);
  });
});
