import { useCallback, useEffect, useRef, useState } from "react";
import { crossed, timerState, type TimerAlert, type TimerState } from "../core/bikeTimer";
import { readTimer, writeTimer } from "../core/bikeTimerStore";
import { dockLine } from "../core/endDock";
import { alertNote, liveKey, liveNote, ALERT_TAG, LIVE_TAG } from "../core/timerNotify";
import { beep, primeAudio, speak, vibrate } from "./feedback";
import { askNotifyPermission, closeNote, notifyState, showNote, type NotifyState } from "./notify";
import { startPush, stopPush } from "./timerPush";
import { countUse } from "./usage";

const SAY: Record<TimerAlert, string> = {
  early: "Ten minutes left on your free ride.",
  warn: "Five minutes left on your free ride. Dock soon.",
  limit: "Your free 30 minutes are up. Dock your bike now to avoid more charges.",
  block: "Another charge just started. Dock your bike.",
};

/** The dock the rider is heading for, with what it has free right now (from the live station data). */
export interface EndDockLive { id: string; name: string; bikes: number; docks: number }

/** The rider's bike timer: started when they unlock, stopped when they dock. `end` is the dock the current ride ends at, if known: its open docks and bikes go in the notifications. */
export function useBikeTimer(end: EndDockLive | null = null) {
  const endRef = useRef(end);
  endRef.current = end;
  const endLine = () => (endRef.current ? dockLine(endRef.current.name, endRef.current) : undefined);
  const [startedAt, setStartedAt] = useState<number | null>(() => readTimer());
  const [now, setNow] = useState(() => Date.now());
  const [alert, setAlert] = useState<TimerAlert | null>(null);
  const lastSec = useRef<number | null>(null);
  const [notify, setNotify] = useState<NotifyState>(() => notifyState());
  // The server pushes this ride's notifications (the phone freezes the page in the background, so it can't keep a notification current itself).
  const [pushed, setPushed] = useState(false);
  const pushedRef = useRef(false);
  pushedRef.current = pushed;
  // The page is in the background (the rider switched to a maps app): that's when the notifications matter most.
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  useEffect(() => {
    if (startedAt == null) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [startedAt]);

  if (import.meta.env.DEV) (window as unknown as { __setTimerStart?: (t: number | null) => void }).__setTimerStart = setStartedAt; // for testing the warnings

  const state: TimerState | null = startedAt == null ? null : timerState(startedAt, now);

  useEffect(() => {
    if (!state) { lastSec.current = null; return; }
    const prev = lastSec.current;
    lastSec.current = state.elapsedSec;
    if (prev == null) return;
    const a = crossed(prev, state.elapsedSec);
    if (!a) return;
    setAlert(a);
    const soft = a === "early" || a === "warn";
    vibrate(soft ? [250, 120, 250] : [500, 150, 500, 150, 500]);
    beep(a === "early" ? 1 : soft ? 2 : 3, soft ? 880 : 660);
    speak(SAY[a]);
    // The same alert as a notification: it reaches the rider in another app, and waits in the tray otherwise. Quiet while the app is open (the beep and voice above already did the job).
    const note = pushedRef.current ? null : alertNote(a, state, undefined, endLine()); // pushed rides get the alert from the server
    if (note) void showNote(note, { silent: document.visibilityState === "visible" });
  }, [state?.elapsedSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = startedAt != null;
  useEffect(() => {
    if (!running || notify !== "on" || startedAt == null) { setPushed(false); return; }
    let current = true;
    const e = endRef.current;
    // Registering again when the end dock becomes known or changes is fine: the server keeps the ride and just learns the dock.
    void startPush(startedAt, e ? { id: e.id, name: e.name, docks: e.docks } : undefined).then((ok) => { if (current) setPushed(ok); });
    return () => { current = false; };
  }, [startedAt, running, notify, end?.id, end?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ask for notification permission (from a tap); counts when alerts get turned on. */
  const askNotify = useCallback(() => {
    const before = notifyState();
    void askNotifyPermission().then((s) => { setNotify(s); if (before !== "on" && s === "on") countUse("alerts_on"); });
  }, []);

  /** `usedMin`: minutes of the free window already gone (the rider unlocked this bike earlier). */
  const start = useCallback((usedMin = 0) => {
    primeAudio(); // this runs from the rider's tap, which is what lets the beeps play later
    countUse("timer_start");
    askNotify(); // ...and what lets the browser ask about notifications
    const now0 = Date.now();
    const t = now0 - Math.max(0, usedMin) * 60_000;
    lastSec.current = Math.floor((now0 - t) / 1000);
    setAlert(null); setNow(now0); setStartedAt(t); writeTimer(t);
  }, [askNotify]);
  const stop = useCallback(() => {
    setStartedAt(null); setAlert(null); writeTimer(null);
    void closeNote(LIVE_TAG); void closeNote(ALERT_TAG);
    void stopPush();
  }, []);
  const enableNotify = askNotify;

  // While the app is in the background, one notification that keeps itself current: minutes left, updated every minute.
  // The server pushes it (worker/timers.ts). Without push (not set up, or this browser can't), the page does it itself,
  // which only works until the phone freezes the page, about a minute after the rider leaves.
  const key = state ? liveKey(state) : null;
  useEffect(() => {
    if (!state || !hidden || notify !== "on") { void closeNote(LIVE_TAG); return; }
    if (!pushed) void showNote(liveNote(state, undefined, endLine()), { silent: true }); // pushed rides get it from the server
  }, [key, hidden, notify, pushed]); // eslint-disable-line react-hooks/exhaustive-deps

  return { running: startedAt != null, state, alert, start, stop, notify, enableNotify };
}
