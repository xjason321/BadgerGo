import { useEffect, useRef, useState } from "react";
import { levelOf } from "../core/dockStatus";
import { trafficExposure } from "../core/planner";
import { overageCost } from "../core/pricing";
import { STUDENT_PLAN, type Plan, type Station } from "../core/types";
import { AlertIcon, BikeIcon, CheckIcon, ClockIcon, CloseIcon, DollarIcon, PencilIcon, RouteIcon, SwapIcon, WalkIcon } from "./icons";
import { ElevationProfile } from "./ElevationProfile";
import { RoadBar } from "./RoadBar";

const min = (m: number) => `${Math.max(1, Math.round(m))} min`;
const miles = (m: number) => (m / 1609.34).toFixed(1);

function Pill({ n, noun }: { n: number; noun: "bike" | "open dock" }) {
  return <span className={`pill ${levelOf(n)}`}>{n} {noun}{n === 1 ? "" : "s"}</span>;
}

interface Props {
  plan: Plan;
  index: number;
  selected: boolean;
  trafficLevel: number;
  onSelect: () => void;
  /** Start editing this route's docks (the pencil at the bottom right). */
  onEdit?: () => void;
  /** This is the route being edited: show its stops and the Done / Discard buttons. */
  editing?: boolean;
  onRemoveStop?: (i: number) => void;
  /** The rider dragged the docks into a new order (pick-up first, drop-off last). */
  onReorder?: (stations: Station[]) => void;
  onDone?: () => void;
  onDiscard?: () => void;
  /** The rider grabbed a dock tile: show it on the map. */
  onFocusStation?: (s: Station) => void;
}

/** One route suggestion: headline numbers, then the trip step by step. */
export function PlanCard({ plan: p, index, selected, trafficLevel, onSelect, onEdit, editing, onRemoveStop, onReorder, onDone, onDiscard, onFocusStation }: Props) {
  if (p.walkOnly) return <WalkCard plan={p} index={index} selected={selected} onSelect={onSelect} />;
  if (editing) return <EditCard plan={p} onRemoveStop={onRemoveStop} onReorder={onReorder} onDone={onDone} onDiscard={onDiscard} onFocusStation={onFocusStation} />;
  const swaps = p.stations.length - 2;
  const [name, kind] = p.label.split(" · ");
  const directCost = p.directRideMinutes == null ? 0 : overageCost(p.directRideMinutes, STUDENT_PLAN);
  const saves = swaps > 0 ? directCost - p.overageCost : 0;
  const exposure = trafficExposure(p, trafficLevel);
  const dist = p.rides.reduce((a, r) => a + r.distanceM, 0);

  return (
    <li className={`plan${selected ? " sel" : ""}`} onClick={onSelect}>
      <div className="plan-head">
        <span className="rank">{index + 1}</span>
        <div className="plan-title">
          <b>{name}</b>
          <span>{kind}</span>
        </div>
        {p.withinLimit ? (
          <span className="chip good"><CheckIcon size={14} /> {p.overageCost ? `+$${p.overageCost}` : "Free"}</span>
        ) : (
          <span className="chip bad"><DollarIcon size={14} /> +${p.overageCost} · over limit</span>
        )}
      </div>

      <div className="stats">
        <div><ClockIcon /><b>{min(p.totalMinutes)}</b><span>total</span></div>
        <div>
          <BikeIcon /><b>{min(p.rideMinutes)}</b>
          <span>riding</span>
        </div>
        <div><RouteIcon /><b>{miles(dist)} mi</b><span>distance</span></div>
      </div>

      <ol className="tl">
        <li>
          <span className="node walk"><WalkIcon size={16} /></span>
          <div className="step">
            <span className="what">{min(p.walkToDock.durationMin)} walk</span>
            <span className="to">to {p.stations[0].name}</span>
            <Pill n={p.stations[0].isRenting ? p.stations[0].bikesAvailable : 0} noun="bike" />
          </div>
        </li>
        {p.rides.map((r, j) => {
          const to = p.stations[j + 1];
          const last = j === p.rides.length - 1;
          return (
            <li key={j}>
              <span className="node bike"><BikeIcon size={16} /></span>
              <div className="step">
                <span className="what">{min(r.durationMin)} ride</span>
                <span className="to">{last ? "to" : "swap at"} {to.name}</span>
                {!last && <span className="tag"><SwapIcon size={12} /> Swap</span>}
                <Pill n={to.isReturning ? to.docksAvailable : 0} noun="open dock" />
              </div>
            </li>
          );
        })}
        <li>
          <span className="node walk"><WalkIcon size={16} /></span>
          <div className="step">
            <span className="what">{min(p.walkFromDock.durationMin)} walk</span>
            <span className="to">to your destination</span>
          </div>
        </li>
      </ol>

      <ElevationProfile plan={p} />

      {swaps > 0 && p.id !== "custom" && (
        <div className="note info">
          <SwapIcon size={15} />
          <span>+{Math.round(p.detourMinutes)} min vs riding straight through{saves > 0 ? ` · saves $${saves}` : ""}</span>
        </div>
      )}
      {p.roads && <RoadBar b={p.roads.breakdown} />}
      {exposure &&
        (exposure.m < 50 ? (
          <div className="note good"><CheckIcon size={15} /><span>Stays within your traffic limit</span></div>
        ) : (
          <div className="note bad">
            <AlertIcon size={15} />
            <span>{miles(exposure.m)} mi ({Math.round(exposure.share * 100)}%) closer to traffic than your limit</span>
          </div>
        ))}
      {onEdit && !editing && (
        <button className="edit-pencil" onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label="Edit this route's docks" title="Edit docks">
          <PencilIcon size={18} />
        </button>
      )}
    </li>
  );
}

