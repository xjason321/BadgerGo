import type { NavLeg } from "./navLinks";

export interface Cue { text: string; pattern: number[] }

const KEY = "badgergo.cues";

/** "1 minute", "6 minutes", "1 hour 5 minutes". */
export function minutesText(min: number): string {
  const m = Math.max(1, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return h ? (r ? `${part(h, "hour")} ${part(r, "minute")}` : part(h, "hour")) : part(m, "minute");
}

/** What to say and buzz when the rider moves onto leg `index` (or finishes the trip). */
export function cueFor(legs: NavLeg[], index: number): Cue | null {
  if (!legs.length) return null;
  if (index >= legs.length) return { text: "You've arrived. Enjoy!", pattern: [200, 100, 200, 100, 400] };
  const leg = legs[Math.max(0, index)];
  const t = minutesText(leg.minutes);
  if (leg.kind === "walk") return { text: `Walk ${t} to ${leg.toName}.`, pattern: [120] };
  const tail = !leg.atStop ? "" : leg.swap ? " Dock your bike there, then rent another." : " Dock your bike at the end.";
  return { text: `Ride ${t} ${leg.atStop ? "to" : "toward"} ${leg.toName}.${tail}`, pattern: [120, 80, 120] };
}

/** Cues are on unless the rider turned them off. */
export function readCues(store: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): boolean {
  try { return store?.getItem(KEY) !== "off"; } catch { return true; }
}
export function writeCues(on: boolean, store: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  try { store?.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
}
