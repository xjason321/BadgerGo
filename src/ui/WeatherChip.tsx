import { useEffect, useState } from "react";
import { fetchWeather, notes, summary, type Weather } from "../core/weather";
import { AlertIcon } from "./icons";

const cache = new Map<string, { w: Weather; at: number }>();
const TTL_MS = 10 * 60_000;

/** Conditions for the ride: temperature, sky, sunset, plus warnings (rain during the trip, dark by arrival, wind, cold). */
export function WeatherChip({ lat, lon, tripMinutes }: { lat: number; lon: number; tripMinutes: number }) {
  const [w, setW] = useState<Weather | null>(null);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  useEffect(() => {
    let live = true;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) { setW(hit.w); return; }
    fetchWeather(lat, lon)
      .then((x) => { if (x) { cache.set(key, { w: x, at: Date.now() }); if (live) setW(x); } })
      .catch(() => { /* weather is a bonus: stay quiet when offline */ });
    return () => { live = false; };
  }, [key, lat, lon]);
  if (!w) return null;
  const now = Math.floor(Date.now() / 1000);
  const warn = notes(w, now, tripMinutes);
  return (
    <div className="wx" aria-label="Weather for your ride">
      <span className="wx-chip">{summary(w, now)}</span>
      {warn.map((n) => <span key={n.kind} className="wx-chip warn"><AlertIcon size={13} /> {n.text}</span>)}
    </div>
  );
}
