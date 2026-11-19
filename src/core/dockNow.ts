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

/** Backups are only offered this close to the planned dock, so they're still on the way. */
export const BACKUP_RADIUS_M = 500;

export interface Backups { pickup: DockChoice | null; dropoff: DockChoice | null }

/**
 * The next-best docks for a trip: another station near the pick-up that has a bike, and one near
 * the drop-off that has a free dock. Docks already used by the plan are never suggested.
 */
export function backupDocks(plan: { stations: Station[] }, stations: Station[], radius = BACKUP_RADIUS_M): Backups {
  const used = new Set(plan.stations.map((s) => s.id));
  const best = (anchor: Station, ok: (s: Station) => boolean): DockChoice | null => {
    let out: DockChoice | null = null;
    for (const s of stations) {
      if (used.has(s.id) || !ok(s)) continue;
      const meters = haversine(anchor, s);
      if (meters <= radius && (!out || meters < out.meters)) out = { station: s, meters };
    }
    return out;
  };
  const first = plan.stations[0];
  const last = plan.stations[plan.stations.length - 1];
  if (!first || !last) return { pickup: null, dropoff: null };
  return {
    pickup: best(first, (s) => s.isRenting && s.bikesAvailable > 0),
    dropoff: best(last, canDock),
  };
}
