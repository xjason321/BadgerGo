import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOUNDARY_OSM_ID, MAP_CENTER, SEARCH_VIEWBOX, SYSTEM_ID } from "../config";
import { KINDS } from "../core/bikeways";
import { loadBoundary, type Boundary } from "../core/boundary";
import { fetchStations } from "../core/gbfs";
import { geocode, reverseGeocode, suggestPlaces } from "../core/geocode";
import { walkOnlyPlan } from "../core/planner";
import { formatDistance } from "../core/ride";
import { useRide } from "./useRide";
import { norm, searchCampus, type CampusPlace } from "../core/campus";
import { planRoutes, rankPlans } from "../core/planner";
import { analyzePlan, strictRefiner } from "../core/roads";
import { FallbackProvider, OsrmProvider, ValhallaProvider } from "../core/routing";
import { DEFAULT_PREFS, STUDENT_PLAN, type Place, type Plan, type RoadPrefs, type Station } from "../core/types";
import { BikeIcon, MoonIcon, PinIcon, SearchIcon, SunIcon, TargetIcon, WalkIcon } from "./icons";
import { haversine } from "../core/geo";
import { MapView } from "./MapView";
import { PlaceMenu } from "./PlaceMenu";
import { PlanCard } from "./PlanCard";
import { TerrainPicker } from "./TerrainPicker";

type Target = "origin" | "destination";
type Snap = "peek" | "half" | "full";

