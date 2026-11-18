import { useEffect, useRef } from "react";
import { haversine } from "../core/geo";
import { isIos } from "../core/bcycle";
import { appleLegUrl, googleLegUrl, type NavLeg } from "../core/navLinks";
import { formatDistance } from "../core/ride";
import type { LatLng, Plan } from "../core/types";
import { BikeIcon, CheckIcon, CloseIcon, WalkIcon } from "./icons";

type App = "google" | "apple";
const KEY = "badgergo.navApp";
const saved = (): App | null => { try { const v = localStorage.getItem(KEY); return v === "google" || v === "apple" ? v : null; } catch { return null; } };
const remember = (a: App) => { try { localStorage.setItem(KEY, a); } catch { /* private mode */ } };

const min = (m: number) => `${Math.max(1, Math.round(m))} min`;

interface Props {
  plan: Plan;
  legs: NavLeg[];
  /** Which leg we're on. It moves on by itself when the rider reaches the end of the leg. */
  index: number;
  onIndex: (i: number) => void;
  /** The rider's position, for the distance still to go. */
  pos: LatLng | null;
  error?: string;
  destinationName: string;
  /** End ride mode. */
  onStop: () => void;
  /** Height of this panel, so the map can keep the leg clear of it. */
  onHeight: (h: number) => void;
}

/** Ride mode's bottom panel: the current leg (the map above frames it), arrows between legs, and a hand-off to Google / Apple Maps. */
export function NavSheet({ legs, index, onIndex, pos, error, onStop, onHeight }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const ios = isIos();
  const first: App = saved() ?? "google";
  const done = index >= legs.length;
  const leg = legs[Math.min(index, legs.length - 1)];

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const ro = new ResizeObserver(() => onHeight(node.offsetHeight));
    ro.observe(node);
    onHeight(node.offsetHeight);
    return () => { ro.disconnect(); onHeight(0); };
  }, [onHeight]);

  const open = (app: App) => {
    remember(app);
    window.location.href = app === "apple" ? appleLegUrl(leg) : googleLegUrl(leg);
  };

  const apps: App[] = ios ? [first, first === "google" ? "apple" : "google"] : ["google"];
  const label = (a: App) => (a === "google" ? "Google Maps" : "Apple Maps");
  const left = leg && pos ? formatDistance(haversine(pos, leg.to)) : null;

  return (
    <div className="nav-dock" ref={el} role="region" aria-label="Your trip">
      <button className="nav-x" onClick={onStop} aria-label="End ride mode"><CloseIcon size={18} /></button>
      <ol className="nav-steps" aria-label="Trip legs" style={{ "--n": legs.length } as React.CSSProperties}>
        {legs.map((l, i) => (
          <li key={i} className={i < index ? "past" : i === index ? "now" : ""}>
            <span className="dot">{i < index ? <CheckIcon size={12} /> : l.kind === "ride" ? <BikeIcon size={13} /> : <WalkIcon size={13} />}</span>
          </li>
        ))}
      </ol>
      {done ? (
        <div className="nav-leg">
          <b>You've arrived</b>
          <span>Enjoy!</span>
          <button className="nav-primary" onClick={onStop}>Done</button>
        </div>
      ) : (
        <>
          <div className="nav-leg">
            <small>Leg {index + 1} of {legs.length}{left ? ` · ${left} to go` : error ? "" : " · finding your location…"}</small>
            <b>{leg.kind === "ride" ? "Ride" : "Walk"} {min(leg.minutes)} {leg.atStop ? "to" : "toward"} {leg.toName}</b>
            {error ? <span className="warn">{error}</span> : null}
            {leg.part && <span>Part {leg.part.n} of {leg.part.of}: this ride needs {leg.part.of} links to stay on route.</span>}
            {leg.atStop && leg.swap && <span>Dock your bike there, then rent another for the next leg.</span>}
            {leg.atStop && leg.kind === "ride" && !leg.swap && <span>Dock your bike at the end.</span>}
          </div>
          <div className="nav-go">
            <button className="nav-arrow" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous leg">‹</button>
            <button className="nav-primary" onClick={() => open(apps[0])}>
              {leg.kind === "ride" ? <BikeIcon size={18} /> : <WalkIcon size={18} />} Open in {label(apps[0])}
            </button>
            <button className="nav-arrow" onClick={() => onIndex(index + 1)} aria-label={index + 1 >= legs.length ? "Finish trip" : "Next leg"}>›</button>
          </div>
          {apps.slice(1).map((a) => (
            <button key={a} className="nav-secondary" onClick={() => open(a)}>
              {leg.kind === "ride" ? <BikeIcon size={18} /> : <WalkIcon size={18} />} Open in {label(a)}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
