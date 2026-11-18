/**
 * Bikeway types, ordered from most to least separated from traffic. A route is classified edge by
 * edge into these. Buffered lanes can't be told apart from painted ones in OpenStreetMap-derived
 * routing data, so they count as "Bike lane".
 */
export interface BikewayKind {
  id: string;
  label: string;
  color: string;
}

export const KINDS: BikewayKind[] = [
  { id: "path", label: "Shared-use path", color: "#0b6e4f" },
  { id: "sidepath", label: "Side path", color: "#5aa469" },
  { id: "separated", label: "Separated bike lane", color: "#00a5a5" },
  { id: "lane", label: "Bike lane", color: "#2f6fed" },
  { id: "shoulder", label: "Shoulder", color: "#e9a100" },
  { id: "shared", label: "Shared lane", color: "#c2410c" },
];

export interface TraceEdge {
  length?: number; // km
  use?: string;
  surface?: string;
  cycle_lane?: string;
  shoulder?: boolean;
  begin_shape_index?: number;
  end_shape_index?: number;
}

const PATH_USES = new Set(["cycleway", "mountain_bike", "footway", "pedestrian", "bridleway", "track", "steps", "path"]);
/** Tiny connector edges: count them as whatever the route was on just before. */
const CONNECTOR_USES = new Set(["pedestrian_crossing", "turn_channel", "ramp", "rest_area", "elevator", "escalator"]);
const UNPAVED = new Set(["compacted", "dirt", "gravel", "path", "impassable"]);

export const isUnpaved = (e: TraceEdge) => !!e.surface && UNPAVED.has(e.surface);

/** Index into KINDS for one edge. `prev` is the previous edge's kind (for connectors). */
export function classifyEdge(e: TraceEdge, prev: number): number {
  if (e.use && CONNECTOR_USES.has(e.use)) return prev;
  if (e.use && PATH_USES.has(e.use)) return 0;
  if (e.use === "sidewalk") return 1;
  if (e.cycle_lane === "separated") return 2;
  if (e.cycle_lane === "dedicated") return 3;
  if (e.shoulder) return 4;
  return 5;
}
