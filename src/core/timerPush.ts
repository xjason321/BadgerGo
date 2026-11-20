// What the server pushes to a rider's phone while the bike timer runs. A web page can't keep its own notification
// current in the background (the phone freezes it after about a minute), so the Worker sends one push a minute
// and the phone's service worker shows it. Pure, so the client and the Worker agree.
import { crossed, timerState } from "./bikeTimer";
import { dockLine, type DockCounts } from "./endDock";
import { alertNote, liveNote, type NoteContent } from "./timerNotify";

/** A push goes out this long after each whole minute of the ride (so the minute label has changed by then). */
export const TICK_OFFSET_MS = 1000;
/** Rides older than this are forgotten (the app drops a saved timer after the same time). */
export const MAX_RIDE_MS = 3 * 3600_000;

export interface PushNote extends NoteContent {
  /** A heads-up that should buzz and sound; the minute-by-minute countdown is quiet. */
  alert: boolean;
}

/** The first push moment strictly after `now`. */
export function nextPushAt(startedAt: number, now: number): number {
  const n = Math.max(1, Math.floor((now - startedAt - TICK_OFFSET_MS) / 60_000) + 1);
  return startedAt + n * 60_000 + TICK_OFFSET_MS;
}

/** What to push at `at` (a push moment): the alert that moment is, else the countdown. `dock` adds how many docks and bikes are left where the rider is heading. */
export function pushFor(startedAt: number, at: number, dock?: { name: string; counts: DockCounts }): PushNote {
  const s = timerState(startedAt, at);
  const line = dock ? dockLine(dock.name, dock.counts) : undefined;
  const alert = crossed(Math.max(0, s.elapsedSec - 60), s.elapsedSec);
  const note = alert ? alertNote(alert, s, undefined, line) : null;
  return note ? { ...note, alert: true } : { ...liveNote(s, undefined, line), alert: false };
}
