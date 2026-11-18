import L from "leaflet";
import type { Ring } from "../core/dockStatus";
import { RING_COLORS } from "../core/dockStatus";

/**
 * BCycle-style dock marker: white "B" on black, in a ring that carries the status. A status ring
 * is one solid color; a fill ring is a vertical gauge, blue from the bottom up to the share of
 * bikes, white above.
 */
export function dockSvg(ring: Ring, size: number): string {
  const id = ring.kind === "fill" ? `f${Math.round(ring.ratio * 20)}` : "";
  const defs =
    ring.kind === "fill"
      ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="${1 - ring.ratio}" stop-color="#fff"/><stop offset="${1 - ring.ratio}" stop-color="${RING_COLORS.fill}"/></linearGradient></defs>`
      : "";
  const fill = ring.kind === "fill" ? `url(#${id})` : ring.color;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">` +
    defs +
    `<circle cx="20" cy="20" r="19" fill="${fill}" stroke="#0f172a" stroke-opacity=".45" stroke-width="1.2"/>` +
    `<circle cx="20" cy="20" r="13.5" fill="#0a0a0a"/>` +
    `<text x="20" y="26.6" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="19" fill="#fff">B</text>` +
    `</svg>`
  );
}

export const dockIcon = (ring: Ring, size: number) =>
  L.divIcon({
    className: "dock-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: dockSvg(ring, size),
  });

/** Bigger as you zoom in, so docks stay tappable up close and don't pile up when zoomed out. */
export const dockSize = (zoom: number) => (zoom >= 16 ? 36 : zoom >= 15 ? 32 : zoom >= 14 ? 28 : zoom >= 13 ? 24 : 18);
