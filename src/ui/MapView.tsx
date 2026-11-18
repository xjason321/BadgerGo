import L from "leaflet";
import "leaflet-rotate"; // lets the map turn (ride mode faces the way you do)
import { useEffect, useMemo, useRef, useState } from "react";
import { KINDS } from "../core/bikeways";
import { googleMapsUrl } from "../core/bcycle";
import type { Boundary } from "../core/boundary";
import { maskRings } from "../core/boundary";
import { dockRing, dockNote, type DockRole, type StopKind } from "../core/dockStatus";
import type { Place, Plan, Station } from "../core/types";
import { dockIcon, dockSize } from "./dockMarker";
import { unpavedRuns, type UnpavedRun } from "../core/unpaved";

interface Props {
  center: [number, number];
  stations: Station[];
  origin: Place | null;
  destination: Place | null;
  plan: Plan | null;
  boundary: Boundary | null;
  /** A dropped pin (long press) waiting for the user's choice. */
  pin: { lat: number; lon: number } | null;
  /** Pan/zoom here whenever `n` changes (e.g. after "Use my location"). */
  focus?: { lat: number; lon: number; n: number } | null;
  /** Extra space at the bottom the panel covers (px), so popups aren't hidden behind it. */
  coveredBottom: number;
  onMapClick: (lat: number, lon: number) => void;
  onLongPress: (lat: number, lon: number) => void;
  /** Desktop only: the start or end marker was dragged to a new spot. */
  /** Ride mode: where the rider is, and whether the map should keep them in view. */
  me?: { lat: number; lon: number; accuracy?: number } | null;
  follow?: boolean;
  /** Show the compass (ride mode). Tapping it faces north and stops following. */
  compass?: boolean;
  /** When the BCycle data was last downloaded (ms), and a way to download it again (allowed once a minute). */
  loadedAt?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Compass direction the rider faces (degrees). The map turns to match while following. */
  heading?: number | null;
  onUserPan?: () => void;
  onMovePoint: (which: "origin" | "destination", lat: number, lon: number) => void;
}

const dot = (color: string, size = 14) =>
  L.divIcon({
    className: "",
    iconSize: [size, size],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px #0007"></div>`,
  });

/** A yellow teardrop whose tip touches the route and whose body sticks out sideways, with a caution icon. */
function unpavedMarker(map: L.Map, run: UnpavedRun): L.Marker {
  const a = map.latLngToLayerPoint(run.from);
  const b = map.latLngToLayerPoint(run.to);
  let nx = b.y - a.y, ny = a.x - b.x; // perpendicular to the line
  if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } // prefer the side that points up the screen
  const deg = (Math.atan2(nx, -ny) * 180) / Math.PI; // clockwise from "up"
  const mi = run.meters / 1609.34;
  const label = mi < 0.05 ? "<0.1" : mi.toFixed(1);
  const icon = L.divIcon({
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html:
      `<div class="unpaved-pin" style="transform:rotate(${deg.toFixed(1)}deg)"><div class="drop"></div>` +
      `<svg class="warn" style="transform:rotate(${(-deg).toFixed(1)}deg)" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#713f12" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.4v.1"/></svg></div>`,
  });
  return L.marker(run.mid, { icon, zIndexOffset: 500, keyboard: false }).bindPopup(`<div class="dock-pop"><strong>Unpaved (${label} mi)</strong></div>`, {
    className: "dock-popup",
    autoPanPaddingBottomRight: [16, 16],
  });
}

/** What a dock popup needs to offer "refresh the BCycle data" (allowed once a minute). */
interface Refresher { loadedAt: () => number; busy: () => boolean; refresh: () => void }
const COOLDOWN_MS = 60_000;
const popupTimers = new WeakMap<HTMLElement, number>();
const RELOAD_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6M20 4v7h-7"/></svg>';

