import { useCallback, useEffect, useRef, useState } from "react";
import { crossed, readTimer, timerState, writeTimer, type TimerAlert, type TimerState } from "../core/bikeTimer";
import { beep, primeAudio, speak, vibrate } from "./feedback";

const SAY: Record<TimerAlert, string> = {
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
    vibrate(a === "warn" ? [250, 120, 250] : [500, 150, 500, 150, 500]);
    beep(a === "warn" ? 2 : 3, a === "warn" ? 880 : 660);
    speak(SAY[a]);
  }, [state?.elapsedSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => {
    primeAudio(); // this runs from the rider's tap, which is what lets the beeps play later
    const t = Date.now();
    lastSec.current = 0;
    setAlert(null); setNow(t); setStartedAt(t); writeTimer(t);
  }, []);
  const stop = useCallback(() => { setStartedAt(null); setAlert(null); writeTimer(null); }, []);

  return { running: startedAt != null, state, alert, start, stop };
}
