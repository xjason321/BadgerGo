import { useState } from "react";
import { nearestBikes, nearestOpenDocks, type DockChoice } from "../core/dockNow";
import { googleDirectUrl } from "../core/navLinks";
import { formatDistance } from "../core/ride";
import type { LatLng, Station } from "../core/types";
import { BikeIcon, DockIcon } from "./icons";
import { countUse } from "./usage";

type Kind = "bike" | "dock";

interface Props {
  stations: Station[];
  /** Show a station on the map. */
  onFocusStation: (s: Station) => void;
  /** Get the rider's position (injectable for tests). */
  locate?: () => Promise<LatLng>;
}

const here = (): Promise<LatLng> =>
  new Promise((ok, no) => {
    if (!("geolocation" in navigator)) return no(new Error("This browser doesn't support location."));
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }), (e) => no(new Error(e.code === e.PERMISSION_DENIED ? "Location is off. Allow it in your browser's site settings." : "Couldn't get your location.")), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });

/** Two one-tap buttons for when you don't have a destination yet: find a bike, or a dock to return one. */
export function NearestDocks({ stations, onFocusStation, locate = here }: Props) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [rows, setRows] = useState<DockChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const find = async (k: Kind) => {
    if (busy) return;
    if (kind === k) { setKind(null); setRows(null); setErr(""); return; } // tapping the open one closes it
    setKind(k); setErr(""); setRows(null); setBusy(true);
    countUse(k === "bike" ? "nearest_bike" : "nearest_dock");
    try {
      const pos = await locate();
      const found = k === "bike" ? nearestBikes(pos, stations) : nearestOpenDocks(pos, stations);
      setRows(found);
      if (found[0]) onFocusStation(found[0].station);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="near form-only">
      <div className="near-btns">
        <button className={`near-btn${kind === "bike" ? " on" : ""}`} onClick={() => find("bike")} aria-expanded={kind === "bike"} disabled={busy || !stations.length}><BikeIcon /> Nearest bike</button>
        <button className={`near-btn${kind === "dock" ? " on" : ""}`} onClick={() => find("dock")} aria-expanded={kind === "dock"} disabled={busy || !stations.length}><DockIcon /> Nearest open dock</button>
      </div>
      {busy && <p className="near-note">Finding your location…</p>}
      {err && <p className="near-note">{err}</p>}
      {rows && !rows.length && <p className="near-note">{kind === "bike" ? "No bikes available right now." : "No open docks found."}</p>}
      {rows && rows.length > 0 && (
        <ul className="near-list">
          {rows.map((d) => {
            const n = kind === "bike" ? d.station.bikesAvailable : d.station.docksAvailable;
            return (
              <li key={d.station.id}>
                <button className="near-info" onClick={() => onFocusStation(d.station)}>
                  <b>{d.station.name}</b>
                  <span>{formatDistance(d.meters)} · {n} {kind === "bike" ? "bike" : "open dock"}{n === 1 ? "" : "s"}</span>
                </button>
                <a className="near-go" href={googleDirectUrl(d.station, "walking")} target="_blank" rel="noreferrer">Walk</a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
