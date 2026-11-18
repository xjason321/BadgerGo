import L from "leaflet";
import { useEffect, useRef } from "react";
import { KINDS } from "../core/bikeways";
import type { Place, Plan, Station } from "../core/types";

interface Props {
  center: [number, number];
  stations: Station[];
  origin: Place | null;
  destination: Place | null;
  plan: Plan | null;
  /** Pan/zoom here whenever `n` changes (e.g. after "Use my location"). */
  focus?: { lat: number; lon: number; n: number } | null;
  onMapClick: (lat: number, lon: number) => void;
}

const dot = (color: string, size = 12) =>
  L.divIcon({
    className: "",
    iconSize: [size, size],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px #0006"></div>`,
  });

export function MapView({ center, stations, origin, destination, plan, focus, onMapClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const stationLayer = useRef(L.layerGroup());
  const pointLayer = useRef(L.layerGroup());
  const routeLayer = useRef(L.layerGroup());
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    const m = L.map(el.current!).setView(center, 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(m);
    stationLayer.current.addTo(m);
    routeLayer.current.addTo(m);
    pointLayer.current.addTo(m);
    m.on("click", (e) => clickRef.current(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = stationLayer.current;
    g.clearLayers();
    for (const s of stations) {
      const color = s.isRenting && s.bikesAvailable > 0 ? "#2e9e5b" : "#999";
      L.marker([s.lat, s.lon], { icon: dot(color, 10) })
        .bindTooltip(`${s.name}<br>${s.bikesAvailable} bikes · ${s.docksAvailable} docks`)
        .addTo(g);
    }
  }, [stations]);

  useEffect(() => {
    const g = pointLayer.current;
    g.clearLayers();
    if (origin) L.marker([origin.lat, origin.lon], { icon: dot("#1a73e8", 16) }).bindTooltip("Start").addTo(g);
    if (destination) L.marker([destination.lat, destination.lon], { icon: dot("#d93025", 16) }).bindTooltip("End").addTo(g);
  }, [origin, destination]);

  useEffect(() => {
    const g = routeLayer.current;
    g.clearLayers();
    if (!plan) return;
    const walk = { color: "#555", weight: 4, dashArray: "2 8", opacity: 0.9 };
    const over = !plan.withinLimit;
    const lines: L.Polyline[] = [L.polyline(plan.walkToDock.geometry, walk).addTo(g)];
    plan.rides.forEach((ride, i) => {
      for (const w of [ride.walkBefore, ride.walkAfter]) if (w) lines.push(L.polyline(w.geometry, walk).addTo(g));
      // Over the ride limit: an orange halo under the whole ride, whatever it runs on.
      if (over) lines.push(L.polyline(ride.geometry, { color: "#e8710a", weight: 12, opacity: 0.4 }).addTo(g));
      const segs = plan.roads?.rides[i]?.segments;
      if (segs?.length) {
        for (const s of segs) {
          lines.push(
            L.polyline(s.geometry, {
              color: KINDS[s.kind].color,
              weight: 6,
              opacity: 0.95,
              dashArray: s.unpaved ? "7 6" : undefined,
            })
              .bindTooltip(KINDS[s.kind].label + (s.unpaved ? " (unpaved)" : ""), { sticky: true })
              .addTo(g),
          );
        }
      } else {
        lines.push(L.polyline(ride.geometry, { color: over ? "#e8710a" : "#1a73e8", weight: 6, opacity: 0.9 }).addTo(g));
      }
    });
    lines.push(L.polyline(plan.walkFromDock.geometry, walk).addTo(g));
    plan.stations.forEach((s, i) => {
      const swap = i > 0 && i < plan.stations.length - 1;
      L.circleMarker([s.lat, s.lon], {
        radius: swap ? 9 : 8,
        color: swap ? "#e8710a" : "#000",
        weight: swap ? 4 : 3,
        fillColor: "#fff",
        fillOpacity: 1,
      })
        .bindTooltip(swap ? `Swap here: ${s.name}` : s.name, { permanent: true, direction: "top" })
        .addTo(g);
    });
    map.current?.fitBounds(L.featureGroup(lines).getBounds().pad(0.15));
  }, [plan]);

  useEffect(() => {
    if (focus) map.current?.setView([focus.lat, focus.lon], 15);
  }, [focus]);

  return <div ref={el} className="map" />;
}
