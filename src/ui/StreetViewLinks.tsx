import { legViews, viewUrl } from "../core/streetView";

/** "Street View: Start · End" for one stretch of the route: opens Google Street View facing along the route. */
export function StreetViewLinks({ geometry, className = "" }: { geometry: [number, number][]; className?: string }) {
  const v = legViews(geometry);
  if (!v) return null;
  const open = (e: React.MouseEvent) => e.stopPropagation(); // don't select the route card underneath
  return (
    <span className={`sv ${className}`}>
      <span className="sv-label">Street View</span>
      <a href={viewUrl(v.start)} target="_blank" rel="noreferrer" onClick={open}>Start</a>
      <a href={viewUrl(v.end)} target="_blank" rel="noreferrer" onClick={open}>End</a>
    </span>
  );
}
