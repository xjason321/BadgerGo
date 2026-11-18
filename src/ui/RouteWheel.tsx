import { useEffect, useRef, useState } from "react";
import type { Plan } from "../core/types";
import { PlanCard } from "./PlanCard";

const ACTIVE_Y = 290; // height of the chosen card's centre above the bottom of the map
const NEXT_DEG = 3; // the next card rides just above the bottom edge

interface Props {
  plans: Plan[];
  selected: number;
  trafficLevel: number;
  onSelect: (i: number) => void;
  onClear: () => void;
}

/**
 * Laptop route picker. The route cards ride a circle whose centre is the bottom-left corner of the map and always stay
 * upright, like gondolas on a Ferris wheel. The chosen route snaps to one spot on the arc; scroll, drag along the arc,
 * press the arrow keys or click a neighbour to turn the wheel.
 */
export function RouteWheel({ plans, selected, trafficLevel, onSelect, onClear }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 800 });
  const [drag, setDrag] = useState(0); // routes' worth of turn while the wheel is being dragged
  const dragging = useRef<{ id: number; startAngle: number; base: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const sel = useRef(selected);
  sel.current = selected;
  const n = plans.length;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Scrolling over the cards turns the wheel one route at a time.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target as HTMLElement).closest(".wheel-slot")) return;
      e.preventDefault();
      const now = Date.now();
      if (now - last < 260 || Math.abs(e.deltaY) < 4) return;
      last = now;
      const next = Math.max(0, Math.min(n - 1, sel.current + (e.deltaY > 0 ? 1 : -1)));
      if (next !== sel.current) onSelect(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [n, onSelect]);

  const R = Math.max(320, Math.min(340, dims.w * 0.5));
  const activeDeg = (Math.asin(Math.min(1, ACTIVE_Y / R)) * 180) / Math.PI;
  const STEP_DEG = activeDeg - NEXT_DEG;
  const pos = Math.max(-0.35, Math.min(n - 1 + 0.35, selected + drag));

  /** Angle of the pointer around the wheel's centre, in degrees counter-clockwise from the bottom edge. */
  const pointerAngle = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return (Math.atan2(r.bottom - e.clientY, e.clientX - r.left) * 180) / Math.PI;
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = { id: e.pointerId, startAngle: pointerAngle(e), base: sel.current, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d || d.id !== e.pointerId) return;
    const dev = pointerAngle(e) - d.startAngle;
    if (!d.moved && Math.abs(dev) * (Math.PI / 180) * R < 8) return; // a click, not a drag
    if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
    setDrag(dev / STEP_DEG);
  };
  const up = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d || d.id !== e.pointerId) return;
    dragging.current = null;
    if (d.moved) {
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      const target = Math.max(0, Math.min(n - 1, Math.round(d.base + (pointerAngle(e) - d.startAngle) / STEP_DEG)));
      setDrag(0);
      onSelect(target);
    }
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); onSelect(Math.min(n - 1, selected + 1)); }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); onSelect(Math.max(0, selected - 1)); }
  };

  return (
    <div className="wheel-wrap" ref={wrap}>
      <svg className="wheel-arc" width={R} height={R} viewBox={`0 0 ${R} ${R}`} aria-hidden="true">
        <path d={`M0 0 A${R} ${R} 0 0 1 ${R} ${R}`} />
      </svg>
      <ul className={`wheel${drag ? " turning" : ""}`} tabIndex={0} onKeyDown={key} aria-label={`Routes, ${selected + 1} of ${n}`}>
        {plans.map((p, i) => {
          const k = i - pos;
          const a = ((activeDeg - k * STEP_DEG) * Math.PI) / 180;
          const far = Math.abs(k);
          const s = 1 - 0.07 * Math.min(far, 2);
          return (
            <li
              key={p.id}
              className={`wheel-slot${i === selected ? " active" : ""}`}
              style={{
                transform: `translate(${(R * Math.cos(a)).toFixed(1)}px, ${(-R * Math.sin(a)).toFixed(1)}px) translate(-50%, 50%) scale(${s.toFixed(3)})`,
                opacity: k < -0.5 || k > 1.5 ? 0 : 1,
                zIndex: 60 - Math.round(far * 10),
                pointerEvents: k < -0.5 || k > 1.5 ? "none" : "auto",
              }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onClickCapture={(e) => { if (justDragged.current) { e.stopPropagation(); e.preventDefault(); } }}
            >
              <div className="wheel-nav" onPointerDown={(e) => e.stopPropagation()}>
                <button onClick={() => onSelect(selected - 1)} disabled={selected === 0} aria-label="Previous route">‹</button>
                <span>{selected + 1} / {n}</span>
                <button onClick={() => onSelect(selected + 1)} disabled={selected === n - 1} aria-label="Next route">›</button>
              </div>
              <ul className="plans one">
                <PlanCard plan={p} index={i} selected={i === selected} trafficLevel={trafficLevel} onSelect={() => onSelect(i)} />
              </ul>
            </li>
          );
        })}
      </ul>
      <button className="wheel-hub" onClick={onClear} title="Clear routes" aria-label="Clear routes">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}
