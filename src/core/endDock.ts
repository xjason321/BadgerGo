// The dock a rider is heading for: what its notification says about open docks and bikes, and when to warn that
// it is getting risky. Pure (no browser, no Cloudflare), so the app and the stats Worker agree.
import { levelOf, type Level } from "./dockStatus";
import type { NoteContent } from "./timerNotify";

/** Its own tag, so a warning about the dock doesn't replace the timer's notification. */
export const DOCK_TAG = "badgergo-timer-dock";

export interface EndDock { id: string; name: string }
/** What a rider can actually use there: no bikes to take at a dock that isn't renting, no docks at one that isn't taking returns. */
export interface DockCounts { bikes: number; docks: number }

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const flagged = (v: unknown) => v === undefined || v === 1 || v === true;

export const countsOf = (s: { bikesAvailable: number; docksAvailable: number; isRenting: boolean; isReturning: boolean }): DockCounts => ({
  bikes: s.isRenting ? s.bikesAvailable : 0,
  docks: s.isReturning ? s.docksAvailable : 0,
});

/** One station's numbers from BCycle's station_status.json (GBFS), or null when the feed isn't what we expect. */
export function countsFromStatus(feed: unknown, id: string): DockCounts | null {
  const list = (feed as { data?: { stations?: unknown } } | null)?.data?.stations;
  if (!Array.isArray(list)) return null;
  const s = list.find((x): x is Record<string, unknown> => !!x && typeof x === "object" && (x as { station_id?: unknown }).station_id === id);
  if (!s) return null;
  return { bikes: flagged(s.is_renting) ? count(s.num_bikes_available) : 0, docks: flagged(s.is_returning) ? count(s.num_docks_available) : 0 };
}

/** The app's own verdict: 3 or more open docks is safe; 1 or 2 is "few"; 0 is none. */
export const dockLevel = (c: DockCounts): Level => levelOf(c.docks);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const dockLine = (name: string, c: DockCounts): string => `${name}: ${plural(c.docks, "open dock")}, ${plural(c.bikes, "bike")}`;

/** The dock went from safe to risky. (Already risky when the ride began: no warning, the app showed it then.) */
export const becameRisky = (before: Level | null, now: Level): boolean => before === "ok" && now !== "ok";

export function riskNote(name: string, c: DockCounts): NoteContent {
  return c.docks === 0
    ? { tag: DOCK_TAG, title: `No open docks at ${name}`, body: "Pick another dock before you get there. Open BadgerGo to see the closest ones." }
    : { tag: DOCK_TAG, title: `Only ${plural(c.docks, "open dock")} left at ${name}`, body: "Returning there is risky. Open BadgerGo to see other docks nearby." };
}
