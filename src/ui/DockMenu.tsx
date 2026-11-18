import { dockActionsFor, type DockAction } from "../core/dockActions";
import type { Station } from "../core/types";
import { CloseIcon } from "./icons";

interface Props {
  station: Station;
  /** Docks of the bike route on screen (pick-up first), or null when there is none. */
  chainIds: string[] | null;
  onAction: (s: Station, a: DockAction) => void;
  onClose: () => void;
}

const CLASS: Record<DockAction, string> = { start: "start", pickup: "start", swap: "swap", remove: "rm", end: "end", dropoff: "end" };

/** Dialog shown after a long press on a dock: the same choices as the dock's popup, with bigger buttons. */
export function DockMenu({ station: s, chainIds, onAction, onClose }: Props) {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  return (
    <div className="menu-wrap" onClick={onClose}>
      <div className="menu" role="dialog" aria-label={s.name} onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <div className="menu-title">{s.name}</div>
        <div className="menu-sub">{n(s.bikesAvailable, "bike")} · {n(s.docksAvailable, "open dock")}</div>
        {dockActionsFor(chainIds, s.id).map((a) => (
          <button key={a.action} className={`menu-btn ${CLASS[a.action]}`} onClick={() => onAction(s, a.action)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