/** Bottom-sheet heights on phones (px or fraction of the screen). */
const sheetPx = (snap: Snap, vh: number) => (snap === "peek" ? 150 : snap === "half" ? Math.round(vh * 0.54) : Math.round(vh * 0.92));
/** 65 -> "1 h 5 min", 35 -> "35 min". */
const hm = (m: number) => {
  const t = Math.max(1, Math.round(m));
  return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h${t % 60 ? ` ${t % 60} min` : ""}`;
};
const SNAPS: Snap[] = ["peek", "half", "full"];

export function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [text, setText] = useState({ origin: "", destination: "" });
  const [picking, setPicking] = useState<Target | null>(null);
  const [maxRide, setMaxRide] = useState(25);
  const [swapsOn, setSwapsOn] = useState(true);
  const [prefs, setPrefs] = useState<RoadPrefs>(DEFAULT_PREFS);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string>("Loading docks…");
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState("");
  const [focus, setFocus] = useState<{ lat: number; lon: number; n: number } | null>(null);
  const [menu, setMenu] = useState<{ lat: number; lon: number; label: string | null } | null>(null);

  const originRef = useRef<Place | null>(null);
  originRef.current = origin;

  // Phone bottom sheet.
  const [snap, setSnap] = useState<Snap>("half");
  const [vh, setVh] = useState(() => window.innerHeight);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const isPhone = () => window.matchMedia("(max-width: 899px)").matches;
  // Phone form screen: the sheet is only as tall as its content (measured below); route screens keep the drag-to-resize sheet.
  const [fitH, setFitH] = useState(0);
  const panelEl = useRef<HTMLElement>(null);
  // Phone routes screen: the cards sit in a panel that slides up and down, snapping at three heights
  // (0: the title and stats, 1: + the timeline, 2: everything). The rest of the card waits below the screen edge.
  const [detail, setDetail] = useState(0);
  const [levels, setLevels] = useState<number[] | null>(null); // how far down the panel is pushed at each height (px)
  const [slideDrag, setSlideDrag] = useState<number | null>(null); // finger-following offset while dragging
  const touch = useRef<{ x: number; y: number; vert: boolean } | null>(null);
  const sheetH = levels && fitH ? Math.max(120, fitH - levels[detail]) : fitH || (dragH ?? sheetPx(snap, vh));

  // Light / dark theme: remembered, and starts from the phone's own setting.
  const [dark, setDark] = useState(() => {
    try { const v = localStorage.getItem("badgergo-theme"); if (v) return v === "dark"; } catch { /* private mode */ }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#07170e" : "#0b3b25");
    try { localStorage.setItem("badgergo-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  const [phone, setPhone] = useState(() => window.matchMedia("(max-width: 899px)").matches);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 899px)");
    const on = () => setPhone(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  const fitForm = phone && plans.length === 0;
  const slidingRoutes = phone && plans.length > 0;
  useLayoutEffect(() => {
    const panel = panelEl.current;
    if (!panel || !slidingRoutes) { setLevels(null); return; }
    const card = (panel.querySelector(".plan.sel") ?? panel.querySelector(".plan")) as HTMLElement | null;
    if (!card) return;
    const c = card.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const top = c.top - pr.top; // the panel's own transform cancels out of these differences
    const H = panel.offsetHeight;
    const at = (sel: string, extra: number) => {
      const el = card.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect().bottom - c.top + extra : c.height;
    };
    const shown = [at(".stats", 16), at(".tl", 16), c.height + 14];
    setLevels(shown.map((v, i) => (i === 2 ? 0 : Math.max(0, Math.round(H - (top + v + 14))))));
  }, [slidingRoutes, plans, selected, fitH]);
  useEffect(() => {
    const el = panelEl.current;
    if (!el || !phone) { setFitH(0); return; }
    const ro = new ResizeObserver(() => setFitH(el.offsetHeight));
    ro.observe(el);
    setFitH(el.offsetHeight);
    return () => ro.disconnect();
  }, [phone]);
  const [advanced, setAdvanced] = useState(false);
  const themeBtn = (cls: string) => (
    <button
      className={`theme-btn ${cls}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => setDark((d) => !d)}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
    </button>
  );

  // What the current routes were computed from: Find routes stays off until one of these changes.
  const sigOf = (o: Place | null, d: Place | null) =>
    JSON.stringify([o && [o.lat, o.lon], d && [d.lat, d.lon], swapsOn, swapsOn ? maxRide : 0, prefs]);
  const [doneSig, setDoneSig] = useState("");
  useEffect(() => { if (strip.current) strip.current.scrollLeft = 0; }, [plans]);
  const goBack = () => { setPlans([]); setSelected(0); setBackup(""); setStatus(""); };
  // On phones the route cards sit in a sideways, snapping strip: swiping to a card selects it, tapping a card scrolls it into view.
  const strip = useRef<HTMLUListElement>(null);
  const cardAt = (i: number) => strip.current?.children[i] as HTMLElement | undefined;
  const progUntil = useRef(0); // ignore scroll events while we scroll a card into place ourselves
  const onStripScroll = () => {
    const el = strip.current;
    if (!el || !el.children.length) return;
    if (!isPhone()) {
      // Laptops: the card nearest the middle of the strip is the chosen one.
      if (Date.now() < progUntil.current) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0, bestD = Infinity;
      Array.from(el.children).forEach((c, i) => {
        const h = c as HTMLElement;
        const d = Math.abs(h.offsetLeft + h.offsetWidth / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      });
      setSelected((cur) => (cur === best ? cur : best));
      return;
    }
    const first = el.children[0] as HTMLElement;
    const stride = first.offsetWidth + 12;
    const i = Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollLeft / stride)));
    setSelected((cur) => (cur === i ? cur : i));
  };
  const selectCard = (i: number) => {
    setSelected(i);
    if (isPhone()) cardAt(i)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    else { progUntil.current = Date.now() + 700; cardAt(i)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); }
  };
  // Laptops: drag the strip sideways with the mouse; on release it snaps to the nearest card.
  const stripDrag = useRef<{ x: number; last: number; left: number; moved: boolean; id: number; from: number } | null>(null);
  const justDragged = useRef(false);
  const onStripDown = (e: React.PointerEvent<HTMLUListElement>) => {
    if (phone || e.pointerType !== "mouse" || e.button !== 0) return;
    stripDrag.current = { x: e.clientX, last: e.clientX, left: e.currentTarget.scrollLeft, moved: false, id: e.pointerId, from: selected };
  };
  const onStripMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = stripDrag.current, el = strip.current;
    if (!d || !el) return;
    d.last = e.clientX;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 4) return;
      d.moved = true;
      progUntil.current = Number.MAX_SAFE_INTEGER; // no selection changes mid-drag: that was the jitter
      el.setPointerCapture(d.id);
      el.style.scrollSnapType = "none";
      el.style.cursor = "grabbing";
    }
    el.scrollLeft = d.left - (e.clientX - d.x);
  };
  const onStripUp = () => {
    const d = stripDrag.current, el = strip.current;
    stripDrag.current = null;
    if (!d?.moved || !el) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    // Any real drag moves one card in the direction it was dragged, however short; a long drag lands on the nearest card.
    const dx = d.x - d.last;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0, bestD = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const h = c as HTMLElement;
      const dist = Math.abs(h.offsetLeft + h.offsetWidth / 2 - mid);
      if (dist < bestD) { bestD = dist; best = i; }
    });
    let target = best;
    if (best === d.from && Math.abs(dx) >= 4) target = d.from + (dx > 0 ? 1 : -1);
    target = Math.max(0, Math.min(el.children.length - 1, target));
    el.style.scrollSnapType = "";
    el.style.cursor = "";
    progUntil.current = 0;
    selectCard(target);
  };
  const step = (d: number) => selectCard(Math.max(0, Math.min(plans.length - 1, selected + d)));
  const stepRef = useRef(step);
  stepRef.current = step;
  // Laptops: scroll wheel and arrow keys move one card at a time.
  useEffect(() => {
    const el = strip.current;
    if (!el || phone || !plans.length) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // sideways trackpad swipes scroll natively
      e.preventDefault();
      const now = Date.now();
      if (now - last < 280 || Math.abs(e.deltaY) < 4) return;
      last = now;
      stepRef.current(e.deltaY > 0 ? 1 : -1);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((t instanceof Element && t.closest("input, textarea, select, [contenteditable]")) || document.querySelector(".app.riding")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); stepRef.current(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); stepRef.current(-1); }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKey); };
  }, [phone, plans.length]);
  const onGrabDown = (e: React.PointerEvent) => {
    if (!isPhone() || fitH) return; // the side panel on a laptop, and the content-sized form sheet, don't resize
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheetPx(snap, vh), moved: false };
  };
  const onGrabMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.y) > 6) d.moved = true;
    if (d.moved) setDragH(Math.min(sheetPx("full", vh), Math.max(110, d.h - (e.clientY - d.y))));
  };
  const onGrabUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "half"); // a tap steps through the sizes
    } else if (dragH != null) {
      setSnap(SNAPS.reduce((best, s) => (Math.abs(sheetPx(s, vh) - dragH) < Math.abs(sheetPx(best, vh) - dragH) ? s : best), "half" as Snap));
    }
    setDragH(null);
  };

  const REFRESH_MS = 60_000;
  const [loadedAt, setLoadedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const canRefresh = !refreshing && loadedAt > 0 && now - loadedAt >= REFRESH_MS;
  /** Re-download the BCycle bike and dock counts. At most once a minute. */
  const refreshStations = async () => {
    if (refreshing || Date.now() - loadedAt < REFRESH_MS) return;
    setRefreshing(true);
    try {
      setStations(await fetchStations(SYSTEM_ID));
      setLoadedAt(Date.now());
    } catch (e) { setStatus(`Couldn't refresh docks: ${(e as Error).message}`); } finally { setRefreshing(false); }
  };

  useEffect(() => {
    fetchStations(SYSTEM_ID)
      .then((s) => {
        setStations(s);
        setLoadedAt(Date.now());
        setStatus((cur) => (cur === "Loading docks…" ? `${s.length} docks loaded. Search, long-press the map, or use your location.` : cur));
      })
      .catch((e) => setStatus(`Couldn't load docks: ${e.message}`));
    locate(true); // ask for the location straight away
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (t: Target, p: Place) => (t === "origin" ? setOrigin(p) : setDestination(p));

  const [sugg, setSugg] = useState<{ t: Target; items: CampusPlace[] } | null>(null);
  /** A start or end was just chosen: if the other one is set too, find routes right away. */
  const autoGo = (t: Target, p: Place) => {
    if (!stations.length) return;
    if (t === "destination" && origin) go(origin, p);
    else if (t === "origin" && destination) go(p, destination);
  };
  // Anything-in-Madison suggestions (restaurants, shops, addresses) are added under the campus matches while you type.
  const suggReq = useRef(0);
  const suggTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onType = (t: Target, value: string) => {
    const campus = searchCampus(value, 4);
    setSugg(campus.length ? { t, items: campus } : null);
    clearTimeout(suggTimer.current);
    const id = ++suggReq.current;
    if (value.trim().length < 3) return;
    suggTimer.current = setTimeout(async () => {
      try {
        const found = await suggestPlaces(value.trim(), SEARCH_VIEWBOX, { limit: 6 });
        if (id !== suggReq.current) return; // typed something newer meanwhile
        const have = new Set(campus.map((c) => norm(c.name)));
        const extra: CampusPlace[] = found
          .filter((f) => !have.has(norm(f.name)))
          .map((f) => ({ name: f.name, lat: f.lat, lon: f.lon, address: f.address || "Madison area", kind: "n" as const }));
        const items = [...campus, ...extra].slice(0, 8);
        setSugg(items.length ? { t, items } : null);
      } catch { /* keep the campus matches */ }
    }, 280);
  };
  const pickCampus = (t: Target, c: CampusPlace) => {
    clearTimeout(suggTimer.current);
    suggReq.current++; // drop any suggestions still on their way
    set(t, { lat: c.lat, lon: c.lon, label: c.name });
    autoGo(t, { lat: c.lat, lon: c.lon, label: c.name });
    setText((x) => ({ ...x, [t]: c.name }));
    setFocus({ lat: c.lat, lon: c.lon, n: Date.now() });
    setPicking(null);
    setSugg(null);
  };

  const search = async (t: Target) => {
    if (!text[t].trim()) return;
    const [best] = searchCampus(text[t], 1);
    if (best) { pickCampus(t, best); return; }
    setBusy(true);
    let chosen: Place | null = null;
    try {
      const [hit] = await geocode(text[t], { viewbox: SEARCH_VIEWBOX, limit: 1 });
      if (!hit) { setStatus(`No match for "${text[t]}"`); return; }
      set(t, hit);
      chosen = hit;
      setText((x) => ({ ...x, [t]: hit.label.split(",").slice(0, 2).join(",") }));
      setFocus({ lat: hit.lat, lon: hit.lon, n: Date.now() });
      setPicking(null);
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
    // After the search's own busy flag is cleared, so it can't switch off the one Find routes sets.
    if (chosen) autoGo(t, chosen);
  };

  /**
   * Ask the browser for the user's location and use it as the start. `auto` is the call made on
   * page load: it shows the permission prompt right away, or, if permission was already given,
   * just sets the start. It never overwrites a start the user has already chosen, and it fails quietly.
   */
  const locate = (auto: boolean) => {
    if (!("geolocation" in navigator)) {
      if (!auto) setStatus("This browser doesn't support geolocation.");
      return;
    }
    if (!auto) { setBusy(true); setStatus("Finding your location…"); }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (auto && originRef.current) return; // they picked a start while we were waiting
        const { latitude: lat, longitude: lon } = pos.coords;
        set("origin", { lat, lon, label: "My location" });
        setText((x) => ({ ...x, origin: "My location" }));
        setFocus({ lat, lon, n: Date.now() });
        setBusy(false);
        setStatus("Where do you want to go?");
        if (!auto) autoGo("origin", { lat, lon, label: "My location" });
      },
      (err) => {
        setBusy(false);
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("Location is off. Search or long-press the map to choose a start, or allow location in your browser's site settings.");
        } else if (!auto) {
          setStatus(`Couldn't get your location (${err.message}).`);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };
  const useMyLocation = () => locate(false);

  const place = (t: Target, lat: number, lon: number, name?: string | null) => {
    const label = name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    set(t, { lat, lon, label });
    setText((x) => ({ ...x, [t]: label }));
  };

  const onMapClick = (lat: number, lon: number) => {
    if (!picking) return;
    place(picking, lat, lon);
    autoGo(picking, { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
    setPicking(picking === "origin" ? "destination" : null);
  };

  /** A start/end marker was dragged (desktop). Move it, then fill in a nicer name when the lookup returns. */
  const onMovePoint = async (t: Target, lat: number, lon: number) => {
    place(t, lat, lon);
    const moved: Place = { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
    const other = t === "origin" ? destination : origin;
    if (other) go(t === "origin" ? moved : other, t === "origin" ? other : moved); // both ends set: re-run Find routes
    else setStatus(`${t === "origin" ? "Start" : "End"} moved.`);
    const name = await reverseGeocode(lat, lon).catch(() => null);
    if (name) place(t, lat, lon, name);
  };

  const onLongPress = (lat: number, lon: number) => {
    setMenu({ lat, lon, label: null });
    reverseGeocode(lat, lon)
      .then((name) => setMenu((m) => (m && m.lat === lat && m.lon === lon ? { ...m, label: name } : m)))
      .catch(() => {});
  };

  const go = async (from: Place | null = origin, to: Place | null = destination) => {
    if (!from || !to) return;
    const [origin, destination] = [from, to]; // an explicit pair wins over state that hasn't updated yet
    setBusy(true); setPlans([]); setSelected(0); setBackup(""); setStatus("Finding routes…");
    const provider = new FallbackProvider(new ValhallaProvider(prefs), new OsrmProvider());
    // Without swaps there is one ride, so the only limit that matters is the free ride time.
    const limit = swapsOn ? maxRide : STUDENT_PLAN.freeMinutes;
    try {
      // Walking straight there is always offered. It uses plain walking directions, no terrain or time preferences.
      const walking = Promise.race([provider.route("walk", origin, destination, false), new Promise<never>((_, no) => setTimeout(() => no(new Error("walk timed out")), 10000))]).then(([w]) => (w ? walkOnlyPlan(w) : null)).catch(() => null);
      let found: Plan[] = [];
      let planError: Error | null = null;
      try {
        found = await planRoutes(origin, destination, stations, provider, {
          maxRideMinutes: limit,
          maxSwaps: swapsOn ? Infinity : 0,
          refineRide: prefs.strict && prefs.traffic < KINDS.length - 1 ? strictRefiner(provider, prefs.traffic) : undefined,
        });
      } catch (e) { planError = e as Error; }
      setStatus("Checking road types…");
      // Road types for every route (they decide the ranking and color the map). Best effort.
      const withRoads = await Promise.all(
        found.map(async (p) => {
          try { return { ...p, roads: await analyzePlan(p) }; } catch { return p; }
        }),
      );
      const bikeRanked = rankPlans(withRoads, prefs.traffic);
      const walkPlan = await walking;
      if (!bikeRanked.length && !walkPlan) throw planError ?? new Error("No routes found");
      // Walking goes first (as "Recommended") when it's at least as fast as the best bike route; otherwise it's the last option.
      const walkFirst = !!walkPlan && (!bikeRanked.length || walkPlan.totalMinutes <= bikeRanked[0].totalMinutes);
      const bikes = walkFirst
        ? bikeRanked.map((p, i) => ({ ...p, label: `Option ${i + 2} · ${p.label.split(" · ")[1] ?? ""}` }))
        : bikeRanked;
      const ranked = !walkPlan ? bikeRanked : walkFirst ? [walkPlan, ...bikes] : [...bikes, walkPlan];
      setPlans(ranked); setSelected(0); setDoneSig(sigOf(origin, destination)); setBackup(provider.fellBack ? provider.reason || "unavailable" : "");
      if (isPhone()) setSnap("half");
      const ok = bikeRanked.filter((x) => x.withinLimit).length;
      const walkNote = walkPlan && !walkFirst ? ` Walking directly would take ${hm(walkPlan.totalMinutes)}.` : "";
      setStatus(
        (!bikeRanked.length
          ? `No bike route found${planError ? `: ${planError.message.replace(/[.\s]+$/, "")}` : ""}. Showing the walk.`
          : walkFirst
            ? `Walking directly (${hm(walkPlan!.totalMinutes)}) is as fast as any bike route.`
            : ok
              ? `${ok} of ${bikeRanked.length} bike routes keep every ride within ${limit} min.`
              : `No bike route keeps every ride within ${limit} min${swapsOn ? "" : " (try enabling swaps)"}; showing the cheapest.`) + (walkFirst ? "" : walkNote),
      );
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  };

  const plan = plans[selected] ?? null;
  const ride = useRide(plan, destination, destination?.label.split(",")[0]);
  const startRide = () => { ride.start(); setSnap("peek"); };
  const leg = ride.legs[ride.index];
  const left = leg && ride.pos ? formatDistance(haversine(ride.pos, leg.to)) : null;

  return (
    <div className={`app${ride.active ? " riding" : ""}`} style={{ ["--sheet-h" as string]: `${ride.active ? 0 : sheetH}px` }}>
      <MapView
        center={MAP_CENTER}
        stations={stations}
        origin={origin}
        destination={destination}
        plan={plan}
        boundary={boundary}
        pin={menu}
        focus={focus}
        coveredBottom={isPhone() && !ride.active ? Math.min(sheetH, Math.round(vh * 0.6)) : 0}
        onMapClick={onMapClick}
        onLongPress={onLongPress}
        onMovePoint={onMovePoint}
        me={ride.active ? ride.pos : null}
        loadedAt={loadedAt}
        refreshing={refreshing}
        onRefresh={refreshStations}
        follow={ride.follow}
        compass={ride.active}
        dark={dark}
        heading={ride.active ? ride.heading : null}
        onUserPan={() => ride.setFollow(false)}
      />
      {ride.active && (
        <div className="ride-bar" role="status">
          {ride.error ? (
            <div className="ride-main"><b>{ride.error}</b></div>
          ) : ride.done ? (
            <div className="ride-main"><b>You've arrived</b><span>Enjoy!</span></div>
          ) : leg ? (
            <>
              <span className={`ride-ico ${leg.kind}`}>{leg.kind === "ride" ? <BikeIcon size={22} /> : <WalkIcon size={22} />}</span>
              <div className="ride-main">
                <b>{leg.kind === "ride" ? "Ride" : "Walk"} to {leg.toName}</b>
                <span>
                  {left ? `${left} to go` : "Finding your location…"} · step {ride.index + 1} of {ride.legs.length}
                  {leg.swap ? " · dock your bike here, then rent another" : ""}
                </span>
              </div>
            </>
          ) : null}
          <div className="ride-btns">
            <button className="end" onClick={ride.stop}>End</button>
          </div>
        </div>
      )}
      {busy && (
        <div className="working-pill" role="status" aria-live="polite">
          <span className="spin-bike"><BikeIcon size={20} /></span> Working
        </div>
      )}
      {ride.active && !ride.done && !ride.follow && (
        <button className="recenter" onClick={() => ride.setFollow(true)} aria-label="Recenter on me">
          <TargetIcon size={20} /> Recenter
        </button>
      )}
      {plan && !plan.walkOnly && !ride.active && (
        <button className="start-fab" onClick={startRide}><BikeIcon size={20} /> Start</button>
      )}
      {plans.length > 0 && !ride.active && (
        <button className="back-fab" onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          Back
        </button>
      )}
      {themeBtn("on-desktop")}
      <aside ref={panelEl} className={`panel${fitForm ? " fit" : ""}${dragH != null ? " dragging" : ""}${plans.length && !ride.active ? " show-routes" : ""}${slideDrag != null ? " sliding" : ""}`} style={levels && slidingRoutes ? { transform: `translateY(${slideDrag ?? levels[detail]}px)` } : undefined}>
        <button className="panel-back" onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          Back
        </button>
        <div className="grab" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp} onPointerCancel={onGrabUp}>
          <span />
        </div>
        <header className="brand" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp} onPointerCancel={onGrabUp}>
          <img src="/badgergo-logo.png" alt="" width={44} height={44} />
          <h1>BadgerGo!</h1>
          {themeBtn("in-header")}
        </header>

        <div className="scroll">
          <section className="card where form-only">
            {(["origin", "destination"] as Target[]).map((t) => (
              <div className="loc-row" key={t}>
                <span className={`dot ${t === "origin" ? "start" : "end"}`} aria-hidden="true" />
                <input
                  value={text[t]}
                  placeholder={t === "origin" ? "Memorial Union" : "Union South"}
                  aria-label={t === "origin" ? "Start" : "End"}
                  onChange={(e) => {
                    setText({ ...text, [t]: e.target.value });
                    onType(t, e.target.value);
                  }}
                  onBlur={() => setTimeout(() => setSugg((x) => (x?.t === t ? null : x)), 150)}
                  onKeyDown={(e) => e.key === "Enter" && search(t)}
                />
                {t === "destination" && text.destination && (
                  <button
                    className="icon-btn clear-btn"
                    onClick={() => {
                      setText((x) => ({ ...x, destination: "" }));
                      setDestination(null);
                      setPlans([]);
                      setSelected(0);
                      setSugg(null);
                      setStatus("End cleared. Search or pick a new end point.");
                    }}
                    title="Clear end"
                    aria-label="Clear end"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                )}
                {t === "origin" && (
                  <button className="icon-btn" onClick={useMyLocation} disabled={busy} title="Use my location" aria-label="Use my location">
                    <TargetIcon />
                  </button>
                )}
                <button
                  className={`icon-btn${picking === t ? " on" : ""}`}
                  onClick={() => setPicking(picking === t ? null : t)}
                  title="Pick on map"
                  aria-label={`Pick ${t === "origin" ? "start" : "end"} on map`}
                >
                  <PinIcon />
                </button>
                <button className="icon-btn" onClick={() => search(t)} disabled={busy} title="Search" aria-label="Search">
                  <SearchIcon />
                </button>
                {sugg?.t === t && (
                  <ul className="suggest" role="listbox">
                    {sugg.items.map((c, n) => (
                      <li key={n + c.name + (c.via ?? "")} role="option" onPointerDown={(e) => { e.preventDefault(); pickCampus(t, c); }}>
                        <b>{c.name}</b>
                        <span>{c.via ? `${c.via} · ` : ""}{c.address || "UW–Madison"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {picking && <p className="hint-line">Tap the map to set the {picking === "origin" ? "start" : "end"}.</p>}
          </section>

          <button className="primary form-only" onClick={() => go()} disabled={!origin || !destination || !stations.length || busy || (plans.length > 0 && sigOf(origin, destination) === doneSig)}>
            {busy ? "Working…" : "Find routes"}
          </button>
          {plans.length > 0 && !ride.active && (
            <h2 className="trip-title">
              {(text.origin || origin?.label.split(",")[0] || "Start")} to {(text.destination || destination?.label.split(",")[0] || "End")}
            </h2>
          )}
          {(status || canRefresh || refreshing) && <p className="status">
            {status}
            {(canRefresh || refreshing) && (
              <>
                {" "}
                <button className="link-btn" onClick={refreshStations} disabled={refreshing}>
                  {refreshing ? "Refreshing BCycle data…" : "Refresh BCycle data"}
                </button>
              </>
            )}
          </p>}
          {backup && (
            <p className="status warn">Preference router unavailable ({backup}). Used a backup that ignores road preferences; try again in a few minutes.</p>
          )}

          <div className="advanced form-only">
            <button className="adv-toggle" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
              <span>Advanced options</span>
              <span className="adv-sum">{swapsOn ? `swaps up to ${maxRide} min` : "no swaps"}</span>
              <svg className={`chev${advanced ? " open" : ""}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {advanced && (
              <div className="adv-body">
          <section className="card">
            <h2>Bike swapping</h2>
            <label className="check">
              <input type="checkbox" checked={swapsOn} onChange={(e) => setSwapsOn(e.target.checked)} />
              <span>Enable swaps to limit undocked time</span>
            </label>
            {swapsOn ? (
              <div className="indent">
                <div className="slider-head"><span>Max time between docks (for comfort)</span><b>{maxRide} min</b></div>
                <input type="range" min={5} max={30} step={5} value={maxRide} onChange={(e) => setMaxRide(+e.target.value)} />
              </div>
            ) : (
              <p className="muted">Keep in mind that BCycle's student plan is first 30 min free, then $8 per extra 30 min.</p>
            )}
          </section>

          <section className="card">
            <h2>Terrain preferences</h2>
            <TerrainPicker prefs={prefs} onChange={setPrefs} />
          </section>

              </div>
            )}
          </div>

          <div className="strip-wrap">
            {!phone && plans.length > 1 && (
              <button className="strip-arrow left" onClick={() => step(-1)} disabled={selected === 0} aria-label="Previous route">‹</button>
            )}
            <ul
              className="plans"
              ref={strip}
              onScroll={onStripScroll}
              onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, vert: false }; }}
              onTouchMove={(e) => {
                const t = touch.current;
                if (!t || !phone || !levels) return;
                const fx = e.touches[0].clientX - t.x, fy = e.touches[0].clientY - t.y;
                if (!t.vert && Math.abs(fy) > 8 && Math.abs(fy) > Math.abs(fx) * 1.2) t.vert = true;
                if (t.vert) setSlideDrag(Math.max(0, Math.min(levels[0], levels[detail] + fy)));
              }}
              onTouchEnd={(e) => {
                const t = touch.current; touch.current = null;
                if (!t || !phone || !levels) return;
                setSlideDrag(null);
                if (!t.vert) return;
                const fy = e.changedTouches[0].clientY - t.y;
                const pos = Math.max(0, Math.min(levels[0], levels[detail] + fy));
                let best = 0;
                levels.forEach((y, i) => { if (Math.abs(y - pos) < Math.abs(levels[best] - pos)) best = i; });
                if (best === detail && Math.abs(fy) > 24) best = Math.max(0, Math.min(2, detail + (fy < 0 ? 1 : -1))); // a flick moves one step
                setDetail(best);
              }}
              onPointerDown={onStripDown}
              onPointerMove={onStripMove}
              onPointerUp={onStripUp}
              onPointerCancel={onStripUp}
              onClickCapture={(e) => { if (justDragged.current) { e.stopPropagation(); e.preventDefault(); } }}
            >
              {plans.map((p, i) => (
                <PlanCard key={p.id} plan={p} index={i} selected={i === selected} trafficLevel={prefs.traffic} onSelect={() => selectCard(i)} />
              ))}
            </ul>
            {!phone && plans.length > 1 && (
              <button className="strip-arrow right" onClick={() => step(1)} disabled={selected === plans.length - 1} aria-label="Next route">›</button>
            )}
          </div>
        </div>
        <a className="bcycle-logo" href="https://madison.bcycle.com/" target="_blank" rel="noopener noreferrer" title="Madison BCycle">
          <img src="/madison-bcycle-logo.png" alt="Madison BCycle" height={30} />
        </a>
      </aside>
      {menu && (
        <PlaceMenu
          lat={menu.lat}
          lon={menu.lon}
          label={menu.label}
          onClose={() => setMenu(null)}
          onSet={(t) => {
            place(t, menu.lat, menu.lon, menu.label);
            autoGo(t, { lat: menu.lat, lon: menu.lon, label: menu.label || `${menu.lat.toFixed(5)}, ${menu.lon.toFixed(5)}` });
            setMenu(null);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
