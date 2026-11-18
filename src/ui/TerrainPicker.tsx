import type { ReactNode } from "react";
import { KINDS } from "../core/bikeways";
import type { RoadPrefs } from "../core/types";

/* Simple top-down road cross-sections, one per bikeway kind, drawn to a shared 56x60 grid. */
const C = {
  grass: "#cfe5a3", walk: "#e4e6ea", road: "#7d838c", lane: "#8f959d", laneGreen: "#9ad0c4",
  path: "#8b9099", buffer: "#c9ccd2", line: "#ffffff", yellow: "#f2c230", post: "#e8590c",
  car: "#394a63", glass: "#a9c1e0", bike: "#1f2933", head: "#f5b342",
};
const Bike = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x={-1.6} y={0} width={3.2} height={15} rx={1.6} fill={C.bike} />
    <rect x={-5} y={4} width={10} height={1.8} rx={0.9} fill={C.bike} />
    <circle cx={0} cy={2} r={2.2} fill={C.head} />
  </g>
);
const Car = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x={-7} y={0} width={14} height={26} rx={4} fill={C.car} />
    <rect x={-5} y={5} width={10} height={6} rx={1.5} fill={C.glass} />
    <rect x={-5} y={17} width={10} height={4} rx={1.5} fill={C.glass} />
  </g>
);
const R = (x: number, w: number, fill: string) => <rect x={x} y={0} width={w} height={60} fill={fill} />;

const ICONS: ReactNode[] = [
  // Shared-use path: grass | path with two-way traffic | grass
  <>{R(0, 10, C.grass)}{R(10, 36, C.path)}{R(46, 10, C.grass)}
    <line x1={28} y1={0} x2={28} y2={60} stroke={C.yellow} strokeWidth={1.4} strokeDasharray="5 4" />
    <Bike x={19} y={24} /><Bike x={37} y={14} /></>,
  // Side path: grass | path | grass gap | road
  <>{R(0, 6, C.grass)}{R(6, 18, C.path)}{R(24, 7, C.grass)}{R(31, 25, C.road)}
    <Bike x={15} y={22} /><Car x={44} y={12} /></>,
  // Separated bike lane: sidewalk | lane | buffer with posts | road
  <>{R(0, 8, C.walk)}{R(8, 14, C.laneGreen)}{R(22, 5, C.buffer)}{R(27, 29, C.road)}
    {[8, 28, 48].map((y) => <circle key={y} cx={24.5} cy={y} r={1.7} fill={C.post} />)}
    <Bike x={15} y={22} /><Car x={42} y={12} /></>,
  // Bike lane (painted or buffered): sidewalk | lane | solid line | road
  <>{R(0, 8, C.walk)}{R(8, 14, C.lane)}{R(22, 34, C.road)}
    <line x1={22} y1={0} x2={22} y2={60} stroke={C.line} strokeWidth={1.6} />
    <Bike x={15} y={22} /><Car x={40} y={12} /></>,
  // Shoulder: grass | paved shoulder | edge line | road
  <>{R(0, 8, C.grass)}{R(8, 11, C.lane)}{R(19, 37, C.road)}
    <line x1={19} y1={0} x2={19} y2={60} stroke={C.line} strokeWidth={1.6} />
    <Bike x={13.5} y={22} /><Car x={38} y={12} /></>,
  // Shared lane: sidewalk | one lane shared by bikes and cars
  <>{R(0, 8, C.walk)}{R(8, 48, C.road)}
    <polyline points="17,22 21,18 25,22" fill="none" stroke={C.line} strokeWidth={1.4} />
    <Bike x={21} y={30} /><Car x={39} y={8} /></>,
];

interface Props {
  prefs: RoadPrefs;
  onChange: (p: RoadPrefs) => void;
}

const N = KINDS.length;
const THUMB = 20;

/** Roadway drawings with the "how close to traffic" slider built into the separation bar below them. */
export function TerrainPicker({ prefs, onChange }: Props) {
  const level = prefs.traffic;
  const ok = KINDS.slice(0, level + 1).map((k) => k.label.toLowerCase());
  const no = KINDS.slice(level + 1).map((k) => k.label.toLowerCase());
  const set = (traffic: number) => onChange({ ...prefs, traffic });

  return (
    <div className="terrain">
      <div className="cols">
        {KINDS.map((k, i) => (
          <button
            type="button"
            key={k.id}
            className={`col${i > level ? " off" : ""}`}
            onClick={() => set(i)}
            title={`Allow up to: ${k.label}`}
            aria-label={k.label}
          >
            <span className="icon" style={{ borderBottomColor: k.color }}>
              <svg viewBox="0 0 56 60" aria-hidden="true">{ICONS[i]}</svg>
            </span>
            <span className="name">{k.label}</span>
          </button>
        ))}
      </div>

      <div className="sep-head"><b>+</b><span>Separation from traffic</span><b>&minus;</b></div>
      <div className="sep">
        <div className="cells">
          {KINDS.map((k, i) => (
            <span key={k.id} style={{ background: k.color, opacity: i > level ? 0.28 : 1 }} />
          ))}
        </div>
        <input
          type="range"
          className="traffic"
          min={0}
          max={N - 1}
          step={1}
          value={level}
          onChange={(e) => set(+e.target.value)}
          aria-label="Closest to traffic I'm willing to ride"
          aria-valuetext={KINDS[level].label}
          style={{ left: `calc(100% / ${2 * N} - ${THUMB / 2}px)`, width: `calc(100% * ${N - 1} / ${N} + ${THUMB}px)` }}
        />
      </div>
      <p className="hint">
        Fine with: {ok.join(", ")}.{no.length ? ` ${prefs.strict ? "Never using" : "Steering away from"}: ${no.join(", ")}.` : " No limit: any road."}
      </p>

      {level < N - 1 && (
        <label className="check strict">
          <input type="checkbox" checked={prefs.strict} onChange={(e) => onChange({ ...prefs, strict: e.target.checked })} />
          <span>Hard block: never use {no.join(", ")}. Re-routes around them, and drops routes that can't (stretches under about 60 m, like crossings, are allowed).</span>
        </label>
      )}

    </div>
  );
}