function popupContent(s: Station, kind?: StopKind, r?: Refresher): HTMLElement {
  const root = document.createElement("div");
  root.className = "dock-pop";
  const title = document.createElement("strong");
  title.textContent = s.name;
  const counts = document.createElement("div");
  counts.className = "counts";
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const label = document.createElement("span");
  label.textContent = `${n(s.bikesAvailable, "bike")} · ${n(s.docksAvailable, "open dock")}`;
  counts.append(label);
  if (r) {
    const btn = document.createElement("button");
    btn.className = "reload-btn";
    btn.type = "button";
    btn.innerHTML = RELOAD_SVG;
    btn.onclick = (e) => { e.stopPropagation(); if (!btn.disabled) r.refresh(); };
    const update = () => {
      const wait = COOLDOWN_MS - (Date.now() - r.loadedAt());
      btn.disabled = r.busy() || wait > 0;
      btn.classList.toggle("spin", r.busy());
      btn.title = r.busy() ? "Refreshing…" : wait > 0 ? `Updated just now. Refresh available in ${Math.ceil(wait / 1000)} s` : "Refresh BCycle data";
      btn.setAttribute("aria-label", btn.title);
    };
    update();
    popupTimers.set(root, window.setInterval(update, 1000));
    counts.append(btn);
  }
  const link = document.createElement("a");
  link.className = "open-bcycle";
  link.href = googleMapsUrl(s);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Open in Google Maps";
  root.append(title, counts);
  if (kind) {
    const note = dockNote(s, kind);
    const el = document.createElement("div");
    el.className = `note ${note.level}`;
    el.textContent = note.text;
    root.append(el);
  }
  root.append(link);
  return root;
}

/** Pan so the rider sits in the middle of the part of the map the sheet leaves visible (right whichever way the map is turned). */
function centerOnMe(m: L.Map, cover: number, me: { lat: number; lon: number }, animate: boolean) {
  const size = m.getSize();
  const want = L.point(size.x / 2, (size.y - cover) / 2);
  const have = m.latLngToContainerPoint([me.lat, me.lon]);
  m.panBy(have.subtract(want), { animate, duration: 0.4 });
}

