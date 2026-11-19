import { haversine } from "./geo";
import type { LatLng, Station } from "./types";

/** A dock the rider can put a bike back in right now. */
export const canDock = (s: Station) => s.isReturning && s.docksAvailable > 0;

export interface DockChoice { station: Station; meters: number }

/** The closest stations to `from` that have a free dock, nearest first. */
export function nearestOpenDocks(from: LatLng, stations: Station[], opts: { limit?: number; excludeId?: string } = {}): DockChoice[] {
  const { limit = 3, excludeId } = opts;
  return stations
    .filter((s) => s.id !== excludeId && canDock(s))
    .map((station) => ({ station, meters: haversine(from, station) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

export interface FullWarning {
  /** The dock the rider is heading for, as the live data has it. */
  station: Station;
  /** Free docks near it, nearest first. */
  alternatives: DockChoice[];
}

/** If the dock a ride is heading for has no free docks (or isn't accepting returns), say so and offer the closest ones. */
export function fullWarning(dockId: string | undefined, stations: Station[]): FullWarning | null {
  if (!dockId) return null;
  const station = stations.find((s) => s.id === dockId);
  if (!station || canDock(station)) return null;
  return { station, alternatives: nearestOpenDocks(station, stations, { limit: 2, excludeId: station.id }) };
}

/** Why a dock can't take a bike, in a few words. */
export const fullReason = (s: Station) => (!s.isReturning ? "isn't taking returns" : "has no free docks");
