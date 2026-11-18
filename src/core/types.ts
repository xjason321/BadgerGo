export interface LatLng { lat: number; lon: number }

export interface Station extends LatLng {
  id: string;
  name: string;
  address?: string;
  bikesAvailable: number;
  docksAvailable: number;
  isRenting: boolean;
  isReturning: boolean;
  /** Deep links into the BCycle app from the GBFS feed, if provided. */
  rentalUris?: { android?: string; ios?: string };
}

export interface Place extends LatLng { label: string }

/** One routed segment (walking or riding). Geometry is [lat, lon] pairs. */
export interface Segment {
  mode: "walk" | "bike";
  durationMin: number;
  distanceM: number;
  geometry: [number, number][];
  /** Encoded polyline6 as returned by Valhalla (used to look up road types). */
  shape?: string;
  /** A short stretch walked with the bike before / after the ride (e.g. to skip a one-way loop). Its time is included in `durationMin`. */
  walkBefore?: Segment;
  walkAfter?: Segment;
}

/**
 * A full suggestion: walk -> ride -> (dock, re-rent, ride)* -> walk.
 * Docking a bike ends the trip and the ride clock, so every ride is timed on its own.
 */
export interface Plan {
  id: string;
  /** Docks in order: pick-up, any docks to swap at, drop-off. */
  stations: Station[];
  walkToDock: Segment;
  /** One per hop between consecutive docks (stations.length - 1). */
  rides: Segment[];
  walkFromDock: Segment;
  /** Total time on bikes (sum of rides). */
  rideMinutes: number;
  /** The longest single ride, the number the max-ride limit and pricing apply to. */
  longestRideMinutes: number;
  /** Time allowed for docking and re-renting at each swap. */
  swapMinutes: number;
  overageCost: number;
  /** True when every ride is within the limit. */
  withinLimit: boolean;
  totalMinutes: number;
  /** Time on bikes for the direct pick-up to drop-off ride (null if unknown). */
  directRideMinutes: number | null;
  /** Extra time compared with riding straight from the first to last dock (rides + swaps). */
  detourMinutes: number;
  label: string;
  /** A walk-only option: no docks, no rides. Ignores the ride limit and terrain preferences. */
  walkOnly?: boolean;
  /** Road types along the rides. Filled in after planning when the router supports it. */
  roads?: PlanRoads;
}

/** Road-type preferences. All are soft: they steer the router, they don't hard-block roads. */
export interface RoadPrefs {
  /**
   * The least traffic-separated bikeway you'll accept, as an index into KINDS
   * (0 = shared-use paths only ... 5 = any road, shared lanes included).
   */
  traffic: number;
  /** true: never use bikeways less separated than `traffic` (rides are re-routed around them or the plan is dropped). */
  strict: boolean;
  /** avoid: stay on paved surfaces. ok: gravel/dirt is fine. */
  unpaved: "avoid" | "ok";
  /** avoid: detour around climbs. normal. ok: don't care. */
  hills: "avoid" | "normal" | "ok";
}

export const DEFAULT_PREFS: RoadPrefs = { traffic: 3, strict: false, unpaved: "avoid", hills: "normal" };

/** What a route runs on, in metres. `byKind` is indexed like KINDS in bikeways.ts. */
export interface RoadBreakdown {
  totalM: number;
  byKind: number[];
  /** Metres on unpaved surfaces (gravel, dirt, compacted), counted on top of `byKind`. */
  unpavedM: number;
}

/** A stretch of one ride on one kind of way, for coloring the map. Geometry is [lat, lon] pairs. */
export interface RoadSegment {
  kind: number;
  unpaved: boolean;
  geometry: [number, number][];
}

export interface RideRoads {
  breakdown: RoadBreakdown;
  segments: RoadSegment[];
}

export interface PlanRoads {
  breakdown: RoadBreakdown;
  /** One per ride in `Plan.rides`. */
  rides: RideRoads[];
}

export interface PricingPlan {
  /** Minutes included per ride before charges start. */
  freeMinutes: number;
  /** Block size for each extra charge, in minutes. */
  blockMinutes: number;
  /** Cost per extra block (or part of one). */
  blockCost: number;
}

export const STUDENT_PLAN: PricingPlan = { freeMinutes: 30, blockMinutes: 30, blockCost: 8 };