/** While editing, the card is just the custom route: its three numbers and the docks as draggable tiles with the time between them. */
function EditCard({ plan: p, onRemoveStop, onReorder, onDone, onDiscard, onFocusStation }: Pick<Props, "plan" | "onRemoveStop" | "onReorder" | "onDone" | "onDiscard" | "onFocusStation">) {
  const dist = p.rides.reduce((a, r) => a + r.distanceM, 0);
  return (
    <li className="plan sel edit-card" onClick={(e) => e.stopPropagation()}>
      <div className="plan-head">
        <div className="plan-title">
          <b>Editing route</b>
          <span>Drag to reorder</span>
        </div>
        {p.withinLimit ? (
          <span className="chip good"><CheckIcon size={14} /> {p.overageCost ? `+$${p.overageCost}` : "Free"}</span>
        ) : (
          <span className="chip bad"><DollarIcon size={14} /> +${p.overageCost}</span>
        )}
        <button className="edit-done" onClick={onDone}>Done</button>
      </div>
      <div className="stats">
        <div><ClockIcon /><b>{min(p.totalMinutes)}</b><span>total</span></div>
        <div><BikeIcon /><b>{min(p.rideMinutes)}</b><span>riding</span></div>
        <div><RouteIcon /><b>{miles(dist)} mi</b><span>distance</span></div>
      </div>
      <EditStops plan={p} onRemove={onRemoveStop} onReorder={onReorder} onFocus={onFocusStation} />
      <p className="edit-hint">Select a dock on the map to pick up, swap or drop off there.</p>
      <button className="edit-discard" onClick={onDiscard}>Discard custom route</button>
    </li>
  );
}

const GripIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
  </svg>
);

