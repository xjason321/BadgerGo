import { CloseIcon, FlagIcon, PinIcon } from "./icons";

interface Props {
  lat: number;
  lon: number;
  /** Street address once looked up. */
  label: string | null;
  onSet: (target: "origin" | "destination") => void;
  onClose: () => void;
}

/** Dialog shown after a long press on the map. */
export function PlaceMenu({ lat, lon, label, onSet, onClose }: Props) {
  return (
    <div className="menu-wrap" onClick={onClose}>
      <div className="menu" role="dialog" aria-label="Dropped pin" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <div className="menu-title">{label ?? "Dropped pin"}</div>
        <div className="menu-sub">{lat.toFixed(5)}, {lon.toFixed(5)}</div>
        <button className="menu-btn start" onClick={() => onSet("origin")}>
          <span className="ico"><PinIcon /></span> Set as start location
        </button>
        <button className="menu-btn end" onClick={() => onSet("destination")}>
          <span className="ico"><FlagIcon /></span> Set as end location
        </button>
      </div>
    </div>
  );
}
