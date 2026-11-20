import { useCallback, useEffect, useRef, useState } from "react";
import { crossed, readTimer, timerState, writeTimer, type TimerAlert, type TimerState } from "../core/bikeTimer";
import { alertNote, liveKey, liveNote, ALERT_TAG, LIVE_TAG } from "../core/timerNotify";
import { beep, primeAudio, speak, vibrate } from "./feedback";
import { askNotifyPermission, closeNote, notifyState, showNote, type NotifyState } from "./notify";

const SAY: Record<TimerAlert, string> = {
  early: "Ten minutes left on your free ride.",
  warn: "Five minutes left on your free ride. Dock soon.",
  limit: "Your free 30 minutes are up. Dock your bike now to avoid more charges.",
  block: "Another charge just started. Dock your bike.",
};

/** The rider's bike timer: started when they unlock, stopped when they dock. */
export function useBikeTimer() {
  const [startedAt, setStartedAt] = useState<number | null>(() => readTimer());
  const [now, setNow] = useState(() => Date.now());
  const [alert, setAlert] = useState<TimerAlert | null>(null);
  const lastSec = useRef<number | null>(null);
  const [notify, setNotify] = useState<NotifyState>(() => notifyState());
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
    const note = alertNote(a, state);
    if (note) void showNote(note, { silent: document.visibilityState === "visible" });
  }, [state?.elapsedSec]); // eslint-disable-line react-hooks/exhaustive-deps

  /** `usedMin`: minutes of the free window already gone (the rider unlocked this bike earlier). */
  const start = useCallback((usedMin = 0) => {
    primeAudio(); // this runs from the rider's tap, which is what lets the beeps play later
    void askNotifyPermission().then(setNotify); // ...and what lets the browser ask about notifications
    const now0 = Date.now();
    const t = now0 - Math.max(0, usedMin) * 60_000;
    lastSec.current = Math.floor((now0 - t) / 1000);
    setAlert(null); setNow(now0); setStartedAt(t); writeTimer(t);
  }, []);
  const stop = useCallback(() => {
    setStartedAt(null); setAlert(null); writeTimer(null);
    void closeNote(LIVE_TAG); void closeNote(ALERT_TAG);
  }, []);
  const enableNotify = useCallback(() => { void askNotifyPermission().then(setNotify); }, []);

  // While the app is in the background, one notification that keeps itself current: minutes left, updated every minute.
  // (Web apps can't draw a ticking clock in a notification, and the browser only wakes a hidden page about once a minute anyway.)
  const key = state ? liveKey(state) : null;
  useEffect(() => {
    if (!state || !hidden || notify !== "on") { void closeNote(LIVE_TAG); return; }
    void showNote(liveNote(state), { silent: true });
  }, [key, hidden, notify]); // eslint-disable-line react-hooks/exhaustive-deps

  return { running: startedAt != null, state, alert, start, stop, notify, enableNotify };
}
