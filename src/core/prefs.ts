import { RIDE_SPEED_KPH } from "../config";
import type { RoadPrefs } from "./types";

/**
 * How much the router is willing to use roads, by "least separated bikeway I'll accept"
 * (index 0..5, see KINDS). Valhalla: 0 = strongly prefer paths, 1 = take roads freely.
 */
const USE_ROADS = [0, 0.1, 0.25, 0.45, 0.7, 1];

/** Valhalla bicycle costing options for a set of preferences. */
export function bicycleCosting(prefs: RoadPrefs) {
  const level = Math.min(Math.max(Math.round(prefs.traffic), 0), USE_ROADS.length - 1);
  const useHills = { avoid: 0.1, normal: 0.5, ok: 1 }[prefs.hills];
  // 1 = never use bad surfaces, 0 = no penalty.
  const avoidBad = prefs.unpaved === "avoid" ? 1 : 0;
  return {
    bicycle: {
      bicycle_type: "Hybrid",
      cycling_speed: RIDE_SPEED_KPH,
      use_roads: USE_ROADS[level],
      use_living_streets: 0.5,
      use_hills: useHills,
      avoid_bad_surfaces: avoidBad,
    },
  };
}
