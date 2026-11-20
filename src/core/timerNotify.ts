import { EARLY_WARN_MIN, WARN_BEFORE_MIN, type TimerAlert, type TimerState } from "./bikeTimer";
import { STUDENT_PLAN, type PricingPlan } from "./types";

/** What a notification says. `tag` makes a new one replace the old one with the same tag. */
export interface NoteContent { title: string; body: string; tag: string }

/** The heads-ups (10 and 5 minutes left, then over) each get a sound; the live countdown updates in place, quietly. */
export const ALERT_TAG = "badgergo-timer-alert";
export const LIVE_TAG = "badgergo-timer-live";

/** An alert this much later than its moment is no use (the phone was asleep or the app frozen): drop it. */
const STALE_SEC = 150;
const STALE_AFTER_LIMIT_SEC = 300;

const minsLeft = (s: TimerState) => Math.max(1, Math.ceil(s.remainingSec / 60));

/**
 * The notification for an alert, or null when it's too late to be useful (the timer only noticed
 * the moment passed after the phone woke up). Nothing here touches the browser.
 */
export function alertNote(alert: TimerAlert, s: TimerState, plan: PricingPlan = STUDENT_PLAN): NoteContent | null {
  const free = plan.freeMinutes * 60;
  const block = plan.blockMinutes * 60;
  const charge = `$${plan.blockCost}`;
  switch (alert) {
    case "early": {
      if (s.elapsedSec - (free - EARLY_WARN_MIN * 60) > STALE_SEC) return null;
      return { tag: ALERT_TAG, title: `${minsLeft(s)} min left on your free ride`, body: `Start heading for a dock. Dock within ${minsLeft(s)} min to avoid the ${charge} charge.` };
    }
    case "warn": {
      if (s.elapsedSec - (free - WARN_BEFORE_MIN * 60) > STALE_SEC) return null;
      return { tag: ALERT_TAG, title: `${minsLeft(s)} min left on your free ride`, body: `Dock within ${minsLeft(s)} min to avoid the ${charge} charge.` };
    }
    case "limit": {
      if (s.elapsedSec - free > STALE_AFTER_LIMIT_SEC) return null;
      return { tag: ALERT_TAG, title: "Your free time is up", body: `Dock now. Each extra ${plan.blockMinutes} min costs ${charge}.` };
    }
    case "block": {
      if ((s.elapsedSec - free) % block > STALE_AFTER_LIMIT_SEC) return null;
      const started = Math.floor((s.elapsedSec - free) / block) + 1; // the charge that just began counts, even on the exact second
      return { tag: ALERT_TAG, title: `Another ${charge} charge started`, body: `$${started * plan.blockCost} so far. Dock your bike.` };
    }
  }
}

/** The always-current notification while the app is in the background: minutes left, or how far over. */
export function liveNote(s: TimerState, plan: PricingPlan = STUDENT_PLAN): NoteContent {
  if (s.phase === "over") {
    const over = Math.max(1, Math.ceil(-s.remainingSec / 60));
    return { tag: LIVE_TAG, title: `Over the free time by ${over} min`, body: `$${s.cost} so far. Dock now. Updates every minute.` };
  }
  return { tag: LIVE_TAG, title: `${minsLeft(s)} min left free`, body: `Dock before it runs out to avoid the $${plan.blockCost} charge. Updates every minute.` };
}

/** Changes when the live notification's text would change (once a minute). */
export function liveKey(s: TimerState): number {
  return s.phase === "over" ? -Math.max(1, Math.ceil(-s.remainingSec / 60)) : Math.max(1, Math.ceil(s.remainingSec / 60));
}
