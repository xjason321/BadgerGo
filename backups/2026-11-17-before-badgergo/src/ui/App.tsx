import { useEffect, useState } from "react";
import { MAP_CENTER, SEARCH_VIEWBOX, SYSTEM_ID } from "../config";
import { fetchStations } from "../core/gbfs";
import { geocode } from "../core/geocode";
import { planRoutes, rankPlans, trafficExposure } from "../core/planner";
import { KINDS } from "../core/bikeways";
import { overageCost } from "../core/pricing";
import { analyzePlan, strictRefiner } from "../core/roads";
import { FallbackProvider, OsrmProvider, ValhallaProvider } from "../core/routing";
import { DEFAULT_PREFS, STUDENT_PLAN, type Place, type Plan, type RoadPrefs, type Station } from "../core/types";
import { MapView } from "./MapView";
import { RoadBar } from "./RoadBar";
import { TerrainPicker } from "./TerrainPicker";

const fmt = (m: number) => `${Math.round(m)} min`;

type Target = "origin" | "destination";

export function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [text, setText] = useState({ origin: "", destination: "" });
  const [picking, setPicking] = useState<Target | null>("origin");
  const [maxRide, setMaxRide] = useState(30);
  const [swapsOn, setSwapsOn] = useState(true);
  const [prefs, setPrefs] = useState<RoadPrefs>(DEFAULT_PREFS);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string>("Loading docks…");
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState("");
  const [focus, setFocus] = useState<{ lat: number; lon: number; n: number } | null>(null);

  useEffect(() => {
    fetchStations(SYSTEM_ID)
      .then((s) => { setStations(s); setStatus(`${s.length} docks loaded. Pick a start on the map or search.`); })
      .catch((e) => setStatus(`Couldn't load docks: ${e.message}`));
  }, []);

  const set = (t: Target, p: Place) => (t === "origin" ? setOrigin(p) : setDestination(p));

  const search = async (t: Target) => {
    if (!text[t].trim()) return;
    setBusy(true);
    try {
      const [hit] = await geocode(text[t], { viewbox: SEARCH_VIEWBOX, limit: 1 });
      if (!hit) { setStatus(`No match for "${text[t]}"`); return; }
      set(t, hit);
      setText((x) => ({ ...x, [t]: hit.label.split(",").slice(0, 2).join(",") }));
      setPicking(t === "origin" ? "destination" : null);
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) { setStatus("This browser doesn't support geolocation."); return; }
    setBusy(true); setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        set("origin", { lat, lon, label: "My location" });
        setText((x) => ({ ...x, origin: "My location" }));
        setFocus({ lat, lon, n: Date.now() });
        setPicking("destination");
        setBusy(false);
        setStatus("Start set to your location. Now pick or search an end point.");
      },
      (err) => {
        setBusy(false);
        setStatus(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Allow it in your browser's site settings, or search/click the map."
            : `Couldn't get your location (${err.message}).`,
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const onMapClick = (lat: number, lon: number) => {
    if (!picking) return;
    const label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    set(picking, { lat, lon, label });
    setText((x) => ({ ...x, [picking]: label }));
    setPicking(picking === "origin" ? "destination" : null);
  };

  const go = async () => {
    if (!origin || !destination) return;
    setBusy(true); setPlans([]); setBackup(""); setStatus("Finding routes…");
    const provider = new FallbackProvider(new ValhallaProvider(prefs), new OsrmProvider());
    // Without swaps there is one ride, so the only limit that matters is the free ride time.
    const limit = swapsOn ? maxRide : STUDENT_PLAN.freeMinutes;
    try {
      const found = await planRoutes(origin, destination, stations, provider, {
        maxRideMinutes: limit,
        maxSwaps: swapsOn ? Infinity : 0,
        refineRide: prefs.strict && prefs.traffic < KINDS.length - 1 ? strictRefiner(provider, prefs.traffic) : undefined,
      });
      setStatus("Checking road types…");
      // Road types for every route (they decide the ranking and color the map). Best effort.
      const withRoads = await Promise.all(
        found.map(async (p) => {
          try { return { ...p, roads: await analyzePlan(p) }; } catch { return p; }
        }),
      );
      const ranked = rankPlans(withRoads, prefs.traffic);
      setPlans(ranked); setSelected(0); setBackup(provider.fellBack ? provider.reason || "unavailable" : "");
      const ok = ranked.filter((x) => x.withinLimit).length;
      setStatus(
        ok
          ? `${ok} of ${ranked.length} routes keep every ride within ${limit} min.`
          : `No route keeps every ride within ${limit} min${swapsOn ? "" : " (try enabling swaps)"}; showing the cheapest.`,
      );
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  };

  const plan = plans[selected] ?? null;

  return (
    <div className="app">
      <aside className="panel">
        <h1>Bike Nav</h1>
        {(["origin", "destination"] as Target[]).map((t) => (
          <div className="field" key={t}>
            <label>{t === "origin" ? "Start" : "End"}</label>
            <div className="row">
              <input
                value={text[t]}
                placeholder="Search address or place"
                onChange={(e) => setText({ ...text, [t]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && search(t)}
              />
              <button onClick={() => search(t)} disabled={busy}>Search</button>
              <button className={picking === t ? "on" : ""} onClick={() => setPicking(picking === t ? null : t)} title="Pick on map">📍</button>
            </div>
            {t === "origin" && (
              <button className="loc" onClick={useMyLocation} disabled={busy}>🎯 Use my location</button>
            )}
          </div>
        ))}
        <div className="field">
          <label>Bike swapping</label>
          <label className="check">
            <input type="checkbox" checked={swapsOn} onChange={(e) => setSwapsOn(e.target.checked)} />
            <span>Enable swaps midway through to limit undocked time</span>
          </label>
          {swapsOn ? (
            <div className="indent">
              <label className="sub">Max time riding between docks: <b>{maxRide} min</b></label>
              <input type="range" min={5} max={120} step={5} value={maxRide} onChange={(e) => setMaxRide(+e.target.value)} />
              <small>If one ride won't fit, the planner docks partway, as many times as it takes, at stops near where your limit would run out.</small>
            </div>
          ) : (
            <small>One ride only. Student plan: first 30 min free, then $8 per extra 30 min (or part).</small>
          )}
        </div>
        <div className="field">
          <label>Terrain preferences</label>
          <TerrainPicker prefs={prefs} onChange={setPrefs} />
          <small>These steer the router; they can't hard-block a road type. Each route's bar and its colors on the map show what it actually uses.</small>
        </div>
        <button className="primary" onClick={go} disabled={!origin || !destination || !stations.length || busy}>
          {busy ? "Working…" : "Find routes"}
        </button>
        <p className="status">{status}</p>
        {backup && <p className="status warn">Preference router unavailable ({backup}). Used a backup that ignores road preferences; try again in a few minutes.</p>}
        <ul className="plans">
          {plans.map((p, i) => {
            const swaps = p.stations.length - 2;
            const directCost = p.directRideMinutes == null ? 0 : overageCost(p.directRideMinutes, STUDENT_PLAN);
            const saves = swaps > 0 ? directCost - p.overageCost : 0;
            return (
              <li key={p.id} className={i === selected ? "sel" : ""} onClick={() => setSelected(i)}>
                <div className="top">
                  <b>{p.label}</b>
                  <span className={p.withinLimit ? "ok" : "warn"}>
                    {p.withinLimit ? "within limit" : "over limit"}{p.overageCost ? ` · +$${p.overageCost}` : " · $0 extra"}
                  </span>
                </div>
                <div>
                  Total {fmt(p.totalMinutes)} · riding {fmt(p.rideMinutes)}
                  {swaps > 0 && <> (longest {fmt(p.longestRideMinutes)})</>} · {(p.rides.reduce((a, r) => a + r.distanceM, 0) / 1609.34).toFixed(1)} mi
                </div>
                {swaps > 0 && (
                  <div className="detour">
                    Detour: +{Math.round(p.detourMinutes)} min vs riding straight through
                    {saves > 0 ? ` · saves $${saves}` : ""}
                  </div>
                )}
                <div className="legs">
                  🚶 {fmt(p.walkToDock.durationMin)} → <b>{p.stations[0].name}</b> ({p.stations[0].bikesAvailable} bikes)
                  {p.rides.map((r, j) => {
                    const to = p.stations[j + 1];
                    const last = j === p.rides.length - 1;
                    return (
                      <span key={j}>
                        <br />🚲 {fmt(r.durationMin)} → <b>{to.name}</b>{" "}
                        {last ? `(${to.docksAvailable} open docks)` : `(swap: dock, then take a bike · ${to.docksAvailable} open docks)`}
                      </span>
                    );
                  })}
                  <br />🚶 {fmt(p.walkFromDock.durationMin)} to destination
                </div>
                {p.roads && <RoadBar b={p.roads.breakdown} />}
                {(() => {
                  const e = trafficExposure(p, prefs.traffic);
                  if (!e) return null;
                  return e.m < 50
                    ? <div className="ok traffic-note">✓ Stays within your traffic limit</div>
                    : <div className="warn traffic-note">⚠ {(e.m / 1609.34).toFixed(1)} mi ({Math.round(e.share * 100)}%) closer to traffic than your limit</div>;
                })()}
              </li>
            );
          })}
        </ul>
      </aside>
      <MapView center={MAP_CENTER} stations={stations} origin={origin} destination={destination} plan={plan} focus={focus} onMapClick={onMapClick} />
    </div>
  );
}