/** The route's docks as tiles you reorder by dragging the grip (like Google Maps); the time between neighbours sits in the gap. */
function EditStops({ plan, onRemove, onReorder, onFocus }: { plan: Plan; onRemove?: (i: number) => void; onReorder?: (s: Station[]) => void; onFocus?: (s: Station) => void }) {
  const stations = plan.stations;
  const [order, setOrder] = useState<Station[] | null>(null); // the new order, shown until the route has been rebuilt
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; h: number } | null>(null);
  const info = useRef<{ y: number; from: number; h: number } | null>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => setOrder(null), [stations]);
  const list = order ?? stations;
  const last = list.length - 1;
  const stale = order !== null; // times belong to the old order until the rebuild lands

  const down = (e: React.PointerEvent, i: number) => {
    const h = rows.current[i]?.offsetHeight ?? 80;
    info.current = { y: e.clientY, from: i, h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ from: i, to: i, dy: 0, h });
    onFocus?.(list[i]);
  };
  const move = (e: React.PointerEvent) => {
    const d = info.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    const to = Math.max(0, Math.min(list.length - 1, d.from + Math.round(dy / d.h)));
    setDrag({ from: d.from, to, dy, h: d.h });
  };
  const up = () => {
    const d = info.current;
    info.current = null;
    if (!d) return;
    const cur = drag;
    setDrag(null);
    if (!cur || cur.to === cur.from) return;
    const next = [...list];
    const [moved] = next.splice(cur.from, 1);
    next.splice(cur.to, 0, moved);
    setOrder(next);
    onReorder?.(next);
  };
  const shift = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < i && i <= drag.to) return -drag.h;
    if (drag.to <= i && i < drag.from) return drag.h;
    return 0;
  };
  const gapText = (j: number) => (stale ? "…" : `${min(plan.rides[j]?.durationMin ?? 0)} ride`);

  return (
    <ol className="edit-tiles">
      <li className="leg walk"><WalkIcon size={14} /> {min(plan.walkToDock.durationMin)} walk to first dock</li>
      {list.map((s, i) => {
        const long = !stale && i < last && (plan.rides[i]?.durationMin ?? 0) > STUDENT_PLAN.freeMinutes;
        return (
          <li key={s.id} ref={(el) => { rows.current[i] = el; }} className={`slot${drag?.from === i ? " dragging" : ""}`}>
            <div
              className="tile"
              style={{ transform: `translateY(${shift(i)}px)` }}
              onPointerDown={(e) => { if (!(e.target as Element).closest(".rm")) down(e, i); }}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onLostPointerCapture={up}
              role="group"
              aria-label={`${s.name}: drag to reorder`}
            >
              <span className="grip" aria-hidden="true">
                <GripIcon />
              </span>
              <div className="tile-main">
                <span className="role">
                  {i === 0 ? "Pick up" : i === last ? "Drop off" : "Swap"}
                  <span className="avail">{i === 0 ? `${s.isRenting ? s.bikesAvailable : 0} bikes` : `${s.isReturning ? s.docksAvailable : 0} docks`}</span>
                </span>
                <span className="nm">{s.name}</span>
              </div>
              {i > 0 && i < last ? (
                <button className="rm" onClick={() => onRemove?.(i)} aria-label={`Remove ${s.name}`}><CloseIcon size={16} /></button>
              ) : (
                <span className="rm-gap" />
              )}
            </div>
            {i < last && (
              <div className={`leg ride${long ? " long" : ""}`}><BikeIcon size={14} /> {gapText(i)}</div>
            )}
          </li>
        );
      })}
      <li className="leg walk"><WalkIcon size={14} /> {min(plan.walkFromDock.durationMin)} walk to your destination</li>
    </ol>
  );
}

function WalkCard({ plan: p, index, selected, onSelect }: Pick<Props, "plan" | "index" | "selected" | "onSelect">) {
  return (
    <li className={`plan${selected ? " sel" : ""}`} onClick={onSelect}>
      <div className="plan-head">
        <span className="rank">{index + 1}</span>
        <div className="plan-title">
          <b>{index === 0 ? "Recommended" : `Option ${index + 1}`}</b>
          <span>Walk straight there</span>
        </div>
        <span className="chip good"><CheckIcon size={14} /> Free</span>
      </div>
      <div className="stats">
        <div><ClockIcon /><b>{min(p.totalMinutes)}</b><span>total</span></div>
        <div><WalkIcon /><b>{min(p.walkToDock.durationMin)}</b><span>walking</span></div>
        <div><RouteIcon /><b>{miles(p.walkToDock.distanceM)} mi</b><span>distance</span></div>
      </div>
      <ol className="tl">
        <li>
          <span className="node walk"><WalkIcon size={16} /></span>
          <div className="step">
            <span className="what">{min(p.walkToDock.durationMin)} walk</span>
            <span className="to">to your destination</span>
          </div>
        </li>
      </ol>
      <ElevationProfile plan={p} />
      <div className="note info"><WalkIcon size={15} /><span>No bike needed. Ignores the ride limit and terrain preferences.</span></div>
    </li>
  );
}
