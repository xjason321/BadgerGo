// How anonymous usage is counted (see src/ui/usage.ts for what the app sends and worker/usageCore.ts for how it is
// counted). Pure constants, shared by the app, the Worker and the dashboard.
export const USAGE = {
  /** Days and hours are counted in this time zone. */
  timeZone: "America/Chicago",
  /** While the app is visible, a device checks in once per window ("active now", activity by hour). */
  beatMs: 5 * 60_000,
  /** Up to 10 s after a window starts, so devices don't all check in at the same instant. */
  beatJitterMs: 10_000,
  /** Gaps between a device's active days are told apart up to this many days (unique users up to 90 days). */
  maxGapDays: 90,
  /** Day records the server keeps; older ones are deleted (the all-time total is kept separately). */
  keepDays: 460,
  /** Most days the dashboard can show (each needs `maxGapDays` before it for its 90-day count). */
  maxReportDays: 365,
  /** What the app counts (each once per use). */
  events: ["route_search", "ride_start", "share", "shared_open", "edit_route", "timer_start", "alerts_on", "nearest_bike", "nearest_dock"],
  /** The most bytes the Worker reads from a report. */
  maxBodyBytes: 2048,
  /** Pages allowed to report (browsers always send Origin on a POST). */
  origins: ["https://badgergo.app", "http://localhost:5173", "http://localhost:4173"],
} as const;
