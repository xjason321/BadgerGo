import { useEffect, useRef, useState } from "react";
import { haversine } from "../core/geo";
import { isIos } from "../core/bcycle";
import { appleLegUrl, googleDirectUrl, googleLegUrl, type NavLeg } from "../core/navLinks";
import { fullReason, fullWarning, nearestOpenDocks, type DockChoice } from "../core/dockNow";
import { formatDistance } from "../core/ride";
import { clock, type TimerAlert, type TimerState } from "../core/bikeTimer";
import type { LatLng, Plan, Station } from "../core/types";
import { BikeIcon, CheckIcon, ClockIcon, CloseIcon, VolumeIcon, VolumeOffIcon, WalkIcon } from "./icons";

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
  /** Live station data, for "dock now" and full-dock warnings. */
  stations: Station[];
  /** Voice and vibration cues on leg changes. */
  cues: boolean;
  onCues: () => void;
  /** Show a station on the map. */
  onFocusStation: (s: Station) => void;
  /** The bike timer: running or not, its numbers, the latest alert, and start / stop. */
  timer: { running: boolean; state: TimerState | null; alert: TimerAlert | null; start: () => void; stop: () => void };
}

/** Ride mode's bottom panel: the current leg (the map above frames it), arrows between legs, and a hand-off to Google / Apple Maps. */
export function NavSheet({ legs, index, onIndex, pos, error, onStop, onHeight, timer, stations, onFocusStation, cues, onCues }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [dockList, setDockList] = useState(false);
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
      <button className={`nav-cue${cues ? " on" : ""}`} onClick={onCues} aria-pressed={cues} aria-label={cues ? "Turn off voice and vibration cues" : "Turn on voice and vibration cues"} title={cues ? "Voice and vibration on" : "Voice and vibration off"}>{cues ? <VolumeIcon size={18} /> : <VolumeOffIcon size={18} />}</button>
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
          {leg.kind === "ride" && leg.atStop && (() => {
            const w = fullWarning(leg.dockId, stations);
            return w ? (
              <div className="nav-full" role="alert">
                <b>{w.station.name} {fullReason(w.station)} right now.</b>
                {w.alternatives.length ? <span>Try one of these instead:</span> : <span>No other open docks nearby.</span>}
                {w.alternatives.map((d) => <DockRow key={d.station.id} d={d} onFocus={onFocusStation} />)}
              </div>
            ) : null;
          })()}
          {timer.running && timer.state ? (
            <BikeTimer s={timer.state} alert={timer.alert} onStop={timer.stop} />
          ) : leg.kind === "ride" ? (
            <button className="nav-timer-start" onClick={timer.start}><ClockIcon size={18} /> I've unlocked a bike: start the 30-min timer</button>
          ) : null}
          <div className="nav-go">
            <button className="nav-arrow" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous leg">‹</button>
            <button className="nav-primary" onClick={() => open(apps[0])}>
              {leg.kind === "ride" ? <BikeIcon size={18} /> : <WalkIcon size={18} />} Open in {label(apps[0])}
            </button>
            <button className="nav-arrow" onClick={() => onIndex(index + 1)} aria-label={index + 1 >= legs.length ? "Finish trip" : "Next leg"}>›</button>
          </div>
          {leg.kind === "ride" && (
            <button className="nav-dock-now" onClick={() => setDockList((v) => !v)} aria-expanded={dockList}>
              {dockList ? "Hide docks" : "Need to dock now? Find the nearest open dock"}
            </button>
          )}
          {leg.kind === "ride" && dockList && (
            <div className="nav-docks">
              {!pos ? <span className="nav-docks-note">Finding your location…</span> : (() => {
                const near = nearestOpenDocks(pos, stations, { limit: 3 });
                return near.length ? near.map((d) => <DockRow key={d.station.id} d={d} onFocus={onFocusStation} />) : <span className="nav-docks-note">No open docks found nearby.</span>;
              })()}
            </div>
          )}
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

/** The running timer: big clock, a bar, and what it will cost to go over. */
function BikeTimer({ s, alert, onStop }: { s: TimerState; alert: TimerAlert | null; onStop: () => void }) {
  const over = s.phase === "over";
  const mmss = over ? `+${clock(-s.remainingSec)}` : clock(s.remainingSec);
  return (
    <div className={`nav-timer ${s.phase}`} role="timer" aria-live={alert ? "assertive" : "off"}>
      <div className="nav-timer-top">
        <span className="nav-timer-clock">{mmss}</span>
        <span className="nav-timer-label">{over ? "over the free time" : "left free"}</span>
        <button className="nav-timer-stop" onClick={onStop}>Docked</button>
      </div>
      <div className="nav-timer-bar" aria-hidden="true"><i style={{ width: `${Math.round(s.fraction * 100)}%` }} /></div>
      <small>
        {over
          ? `$${s.cost} so far. Next $8 in ${clock(s.nextChargeSec)}. Dock now.`
          : s.phase === "warn"
            ? `Dock within ${Math.max(1, Math.ceil(s.remainingSec / 60))} min to stay free.`
            : "Free for the first 30 minutes of each ride."}
      </small>
    </div>
  );
}

/** One open dock: tap the name to see it on the map, Go for bike directions. */
function DockRow({ d, onFocus }: { d: DockChoice; onFocus: (s: Station) => void }) {
  const s = d.station;
  return (
    <div className="dock-row">
      <button className="dock-row-info" onClick={() => onFocus(s)}>
        <b>{s.name}</b>
        <span>{formatDistance(d.meters)} · {s.docksAvailable} open dock{s.docksAvailable === 1 ? "" : "s"}</span>
      </button>
      <a className="dock-row-go" href={googleDirectUrl(s)}>Go</a>
    </div>
  );
}
