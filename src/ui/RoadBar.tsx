import { KINDS } from "../core/bikeways";
import type { RoadBreakdown } from "../core/types";

/** What a route runs on, as colored percentages matching the map. */
export function RoadBar({ b }: { b: RoadBreakdown }) {
  if (!b.totalM) return null;
  const pct = (m: number) => Math.round((m / b.totalM) * 100);
  return (
    <div className="roadbar">
      <div className="legend">
        {KINDS.map((k, i) =>
          pct(b.byKind[i]) > 0 ? (
            <span key={k.id}><i style={{ background: k.color }} />{pct(b.byKind[i])}% {k.label.toLowerCase()}</span>
          ) : null,
        )}
        {b.unpavedM > 0 && <span className="warn">⚠ {pct(b.unpavedM)}% unpaved (dashed on the map)</span>}
      </div>
    </div>
  );
}
