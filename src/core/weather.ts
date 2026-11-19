/** Madison's time zone, for showing sunset etc. whatever zone the phone is set to. */
const TZ = "America/Chicago";

export interface Weather {
  tempF: number;
  windMph: number;
  code: number;
  /** Rain now, in mm over the last interval. */
  precipNow: number;
  /** Hourly rain, mm. `t` is the start of the hour, in unix seconds. */
  hours: { t: number; mm: number }[];
  sunrise: number[];
  sunset: number[];
  /** When this was read, unix seconds. */
  at: number;
}

export type Note = { kind: "rain" | "dark" | "wind" | "cold" | "heat"; text: string };

const RAIN_MM = 0.2;
const hhmm = (sec: number) => new Date(sec * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

export function label(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Thunderstorms";
  return "Cloudy";
}

/** Turn Open-Meteo's forecast response into the bits we use. Returns null if it isn't shaped as expected. */
export function parseWeather(j: any): Weather | null {
  try {
    const c = j.current;
    if (!Number.isFinite(c.temperature_2m)) return null;
    const hours = (j.hourly.time as number[]).map((t, i) => ({ t, mm: Number(j.hourly.precipitation[i]) || 0 }));
    return { tempF: c.temperature_2m, windMph: c.wind_speed_10m ?? 0, code: c.weather_code ?? 0, precipNow: c.precipitation ?? 0, hours, sunrise: j.daily.sunrise, sunset: j.daily.sunset, at: c.time };
  } catch { return null; }
}

export async function fetchWeather(lat: number, lon: number, f: typeof fetch = (i, o) => fetch(i, o)): Promise<Weather | null> {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&hourly=precipitation&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2&timeformat=unixtime`;
  const r = await f(u);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  return parseWeather(await r.json());
}

/** Is the sun down at this time? Unknown times (past the forecast) count as light. */
export function isDark(w: Weather, sec: number): boolean {
  const first = w.sunrise[0], last = w.sunset[w.sunset.length - 1];
  if (sec < first - 86400 || sec > last + 3600 * 12) return false;
  return !w.sunrise.some((r, i) => sec >= r && sec < w.sunset[i]);
}

/** The next sunset after `sec`, or null. */
export const nextSunset = (w: Weather, sec: number): number | null => w.sunset.find((s) => s > sec) ?? null;

/** One-line summary: "52°F · Clear · Sunset 5:12 PM". */
export function summary(w: Weather, nowSec: number): string {
  const parts = [`${Math.round(w.tempF)}°F`, label(w.code)];
  const ss = nextSunset(w, nowSec);
  if (isDark(w, nowSec)) parts.push("After dark");
  else if (ss) parts.push(`Sunset ${hhmm(ss)}`);
  return parts.join(" · ");
}

/**
 * Things worth knowing before a ride of `tripMin` minutes starting now: rain during it, getting
 * there after dark, strong wind, cold or heat. Empty when conditions are fine.
 */
export function notes(w: Weather, nowSec: number, tripMin: number): Note[] {
  const out: Note[] = [];
  const end = nowSec + Math.max(tripMin, 1) * 60;
  if (w.precipNow >= RAIN_MM) out.push({ kind: "rain", text: "Raining now" });
  else {
    const wet = w.hours.find((h) => h.mm >= RAIN_MM && h.t + 3600 > nowSec && h.t < end);
    if (wet) {
      const mins = Math.max(0, Math.round((wet.t - nowSec) / 60));
      out.push({ kind: "rain", text: mins < 5 ? "Rain starting now" : `Rain expected in ~${mins} min` });
    }
  }
  if (isDark(w, end)) out.push({ kind: "dark", text: isDark(w, nowSec) ? "It's dark: use lights" : "You'll arrive after dark: bring lights" });
  if (w.windMph >= 18) out.push({ kind: "wind", text: `Windy: ${Math.round(w.windMph)} mph` });
  if (w.tempF <= 32) out.push({ kind: "cold", text: `Freezing: ${Math.round(w.tempF)}°F, watch for ice` });
  else if (w.tempF >= 92) out.push({ kind: "heat", text: `Hot: ${Math.round(w.tempF)}°F, bring water` });
  return out;
}
