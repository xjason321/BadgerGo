import { haversine } from "./geo";
import type { LatLng, Plan } from "./types";

/** One stretch of the trip to follow: walk to a dock, ride to a dock, or walk to the destination. */
export interface Leg {
  kind: "walk" | "ride";
  /** Where the leg ends (a dock, or the destination). */
  to: LatLng;
  toName: string;
  minutes: number;
  meters: number;
  /** Docking a bike here to swap onto another one. */
  swap?: boolean;
  /** Last leg of the trip. */
  final?: boolean;
}

/** Within this many metres of a leg's end counts as arriving. */
export const ARRIVE_M = 40;

const lastPoint = (g: [number, number][]): LatLng | null => (g.length ? { lat: g[g.length - 1][0], lon: g[g.length - 1][1] } : null);

/** The plan as an ordered list of legs to follow. */
export function buildLegs(plan: Plan, destination: LatLng, destinationName = "your destination"): Leg[] {
  const legs: Leg[] = [];
  if (plan.walkOnly) {
    legs.push({ kind: "walk", to: destination, toName: destinationName, minutes: plan.walkToDock.durationMin, meters: plan.walkToDock.distanceM, final: true });
    return legs;
  }
  const st = plan.stations;
  if (plan.walkToDock.geometry.length)
    legs.push({ kind: "walk", to: st[0], toName: st[0].name, minutes: plan.walkToDock.durationMin, meters: plan.walkToDock.distanceM });
  plan.rides.forEach((r, j) => {
    const dock = st[j + 1];
    legs.push({ kind: "ride", to: dock, toName: dock.name, minutes: r.durationMin, meters: r.distanceM, swap: j < plan.rides.length - 1 });
  });
  const end = lastPoint(plan.walkFromDock.geometry);
  if (end) legs.push({ kind: "walk", to: destination, toName: destinationName, minutes: plan.walkFromDock.durationMin, meters: plan.walkFromDock.distanceM, final: true });
  else if (legs.length) legs[legs.length - 1].final = true;
  return legs;
}

/** The leg to show after this location fix. At most one leg is passed per fix. `legs.length` means finished. */
export function advanceLeg(legs: Leg[], index: number, pos: LatLng): number {
  if (index >= legs.length) return index;
  return haversine(pos, legs[index].to) <= ARRIVE_M ? index + 1 : index;
}

/** "350 ft" under about a tenth of a mile, otherwise "0.4 mi". */
export function formatDistance(m: number): string {
  const ft = m * 3.28084;
  return ft < 528 ? `${Math.max(10, Math.round(ft / 10) * 10)} ft` : `${(m / 1609.34).toFixed(1)} mi`;
}
