import { useEffect, useState } from "react";
import { KINDS } from "../core/bikeways";
import { fetchProfile, planParts, type Profile } from "../core/elevation";
import type { Plan } from "../core/types";

const FT = 3.28084;
const MI = 1609.34;
const W = 300, LEFT = 34, RIGHT = 8, TOP = 8, PLOT_B = 72, STRIP_Y = 86, H = 112;

/** A "nice" tick spacing in miles that gives about 3 to 5 ticks across the trip. */
function tickStep(miles: number) {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10]) if (miles / s <= 5) return s;
  return 20;
}

/** Elevation along the trip (distance across, height up) with the path's type drawn beneath it. */
export function ElevationProfile({ plan }: { plan: Plan }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setProfile(undefined);
    fetchProfile(planParts(plan)).then((p) => { if (live) setProfile(p); });
    return () => { live = false; };
  }, [plan]);

  if (profile === null) return null; // the router has no elevation data: just leave the plot out
  if (profile === undefined) return <div className="elev elev-skel" aria-hidden="true" />;

  const miles = profile.totalM / MI;
  // Keep a flat trip looking flat: never zoom into less than about 40 ft of height.
  const span = Math.max((profile.maxH - profile.minH) * FT, 40);
  const mid = ((profile.maxH + profile.minH) / 2) * FT;
  const lo = mid - span * 0.55, hi = mid + span * 0.55;
  const x = (m: number) => LEFT + (m / profile.totalM) * (W - LEFT - RIGHT);
  const y = (hMetres: number) => PLOT_B - ((hMetres * FT - lo) / (hi - lo)) * (PLOT_B - TOP);
  const line = profile.pts.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)} ${y(p.h).toFixed(1)}`).join(" ");
  const area = `${line} L${x(profile.pts[profile.pts.length - 1].d).toFixed(1)} ${PLOT_B} L${x(profile.pts[0].d).toFixed(1)} ${PLOT_B} Z`;
  const step = tickStep(miles);
  const ticks: number[] = [];
  for (let t = 0; t <= miles + 1e-6; t += step) ticks.push(t);
  const grid = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const ft = (v: number) => Math.round(v);

  return (
    <div className="elev">
      <div className="elev-head">
        <b>Elevation</b>
        <span>▲ {ft(profile.gainM * FT)} ft · ▼ {ft(profile.lossM * FT)} ft</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Elevation profile: ${ft(profile.gainM * FT)} feet of climb over ${miles.toFixed(1)} miles`}>
        {grid.map((g, i) => (
          <g key={i}>
            <line className="elev-grid" x1={LEFT} x2={W - RIGHT} y1={PLOT_B - ((g - lo) / (hi - lo)) * (PLOT_B - TOP)} y2={PLOT_B - ((g - lo) / (hi - lo)) * (PLOT_B - TOP)} />
            <text className="elev-tick" x={LEFT - 5} y={PLOT_B - ((g - lo) / (hi - lo)) * (PLOT_B - TOP) + 3} textAnchor="end">{ft(g)}</text>
          </g>
        ))}
        <text className="elev-unit" x={2} y={TOP + 2}>ft</text>
        <path className="elev-area" d={area} />
        <path className="elev-line" d={line} />
        {profile.parts.map((p, i) =>
          p.mode === "walk" ? (
            <line key={i} className="elev-walk" x1={x(p.from) + 2} x2={x(p.to) - 2} y1={STRIP_Y} y2={STRIP_Y} />
          ) : (
            <line
              key={i}
              x1={x(p.from)}
              x2={x(p.to)}
              y1={STRIP_Y}
              y2={STRIP_Y}
              stroke={p.kind == null ? "#1a73e8" : KINDS[p.kind].color}
              strokeWidth={6}
              strokeDasharray={p.unpaved ? "7 6" : undefined}
            />
          ),
        )}
        {ticks.map((t) => (
          <text key={t} className="elev-tick" x={x(t * MI)} y={H - 3} textAnchor={t === 0 ? "start" : "middle"}>
            {t === 0 ? "0 mi" : `${+t.toFixed(2)}`}
          </text>
        ))}
      </svg>
    </div>
  );
}
