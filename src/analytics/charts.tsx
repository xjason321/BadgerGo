// Small SVG charts for the usage dashboard: stacked columns, lines and ranked bars. Thin marks, a 2px gap between
// stacked segments, hairline grid, one y-axis; hover or arrow keys show every series at that point; each chart has a
// table view. Colors come from CSS variables (analytics.css), light and dark.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { formatCount, niceTicks } from "./aggregate";

export interface Series {
  label: string;
  /** A CSS color (a variable from analytics.css). */
  color: string;
  values: number[];
}

/** The width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The chart as a slider over its points, for keyboard and screen-reader users: arrow keys move the crosshair. */
function sliderProps(title: string, n: number, active: number | null, describe: (i: number) => string) {
  const at = active ?? n - 1;
  return { role: "slider", "aria-label": title, "aria-valuemin": 0, "aria-valuemax": Math.max(0, n - 1), "aria-valuenow": at, "aria-valuetext": n > 0 ? describe(at) : "", tabIndex: 0 } as const;
}

const describeRows = (title: string, rows: Array<{ label: string; value: string }>) => `${title}: ${rows.map((r) => `${r.value} ${r.label}`).join(", ")}`;

/** The point under the pointer (or chosen with the arrow keys): the crosshair and the tooltip follow it. */
function useActive(n: number, x0: number, step: number) {
  const [active, setActive] = useState<number | null>(null);
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));
  return {
    active: active !== null && active < n ? active : null,
    handlers: {
      onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
        setActive(clamp(Math.floor((x - x0) / step)));
      },
      onPointerLeave: () => setActive(null),
      onFocus: () => setActive(n - 1),
      onBlur: () => setActive(null),
      onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        setActive((a) => clamp(e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (a ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1)));
      },
    },
  };
}

/** A few evenly spaced label positions, always including the last. */
function labelIndexes(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

export function Legend({ items }: { items: Array<{ label: string; color: string; mark: "rect" | "line" }> }) {
  return (
    <ul className="an-legend">
      {items.map((it) => (
        <li key={it.label}>
          <svg width="14" height="10" aria-hidden>
            {it.mark === "rect" ? <rect x="2" y="0" width="10" height="10" rx="2" fill={it.color} /> : <line x1="0" y1="5" x2="14" y2="5" stroke={it.color} strokeWidth="2" strokeLinecap="round" />}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Value first, series second; a short line key for each series. */
function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: Array<{ label: string; color: string; value: string }> }) {
  const w = 176;
  const left = Math.max(0, Math.min(width - w, x - w / 2));
  return (
    <div role="status" className="an-tip" style={{ left, width: w }}>
      <p className="an-tip-title">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="an-tip-row">
          <svg width="12" height="4" aria-hidden>
            <line x1="1" y1="2" x2="11" y2="2" stroke={r.color} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </p>
      ))}
    </div>
  );
}

const M = { top: 12, left: 40, bottom: 24 };
const PLOT_H = 168;

/** Tick labels with as many decimals as the step needs (0.025, 0.05 ... not 0, 0 ...). */
function tickFormat(ticks: number[]): (v: number) => string {
  const step = (ticks[1] ?? 1) - (ticks[0] ?? 0);
  if (step >= 1) return formatCount;
  const f = new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.min(3, 1 - Math.floor(Math.log10(step))) });
  return (v) => f.format(v);
}

