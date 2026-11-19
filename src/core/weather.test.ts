import { describe, expect, it } from "vitest";
import { fetchWeather, isDark, label, notes, parseWeather, summary, type Weather } from "./weather";

const T0 = 1_795_100_400; // a Nov afternoon in Madison
const base: Weather = {
  tempF: 52, windMph: 8, code: 0, precipNow: 0, at: T0,
  hours: [0, 1, 2, 3, 4].map((i) => ({ t: T0 - 1800 + i * 3600, mm: 0 })),
  sunrise: [T0 - 7 * 3600, T0 + 17 * 3600], sunset: [T0 + 1800, T0 + 24.5 * 3600],
};

describe("notes", () => {
  it("is empty on a nice day", () => expect(notes({ ...base, sunset: [T0 + 5 * 3600, T0 + 29 * 3600] }, T0, 20)).toEqual([]));
  it("says it's raining now", () => expect(notes({ ...base, precipNow: 0.6 }, T0, 20)[0]).toEqual({ kind: "rain", text: "Raining now" }));
  it("warns about rain that starts during the trip, with minutes until it starts", () => {
    const w = { ...base, sunset: [T0 + 9e4, T0 + 2e5], hours: base.hours.map((h, i) => (i === 1 ? { ...h, mm: 1 } : h)) };
    expect(notes(w, T0, 60)[0]).toEqual({ kind: "rain", text: "Rain expected in ~30 min" });
  });
  it("ignores rain that comes after the trip is over", () => {
    const w = { ...base, sunset: [T0 + 9e4, T0 + 2e5], hours: base.hours.map((h, i) => (i === 3 ? { ...h, mm: 2 } : h)) };
    expect(notes(w, T0, 20)).toEqual([]);
  });
  it("warns when arrival is after sunset, and when it is dark already", () => {
    expect(notes(base, T0, 40).some((n) => n.kind === "dark" && /arrive after dark/.test(n.text))).toBe(true);
    expect(notes(base, T0, 10).some((n) => n.kind === "dark")).toBe(false);
    expect(notes(base, T0 + 3600, 10).find((n) => n.kind === "dark")?.text).toMatch(/dark: use lights/);
  });
  it("flags wind, freezing and heat", () => {
    const day = { ...base, sunset: [T0 + 9e4, T0 + 2e5] };
    expect(notes({ ...day, windMph: 22 }, T0, 10)[0].kind).toBe("wind");
    expect(notes({ ...day, tempF: 28 }, T0, 10)[0].kind).toBe("cold");
    expect(notes({ ...day, tempF: 95 }, T0, 10)[0].kind).toBe("heat");
  });
});

describe("isDark / summary / label", () => {
  it("is dark before sunrise and after sunset only", () => {
    expect(isDark(base, T0)).toBe(false);
    expect(isDark(base, T0 + 3600)).toBe(true);
    expect(isDark(base, T0 + 18 * 3600)).toBe(false);
  });
  it("summarises temperature, sky and sunset", () => expect(summary(base, T0)).toMatch(/^52°F · Clear · Sunset \d{1,2}:\d{2} [AP]M$/));
  it("says After dark once the sun is down", () => expect(summary(base, T0 + 3600)).toBe("52°F · Clear · After dark"));
  it("names the sky", () => { expect(label(63)).toBe("Rain"); expect(label(73)).toBe("Snow"); expect(label(2)).toBe("Cloudy"); expect(label(96)).toBe("Thunderstorms"); });
});

describe("parse / fetch", () => {
  const json = { current: { temperature_2m: 52.5, wind_speed_10m: 10, weather_code: 3, precipitation: 0, time: T0 }, hourly: { time: [T0, T0 + 3600], precipitation: [0, 1.2] }, daily: { sunrise: [1], sunset: [2] } };
  it("parses the forecast", () => {
    const w = parseWeather(json)!;
    expect(w.tempF).toBe(52.5);
    expect(w.hours[1]).toEqual({ t: T0 + 3600, mm: 1.2 });
  });
  it("returns null for junk", () => { expect(parseWeather({})).toBeNull(); expect(parseWeather(null)).toBeNull(); });
  it("fetches with the right query and rejects on HTTP errors", async () => {
    let url = "";
    const w = await fetchWeather(43.0731, -89.4012, (async (u: string) => { url = u; return { ok: true, json: async () => json }; }) as unknown as typeof fetch);
    expect(w?.code).toBe(3);
    expect(url).toContain("latitude=43.073&longitude=-89.401");
    await expect(fetchWeather(1, 2, (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch)).rejects.toThrow("weather 500");
  });
});
