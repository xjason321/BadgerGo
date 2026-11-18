/** Change these to point the app at another BCycle city. */
export const SYSTEM_ID = "bcycle_madison";
export const MAP_CENTER: [number, number] = [43.0731, -89.4012];
/** [west, south, east, north] used to bias geocoding toward the service area. */
export const SEARCH_VIEWBOX: [number, number, number, number] = [-89.6, 42.98, -89.2, 43.18];

/**
 * OpenStreetMap relation for the city limits drawn on the map (everything outside is dimmed).
 * "R" + the relation id; find yours at https://nominatim.openstreetmap.org. Empty = no boundary.
 */
export const BOUNDARY_OSM_ID = "R3352040"; // City of Madison, WI

/**
 * Valhalla router. Defaults to the free public server, which is rate-limited and may block you.
 * To use your own (see deploy/README.md), set VITE_VALHALLA_URL in .env.local, e.g. http://203.0.113.7
 */
export const VALHALLA_URL: string =
  (import.meta.env.VITE_VALHALLA_URL as string | undefined)?.replace(/\/+$/, "") || "https://valhalla1.openstreetmap.de";

/** Typical cruising speed on a BCycle bike, used by the router to estimate ride times. */
export const RIDE_SPEED_KPH = 15;
/** Minutes allowed for docking and re-renting a bike at a swap stop. */
export const SWAP_MINUTES = 2;

