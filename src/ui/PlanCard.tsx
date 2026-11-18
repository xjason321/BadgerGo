import { levelOf } from "../core/dockStatus";
import { trafficExposure } from "../core/planner";
import { overageCost } from "../core/pricing";
import { STUDENT_PLAN, type Plan } from "../core/types";
import { AlertIcon, BikeIcon, CheckIcon, ClockIcon, DollarIcon, RouteIcon, SwapIcon, WalkIcon } from "./icons";
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
}

/** One route suggestion: headline numbers, then the trip step by step. */
export function PlanCard({ plan: p, index, selected, trafficLevel, onSelect }: Props) {
  if (p.walkOnly) return <WalkCard plan={p} index={index} selected={selected} onSelect={onSelect} />;
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

      {swaps > 0 && (
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
    </li>
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
