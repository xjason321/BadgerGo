import { SYSTEM_ID } from "../config";
import type { Station } from "./types";

/**
 * Link that opens a dock in the BCycle app (or its web fallback). Uses the feed's own link when it
 * has one; otherwise builds the same URL. `ios` picks the iOS variant, anything else Android.
 */
export function bcycleUrl(s: Pick<Station, "id" | "rentalUris">, ios: boolean, systemId = SYSTEM_ID): string {
  const given = ios ? s.rentalUris?.ios : s.rentalUris?.android;
  if (given) return given;
  const q = new URLSearchParams({ system_id: systemId, station_id: s.id, platform: ios ? "iOS" : "android" });
  return `https://www.bcycle.com/applink?${q}`;
}

export const isIos = (ua = typeof navigator === "undefined" ? "" : navigator.userAgent) => /iPad|iPhone|iPod/.test(ua);
