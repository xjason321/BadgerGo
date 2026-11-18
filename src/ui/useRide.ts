import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { legAfterFix, navLegs, type NavLeg } from "../core/navLinks";
import type { LatLng, Plan } from "../core/types";

export interface Fix extends LatLng { accuracy?: number }

/** Ride mode: follows the rider's GPS position along the plan's legs and keeps the screen on. */
export function useRide(plan: Plan | null, destination: LatLng | null, destinationName?: string) {
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState<Fix | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [follow, setFollow] = useState(true);
  const [heading, setHeading] = useState<number | null>(null);
  const gps = useRef<{ h: number | null; speed: number }>({ h: null, speed: 0 });
  const compass = useRef<number | null>(null);
  const smooth = useRef<number | null>(null);
  const stopCompass = useRef<(() => void) | null>(null);
  const legsRef = useRef<NavLeg[]>([]);
  const watch = useRef<number | null>(null);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  const legs = useMemo(() => (plan && destination ? navLegs(plan, destination, destinationName) : []), [plan, destination?.lat, destination?.lon, destinationName]); // eslint-disable-line react-hooks/exhaustive-deps
  legsRef.current = legs;
  if (import.meta.env.DEV) (window as unknown as { __rideLegs?: NavLeg[] }).__rideLegs = legs; // for testing with a fake GPS

  /** Pick the best direction (GPS course when moving, compass when slow), smooth it, and publish it. */
  const publish = useCallback(() => {
    const moving = gps.current.speed >= 1.5 && gps.current.h != null;
    const raw = moving ? gps.current.h : compass.current ?? gps.current.h;
    if (raw == null) return;
    const prev = smooth.current;
    const next = prev == null ? raw : (prev + (((raw - prev + 540) % 360) - 180) * 1 + 360) % 360; // no extra lag here: the map eases toward the heading itself
    smooth.current = next;
    if (prev == null || Math.abs(((next - prev + 540) % 360) - 180) > 0.4) setHeading(next);
  }, []);

  const stop = useCallback(() => {
    stopCompass.current?.();
    stopCompass.current = null;
    gps.current = { h: null, speed: 0 }; compass.current = null; smooth.current = null;
    setHeading(null);
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    lock.current?.release().catch(() => {});
    lock.current = null;
    setActive(false);
    setPos(null);
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) { setError("This device can't share its location."); return; }
    setError(""); setIndex(0); setFollow(true); setActive(true);
    // Compass: iOS asks permission (this runs from the Start tap, which allows it); Android reports it as "absolute".
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    const onOri = (e: Event) => {
      const o = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const h = typeof o.webkitCompassHeading === "number" ? o.webkitCompassHeading : o.absolute && o.alpha != null ? (360 - o.alpha) % 360 : null;
      if (h == null) return;
      compass.current = h;
      publish();
    };
    const listen = () => {
      window.addEventListener("deviceorientationabsolute", onOri);
      window.addEventListener("deviceorientation", onOri);
      stopCompass.current = () => {
        window.removeEventListener("deviceorientationabsolute", onOri);
        window.removeEventListener("deviceorientation", onOri);
      };
    };
    if (DOE?.requestPermission) DOE.requestPermission().then((r) => r === "granted" && listen()).catch(() => {});
    else listen();
    (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request("screen").then((l) => { lock.current = l; }).catch(() => {});
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
        setPos(fix);
        gps.current = { h: typeof p.coords.heading === "number" && !Number.isNaN(p.coords.heading) ? p.coords.heading : gps.current.h, speed: p.coords.speed ?? 0 };
        publish();
        setIndex((i) => legAfterFix(legsRef.current, i, fix)); // close to the leg's end (the next dock): on to the next leg
      },
      (e) => { setError(e.code === 1 ? "Location permission was denied." : "Can't get your location right now."); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }, [publish]);

  // A different route (or none) ends the ride.
  useEffect(() => { if (active) stop(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [plan?.id]);
  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);

  return { active, pos, heading, index, legs, error, follow, setFollow, setIndex, start, stop, done: active && legs.length > 0 && index >= legs.length };
}
