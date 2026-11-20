import type { LatLng, Segment, Station } from "./types";

/** The id of the stand-in "dock" used as a route's start when the rider is already on a bike. */
export const MY_BIKE_ID = "my-bike";

/** A stand-in start for riders who already have a bike: your own location, where the first ride begins. */
export function myBikeStation(at: LatLng): Station {
  return { id: MY_BIKE_ID, name: "Your bike", lat: at.lat, lon: at.lon, bikesAvailable: 1, docksAvailable: 0, isRenting: true, isReturning: false };
}

export const isMyBike = (s: { id: string } | undefined): boolean => s?.id === MY_BIKE_ID;

/** True when a plan's first ride starts from where the rider is (no pick-up dock). */
export const startsOnBike = (plan: { stations: { id: string }[] }): boolean => isMyBike(plan.stations[0]);

/** No walk at all (used before the first ride when you're already on a bike). */
export const NO_WALK: Segment = { mode: "walk", durationMin: 0, distanceM: 0, geometry: [] };
