// Anonymous usage counts for the dashboard (/analytics; USAGE in core/usageConfig.ts, worker/).
//
// Sent: "the app was opened"; "the app is open", once per USAGE.beatMs window while it is visible; a few
// feature uses (USAGE.events); and with a device's first open of the day, the number of days since its
// previous active day plus its kind of device and whether it runs from the Home Screen. No identifier, location
// or anything else that could tell devices apart: the device keeps only its last active day and check-in
// window. Nothing is sent with Do Not Track or Global Privacy Control on, from automated browsers, or where
// site storage is blocked (a device couldn't tell a new day from a repeat there).
import { useEffect } from "react";
import { USAGE } from "../core/usageConfig";
import { dayKey, firstOfDay, parseUsageMemory, windowOf, type UsageMemory } from "../core/usage";
import type { UsageEvent, UsageFirst, UsagePlatform, UsageRequest } from "../core/usageTypes";

const STORAGE_KEY = "badgergo.usage";
const ENDPOINT = "/api/usage";

export function usageCountingOn(): boolean {
  if (typeof navigator === "undefined") return false;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return !n.webdriver && n.globalPrivacyControl !== true && n.doNotTrack !== "1";
}

export function platform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints, nav = navigator.platform): UsagePlatform {
  if (/iPad|iPhone|iPod/.test(ua) || (nav === "MacIntel" && touchPoints > 1)) return "ios"; // iPadOS reports itself as a Mac
  return /Android/.test(ua) ? "android" : "desktop";
}

/** Running as the web app installed on the home screen. */
export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function memory(): UsageMemory | null {
  try {
    return parseUsageMemory(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

function remember(m: UsageMemory): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
    return true;
  } catch {
    return false;
  }
}

const send = (req: UsageRequest): Promise<void> =>
  fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), keepalive: true }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
  });

/** Reports an open or a check-in; the day's first (and its gap) only once the server has it. */
export function reportCheckIn(kind: "open" | "beat"): void {
  const now = Date.now();
  const today = dayKey(now, USAGE.timeZone);
  const m = memory();
  // Claims the window first, so this device's other tabs skip it. No storage, no report (see above).
  if (!m || !remember({ ...m, window: windowOf(now, USAGE.beatMs) })) return;
  const f = firstOfDay(m, today, USAGE.maxGapDays);
  const first: UsageFirst | null = f ? { gap: f.gap, platform: platform(), installed: isStandalone() } : null;
  send({ kind, first }).then(
    () => {
      const latest = memory();
      if (f && latest) remember({ ...latest, day: today });
    },
    () => {}, // offline: the day's first goes with the next report
  );
}

/** Whether this device hasn't checked in during the current window (another of its tabs may have). */
export const shouldBeat = (): boolean => memory()?.window !== windowOf(Date.now(), USAGE.beatMs);

/** Counts one use of a feature. */
export function countUse(name: UsageEvent): void {
  if (usageCountingOn()) send({ kind: "event", name }).catch(() => {});
}

/** One per page load (React's development double-run of effects must not count two). */
let opened = false;

/** Test hook. */
export function resetUsageCounting(): void {
  opened = false;
}

/** Mounted once (App): the open, and the check-ins while the app is visible. */
export function useUsageCounts(): void {
  useEffect(() => {
    if (!usageCountingOn()) return;
    if (!opened) {
      opened = true;
      reportCheckIn("open");
    }
    // While visible: a check-in at the start of each window, and on coming back to the app in a new one.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const beat = () => {
      if (document.visibilityState === "visible" && shouldBeat()) reportCheckIn("beat");
    };
    const schedule = () => {
      clearTimeout(timer);
      const now = Date.now();
      const next = (windowOf(now, USAGE.beatMs) + 1) * USAGE.beatMs + Math.random() * USAGE.beatJitterMs;
      timer = setTimeout(() => { beat(); schedule(); }, next - now);
    };
    schedule();
    document.addEventListener("visibilitychange", beat);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", beat); };
  }, []);
}
