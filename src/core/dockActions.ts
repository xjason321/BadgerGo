import { haversine } from "./geo";
import type { Station } from "./types";

/** What a rider can do with a dock from the map. */
export type DockAction = "start" | "end" | "pickup" | "swap" | "dropoff" | "remove";

export interface DockActionItem { action: DockAction; label: string }

/**
 * The buttons offered for a dock. With a bike route on screen they edit that route (pick up, swap, drop off, remove);
 * without one, they set the start or end of the trip.
 */
export function dockActionsFor(chainIds: string[] | null, id: string): DockActionItem[] {
  if (!chainIds || chainIds.length < 2) {
    return [
      { action: "start", label: "Start here" },
      { action: "end", label: "End here" },
    ];
  }
  const i = chainIds.indexOf(id);
  const last = chainIds.length - 1;
  const out: DockActionItem[] = [];
  if (i !== 0) out.push({ action: "pickup", label: "Pick up here" });
  if (i < 0) out.push({ action: "swap", label: "Swap here" });
  if (i > 0 && i < last) out.push({ action: "remove", label: "Remove stop" });
  if (i !== last) out.push({ action: "dropoff", label: "Drop off here" });
  return out;
}

/** Apply an edit to a route's docks (pick-up, swaps..., drop-off). Returns the new list, or null when nothing would change. */
export function editChain(chain: Station[], s: Station, action: DockAction): Station[] | null {
  const n = chain.length;
  if (n < 2) return null;
  const at = chain.findIndex((x) => x.id === s.id);
  let next: Station[] | null = null;
  if (action === "pickup" && at !== 0) next = [s, ...chain.slice(1).filter((x) => x.id !== s.id)];
  else if (action === "dropoff" && at !== n - 1) next = [...chain.slice(0, -1).filter((x) => x.id !== s.id), s];
  else if (action === "remove" && at > 0 && at < n - 1) next = chain.filter((_, i) => i !== at);
  else if (action === "swap" && at < 0) {
    // Put the new stop where it adds the least distance to the route.
    let best = 1;
    let bestExtra = Infinity;
    for (let i = 1; i < n; i++) {
      const extra = haversine(chain[i - 1], s) + haversine(s, chain[i]) - haversine(chain[i - 1], chain[i]);
      if (extra < bestExtra) { bestExtra = extra; best = i; }
    }
    next = [...chain.slice(0, best), s, ...chain.slice(best)];
  }
  return next && next.length >= 2 ? next : null;
}