function YAxis({ ticks, y, width }: { ticks: number[]; y: (v: number) => number; width: number }) {
  const label = tickFormat(ticks);
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth="1" shapeRendering="crispEdges" />
          <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="an-axis">
            {label(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ labels, x, max }: { labels: string[]; x: (i: number) => number; max: number }) {
  return (
    <g>
      {labelIndexes(labels.length, max).map((i) => (
        <text key={i} x={x(i)} y={M.top + PLOT_H + 16} textAnchor={i === labels.length - 1 ? "end" : i === 0 ? "start" : "middle"} className="an-axis">
          {labels[i]}
        </text>
      ))}
    </g>
  );
}

/** A rect with 4px rounded top corners and a square base (a column growing from the baseline). */
function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Stacked columns (one per label), bottom series first. */
export function ColumnChart({ title, labels, series, tooltipTitle }: { title: string; labels: string[]; series: Series[]; tooltipTitle: (i: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const plotW = Math.max(0, width - M.left);
  const step = n > 0 ? plotW / n : 0;
  const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks.at(-1) ?? 1;
  const y = (v: number) => M.top + PLOT_H - (v / top) * PLOT_H;
  const barW = Math.max(1, Math.min(24, step - 2));
  const x = (i: number) => M.left + i * step + step / 2;
  const { active, handlers } = useActive(n, M.left, step);
  const rows = (i: number) => series.slice().reverse().map((se) => ({ label: se.label, color: se.color, value: formatCount(se.values[i] ?? 0) }));
  return (
    <div ref={ref} className="an-chart">
      {width > 0 && (
        <svg width={width} height={M.top + PLOT_H + M.bottom} className="an-svg" {...sliderProps(title, n, active, (i) => describeRows(tooltipTitle(i), rows(i)))} {...handlers}>
          <YAxis ticks={ticks} y={y} width={width} />
          {labels.map((_, i) => {
            let base = 0;
            const lastNonZero = series.reduce((last, se, k) => ((se.values[i] ?? 0) > 0 ? k : last), -1);
            return (
              <g key={i} opacity={active === null || active === i ? 1 : 0.55}>
                {series.map((se, k) => {
                  const v = se.values[i] ?? 0;
                  if (v <= 0) return null;
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  const gap = base - v > 0 ? 2 : 0; // the gap between stacked segments
                  const h = Math.max(0, y0 - y1 - gap);
                  if (h <= 0) return null;
                  const bx = x(i) - barW / 2;
                  return k === lastNonZero ? <path key={se.label} d={topRounded(bx, y1, barW, h)} fill={se.color} /> : <rect key={se.label} x={bx} y={y1} width={barW} height={h} fill={se.color} />;
                })}
              </g>
            );
          })}
          <XLabels labels={labels} x={x} max={Math.max(2, Math.floor(plotW / 64))} />
        </svg>
      )}
      {active !== null && <Tooltip x={x(active)} width={width} title={tooltipTitle(active)} rows={rows(active)} />}
    </div>
  );
}

/** Lines over the same labels, one y-axis; the last value of each is labeled at its end when there is room. */
export function LineChart({ title, labels, series, tooltipTitle }: { title: string; labels: string[]; series: Series[]; tooltipTitle: (i: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const right = 44; // room for the end labels
  const plotW = Math.max(0, width - M.left - right);
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values)));
  const top = ticks.at(-1) ?? 1;
  const y = (v: number) => M.top + PLOT_H - (v / top) * PLOT_H;
  const x = (i: number) => M.left + i * step;
  const { active, handlers } = useActive(n, M.left - step / 2, step);
  const ends = series.map((s) => ({ s, y: y(s.values.at(-1) ?? 0) }));
  // End labels only when they don't collide (the legend and tooltip carry identity otherwise).
  const endLabels = ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a.y - b.y) >= 14));
  const rows = (i: number) => series.map((s) => ({ label: s.label, color: s.color, value: formatCount(s.values[i] ?? 0) }));
  return (
    <div ref={ref} className="an-chart">
      {width > 0 && (
        <svg width={width} height={M.top + PLOT_H + M.bottom} className="an-svg" {...sliderProps(title, n, active, (i) => describeRows(tooltipTitle(i), rows(i)))} {...handlers}>
          <YAxis ticks={ticks} y={y} width={width - right} />
          {active !== null && <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + PLOT_H} stroke="var(--viz-axis)" strokeWidth="1" shapeRendering="crispEdges" />}
          {series.map((s) => (
            <path key={s.label} d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {ends.map(({ s, y: ey }) => (
            <g key={s.label}>
              <circle cx={x(n - 1)} cy={ey} r="4" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" />
              {endLabels && (
                <text x={x(n - 1) + 8} y={ey} dy="0.32em" className="an-end">
                  {formatCount(s.values.at(-1) ?? 0)}
                </text>
              )}
            </g>
          ))}
          {active !== null && series.map((s) => <circle key={s.label} cx={x(active)} cy={y(s.values[active] ?? 0)} r="4" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" />)}
          <XLabels labels={labels} x={x} max={Math.max(2, Math.floor(plotW / 64))} />
        </svg>
      )}
      {active !== null && <Tooltip x={x(active)} width={width} title={tooltipTitle(active)} rows={rows(active)} />}
    </div>
  );
}

/** Ranked horizontal bars, one hue: a name, its figure and share, and a bar on a shared scale. */
export function BarList({ items, total, empty }: { items: Array<{ label: string; value: number }>; total?: number; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="an-muted">{empty}</p>;
  return (
    <ul className="an-bars">
      {items.map((it) => (
        <li key={it.label}>
          <div className="an-bar-head">
            <span className="an-bar-name">{it.label}</span>
            <span className="an-bar-val">
              {formatCount(it.value)}
              {total ? <span className="an-muted">{Math.round((it.value / total) * 100)}%</span> : null}
            </span>
          </div>
          <div className="an-bar" style={{ width: `${Math.max(it.value > 0 ? 2 : 0, (it.value / max) * 100)}%` }} />
        </li>
      ))}
    </ul>
  );
}

/** A chart's card: title, what it shows, the chart or its table, and the toggle between them. */
export function ChartCard({ title, note, legend, table, children }: { title: string; note?: string; legend?: ReactNode; table: { columns: string[]; rows: Array<Array<string | number>> }; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="an-card">
      <figcaption className="an-card-head">
        <span className="an-card-title">
          <b>{title}</b>
          {note && <span className="an-muted">{note}</span>}
        </span>
        <button type="button" className="an-btn" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "Chart" : "Table"}
        </button>
      </figcaption>
      {!asTable && legend}
      {asTable ? (
        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={String(r[0])}>
                  {r.map((cell, i) => (
                    <td key={i}>{typeof cell === "number" ? formatCount(cell) : cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </figure>
  );
}
