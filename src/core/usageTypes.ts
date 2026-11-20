import type { USAGE } from "./usageConfig";

/** Something the app counts (USAGE.events). */
export type UsageEvent = (typeof USAGE.events)[number];
export type UsagePlatform = "ios" | "android" | "desktop";

/**
 * Sent with a device's first open or check-in of the day (USAGE.timeZone): how many days since its previous
 * active day (null: never seen before), and coarse context. No identifier.
 */
export interface UsageFirst {
  gap: number | null;
  platform: UsagePlatform;
  /** Running as the web app installed on the home screen (not a browser tab). */
  installed: boolean;
}

/** POST /api/usage: anonymous usage counts. */
export type UsageRequest =
  /** The app was opened (a page load); also a check-in for the current window. */
  | { kind: "open"; first: UsageFirst | null }
  /** The app is open (visible) in a new USAGE.beatMs window. */
  | { kind: "beat"; first: UsageFirst | null }
  | { kind: "event"; name: UsageEvent };

/** One day of the dashboard (USAGE.timeZone). */
export interface StatsDay {
  /** YYYY-MM-DD */
  day: string;
  /** Unique devices active that day, and in the 7 / 30 / 90 days ending that day. */
  users: number;
  users7: number;
  users30: number;
  users90: number;
  newUsers: number;
  /** App opens (page loads). */
  opens: number;
  /** Most devices with the app open in one USAGE.beatMs window. */
  peakActive: number;
  /** Check-ins by hour of day (each is one device with the app open in one window). */
  beats: number[];
  counts: Partial<Record<UsageEvent, number>>;
  /** Daily unique devices by kind of device, and how many ran as the Home Screen web app. */
  platforms: Partial<Record<UsagePlatform, number>>;
  installed: number;
}

/** GET /api/analytics?days=N: the dashboard at /analytics (anonymous totals; cached briefly). */
export interface StatsResponse {
  timeZone: string;
  generatedAtMs: number;
  /** Devices that checked in during the current or the previous USAGE.beatMs window. */
  activeNow: number;
  /** Unique devices since counting began. */
  allTimeUsers: number;
  /** The first day with any counts (null: none yet). */
  since: string | null;
  /** Oldest first, ending today. */
  days: StatsDay[];
}