export function MapView({ center, stations, origin, destination, plan, boundary, pin, focus, coveredBottom, onMapClick, onLongPress, onMovePoint, me, follow, heading, compass, onUserPan, loadedAt = 0, refreshing = false, onRefresh }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const stationLayer = useRef(L.layerGroup());
  const pointLayer = useRef(L.layerGroup());
  const routeLayer = useRef(L.layerGroup());
  const boundaryLayer = useRef(L.layerGroup());
  const pinLayer = useRef(L.layerGroup());
  const clickRef = useRef(onMapClick);
  const pressRef = useRef(onLongPress);
  const moveRef = useRef(onMovePoint);
  const panRef = useRef(onUserPan);
  const meLayer = useRef(L.layerGroup());
  const coverRef = useRef(coveredBottom);
  const meRef = useRef(me);
  const needle = useRef<HTMLDivElement>(null);
  clickRef.current = onMapClick;
  pressRef.current = onLongPress;
  moveRef.current = onMovePoint;
  panRef.current = onUserPan;
  coverRef.current = coveredBottom;
  meRef.current = me;
  const [zoom, setZoom] = useState(13);

  useEffect(() => {
    // tapHold turns a long touch into a "contextmenu" event on iOS; Android and desktop send it natively.
    const m = L.map(el.current!, { zoomControl: false, tapHold: true, rotate: true, bearing: 0, touchRotate: false, shiftKeyRotate: false, pitchDrag: false, rotateControl: false } as L.MapOptions).setView(center, 13);
    L.control.zoom({ position: "topright" }).addTo(m);
    // The bottom sheet covers part of the map on phones, so the +/- buttons zoom around the middle of the
    // part you can actually see, not around the middle of the whole map.
    const stepZoom = (d: number) => {
      const cover = coverRef.current;
      if (!cover) return m.setZoom(m.getZoom() + d);
      const size = m.getSize();
      return m.setZoomAround(L.point(size.x / 2, (size.y - cover) / 2), m.getZoom() + d);
    };
    m.zoomIn = (d?: number) => stepZoom(d ?? m.options.zoomDelta ?? 1);
    m.zoomOut = (d?: number) => stepZoom(-(d ?? m.options.zoomDelta ?? 1));
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(m);
    m.createPane("mask").style.zIndex = "250";
    m.getPane("mask")!.style.pointerEvents = "none";
    boundaryLayer.current.addTo(m);
    // The compass needle always points at true north: it turns by the map's bearing (set directly, no React re-render per frame).
    m.on("rotate", () => { if (needle.current) needle.current.style.transform = `rotate(${m.getBearing()}deg)`; });
    m.on("dragstart", () => panRef.current?.()); // the rider moved the map themselves: stop following
    stationLayer.current.addTo(m);
    routeLayer.current.addTo(m);
    pointLayer.current.addTo(m);
    pinLayer.current.addTo(m);
    m.on("click", (e) => clickRef.current(e.latlng.lat, e.latlng.lng));
    m.on("contextmenu", (e: L.LeafletMouseEvent) => pressRef.current(e.latlng.lat, e.latlng.lng));
    m.on("zoomend", () => setZoom(m.getZoom()));
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // City limits: dim everything outside, outline the edge.
  useEffect(() => {
    const g = boundaryLayer.current;
    g.clearLayers();
    if (!boundary) return;
    L.polygon(maskRings(boundary), {
      pane: "mask", stroke: false, fillColor: "#000", fillOpacity: 0.4, fillRule: "evenodd", interactive: false,
    }).addTo(g);
    for (const ring of [...boundary.outer, ...boundary.holes]) {
      L.polyline([...ring, ring[0]], { pane: "mask", color: "#fff", weight: 5, opacity: 0.55, interactive: false }).addTo(g);
      L.polyline([...ring, ring[0]], { pane: "mask", color: "#0f5132", weight: 2.5, opacity: 0.95, interactive: false }).addTo(g);
    }
  }, [boundary]);

  // Colored roles appear only for the chosen route: its first dock is the pick-up, the rest are returns.
  const kinds = useMemo(() => {
    const k = new Map<string, StopKind>();
    const n = plan?.stations.length ?? 0;
    plan?.stations.forEach((s, i) => k.set(s.id, i === 0 ? "start" : i === n - 1 ? "end" : "swap"));
    return k;
  }, [plan]);

  const roles = useMemo(() => {
    const r = new Map<string, DockRole>();
    plan?.stations.forEach((s, i) => r.set(s.id, i === 0 ? "pickup" : "dropoff"));
    return r;
  }, [plan]);

  // Latest refresh state for the popups (they're built when opened, so they read it through refs).
  const refreshRef = useRef<Refresher>({ loadedAt: () => 0, busy: () => false, refresh: () => {} });
  refreshRef.current = { loadedAt: () => loadedAt, busy: () => refreshing, refresh: () => onRefresh?.() };
  const openDock = useRef<string | null>(null);
  const rebuilding = useRef(false);

  useEffect(() => {
    const g = stationLayer.current;
    // Rebuilding the markers (new data, zoom...) would close an open popup; remember it and open it again.
    const reopen = openDock.current;
    rebuilding.current = true;
    g.clearLayers();
    const base = dockSize(zoom);
    let again: L.Marker | null = null;
    for (const s of stations) {
      const role = roles.get(s.id) ?? "other";
      const size = role === "other" ? base : base + 6;
      const m = L.marker([s.lat, s.lon], {
        icon: dockIcon(dockRing(s, role), size),
        zIndexOffset: role === "other" ? 0 : 1000,
        opacity: plan && role === "other" ? 0.6 : 1,
        keyboard: false,
      })
        .bindPopup(() => popupContent(s, kinds.get(s.id), refreshRef.current), {
          className: "dock-popup",
          autoPanPaddingTopLeft: [16, 16],
          autoPanPaddingBottomRight: [16, coverRef.current + 16],
        })
        .on("popupopen", () => { openDock.current = s.id; })
        .on("popupclose", (e) => {
          const el = (e as L.PopupEvent).popup.getContent();
          if (el instanceof HTMLElement) clearInterval(popupTimers.get(el));
          if (!rebuilding.current) openDock.current = null;
        })
        .addTo(g);
      if (s.id === reopen) again = m;
    }
    rebuilding.current = false;
    again?.openPopup();
  }, [stations, roles, kinds, zoom, plan]);

  useEffect(() => {
    const g = pointLayer.current;
    g.clearLayers();
    // Only with a mouse (hover + fine pointer): dragging a marker moves the start or end. Never on touch screens.
    const desktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const mk = (which: "origin" | "destination", p: Place, color: string, tip: string) => {
      const m = L.marker([p.lat, p.lon], { icon: dot(color, 18), zIndexOffset: 2000, draggable: desktop, autoPan: desktop })
        .bindTooltip(desktop ? `${tip} (drag to move)` : tip)
        .addTo(g);
      if (desktop) m.on("dragend", () => { const ll = m.getLatLng(); moveRef.current(which, ll.lat, ll.lng); });
    };
    if (origin) mk("origin", origin, "#16a34a", "Start");
    if (destination) mk("destination", destination, "#dc2626", "End");
  }, [origin, destination]);

  // Ride mode: the rider's blue dot, and keep it in the visible part of the map while following.
  useEffect(() => {
    const m = map.current;
    const g = meLayer.current;
    g.clearLayers();
    if (!m || !me) return;
    if (!m.hasLayer(g)) g.addTo(m);
    if (me.accuracy && me.accuracy < 200) L.circle([me.lat, me.lon], { radius: me.accuracy, stroke: false, fillColor: "#2563eb", fillOpacity: 0.12, interactive: false }).addTo(g);
    L.marker([me.lat, me.lon], {
      interactive: false, keyboard: false, zIndexOffset: 3000,
      icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="me-dot"></div>' }),
    }).addTo(g);
    if (follow) {
      // Put the rider in the middle of the part of the map the sheet leaves visible (works whichever way the map is turned).
      const z = Math.max(m.getZoom(), 17);
      if (z !== m.getZoom()) m.setZoom(z, { animate: false });
      centerOnMe(m, coverRef.current, me, true);
    }
  }, [me, follow]);

  // Turn the map so "up" is the direction the rider faces. A per-frame ease (about 120 ms time constant) glides toward each
  // new heading by the shortest way round, so sensor jitter and big swings both look smooth. North-up again when ride mode ends.
  const turn = useRef<{ target: number | null; cur: number; raf: number; last: number }>({ target: null, cur: 0, raf: 0, last: 0 });
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const t = turn.current;
    if (!(follow && heading != null)) {
      t.target = null;
      if (m.getBearing() !== 0 && !me) m.resetNorth({ animate: true });
      return;
    }
    t.target = (360 - heading) % 360; // the plugin turns the map clockwise by this much, so facing east needs -90
    if (t.raf) return;
    t.cur = m.getBearing();
    t.last = performance.now();
    const step = (now: number) => {
      const mm = map.current;
      if (!mm || t.target == null) { t.raf = 0; return; }
      const diff = ((t.target - t.cur + 540) % 360) - 180;
      if (Math.abs(diff) < 0.05) { t.cur = t.target; t.raf = 0; } else {
        t.cur = (t.cur + diff * (1 - Math.exp(-Math.max(0, now - t.last) / 120)) + 360) % 360;
        t.raf = requestAnimationFrame(step);
      }
      t.last = now;
      mm.setBearing(t.cur, { animate: false });
      if (meRef.current) centerOnMe(mm, coverRef.current, meRef.current, false); // turning pivots on the map centre, so keep the rider in place
    };
    t.raf = requestAnimationFrame(step);
  }, [heading, follow, me]);
  useEffect(() => () => cancelAnimationFrame(turn.current.raf), []);

  useEffect(() => {
    const g = pinLayer.current;
    g.clearLayers();
    if (pin) {
      L.marker([pin.lat, pin.lon], {
        interactive: false,
        icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="drop-pin"></div>' }),
      }).addTo(g);
    }
  }, [pin]);

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
        if (map.current) for (const run of unpavedRuns(segs)) unpavedMarker(map.current, run).addTo(g);
      } else {
        lines.push(L.polyline(ride.geometry, { color: over ? "#e8710a" : "#1a73e8", weight: 6, opacity: 0.9 }).addTo(g));
      }
    });
    if (plan.walkFromDock.geometry.length) lines.push(L.polyline(plan.walkFromDock.geometry, walk).addTo(g));
    // Name the swap stops right on the map.
    plan.stations.forEach((s, i) => {
      if (i > 0 && i < plan.stations.length - 1) {
        L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, keyboard: false })
          .bindTooltip(`Swap here: ${s.name}`, { permanent: true, direction: "top", offset: [0, -18], className: "swap-tip" })
          .addTo(g);
      }
    });
    map.current?.fitBounds(L.featureGroup(lines).getBounds().pad(0.15), {
      paddingBottomRight: [0, coverRef.current],
    });
  }, [plan]);

  useEffect(() => {
    const m = map.current;
    if (!focus || !m) return;
    // Centre the point in the part of the map the bottom sheet leaves visible.
    const z = 15;
    const p = m.project([focus.lat, focus.lon], z).add([0, coverRef.current / 2]);
    m.setView(m.unproject(p, z), z);
  }, [focus]);

  return (
    <>
      <div ref={el} className="map" />
      {compass && (
        <button
          className="compass"
          aria-label="Face north"
          title="Face north"
          onClick={() => { panRef.current?.(); map.current?.resetNorth({ animate: true }); }}
        >
          <div className="needle" ref={needle} style={{ transform: `rotate(${map.current?.getBearing() ?? 0}deg)` }}>
            <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
              <path d="M24 5 30 24H18Z" fill="#ef4444" />
              <path d="M24 43 18 24h12Z" fill="#dff3e6" />
              <circle cx="24" cy="24" r="2.6" fill="#0b3b25" stroke="#fff" strokeWidth="1.2" />
            </svg>
            <span>N</span>
          </div>
        </button>
      )}
    </>
  );
}
