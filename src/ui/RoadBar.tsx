import { KINDS } from "../core/bikeways";
import type { RoadBreakdown } from "../core/types";

/** Stacked bar of what a route runs on, in the same colors as the map. */
export function RoadBar({ b }: { b: RoadBreakdown }) {
  if (!b.totalM) return null;
  const pct = (m: number) => Math.round((m / b.totalM) * 100);
  return (
    <div className="roadbar">
      <div className="bar" role="img" aria-label="Road types used by this route">
        {KINDS.map((k, i) =>
          b.byKind[i] > 0 ? (
            <span key={k.id} style={{ width: `${(b.byKind[i] / b.totalM) * 100}%`, background: k.color }} title={k.label} />
          ) : null,
        )}
      </div>
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
