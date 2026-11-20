// The usage dashboard at /analytics: unique users, who is using the app now, rides, when it is used and which
// features. Not linked from the app; anonymous totals only. The numbers come from GET /api/analytics; how they are
// counted is in ../ui/usage.ts and ../../worker/usageCore.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StatsResponse } from "../core/usageTypes";
import { change, FETCH_DAYS, formatCount, RANGES, summarizeRange, type RangeDays, type Share } from "./aggregate";
import { BarList, ChartCard, ColumnChart, Legend, LineChart } from "./charts";

const RANGE_STORAGE = "badgergo.analyticsRange";
const REFRESH_MS = 60_000;

function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* this browser keeps nothing; fine */ }
}

async function fetchStats(signal: AbortSignal): Promise<StatsResponse> {
  const r = await fetch(`/api/analytics?days=${FETCH_DAYS}`, { signal });
  if (!r.ok) throw new Error(String(r.status));
  const body: unknown = await r.json();
  if (!body || typeof body !== "object" || !Array.isArray((body as StatsResponse).days)) throw new Error("bad response");
  return body as StatsResponse;
}

/** The numbers, refreshed every minute while the page is visible ("active now" moves); they stay on screen meanwhile. */
function useStats() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const ctl = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    fetchStats(c.signal).then(
      (d) => { if (!c.signal.aborted) { setData(d); setError(false); setBusy(false); } },
      () => { if (!c.signal.aborted) { setError(true); setBusy(false); } },
    );
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); ctl.current?.abort(); };
  }, [refresh]);
  return { data, error, busy, refresh };
}

const dayLabel = (day: string, o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
const tzName = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(Date.now()).find((p) => p.type === "timeZoneName")?.value ?? tz;

const PLATFORM_NAMES: Record<string, string> = { ios: "iPhone / iPad", android: "Android", desktop: "Computer" };
const HOW_NAMES: Record<string, string> = { browser: "Browser", installed: "Home Screen web app" };
const FEATURE_NAMES: Record<string, string> = {
  route_search: "Routes planned",
  ride_start: "Rides started",
  share: "Route shared",
  shared_open: "Shared route opened",
  edit_route: "Docks edited by hand",
  timer_start: "Bike timer started",
  alerts_on: "Timer alerts turned on",
  nearest_bike: "Nearest bike",
  nearest_dock: "Nearest open dock",
};
const named = (shares: Share[], name: (key: string) => string) => shares.map((s) => ({ label: name(s.key), value: s.value }));

export function AnalyticsPage() {
  const [range, setRange] = useState<RangeDays>(() => RANGES.find((r) => String(r) === load(RANGE_STORAGE)) ?? 30);
  const { data, error, busy, refresh } = useStats();
  return (
    <main className="an">
      <header className="an-top">
        <h1>BadgerGo analytics</h1>
        {data && <span className="an-muted">Updated {new Date(data.generatedAtMs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
        <button type="button" className="an-btn" onClick={refresh}>Refresh</button>
      </header>

      <div role="radiogroup" aria-label="Range" className="an-ranges">
        {RANGES.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? "on" : ""} onClick={() => { setRange(r); save(RANGE_STORAGE, String(r)); }}>
            Last {r} days
          </button>
        ))}
      </div>

      {error && <p role="alert" className="an-alert">Couldn’t load the numbers. Check the connection and try again.</p>}
      {!data && busy && <p className="an-muted">Loading…</p>}
      {data && (
        <div className={`an-body${busy ? " busy" : ""}`}>
          <Dashboard data={data} range={range} />
        </div>
      )}
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="an-tile">
      <p className="an-muted">{label}</p>
      <p className="an-tile-val">{value}</p>
      {sub && <p className="an-muted an-small">{sub}</p>}
    </div>
  );
}

function Delta({ value, period }: { value: number | null; period: string }) {
  if (value === null) return <p className="an-muted">No earlier {period} to compare with yet</p>;
  const pct = Math.round(value * 100);
  return (
    <p className={`an-delta ${pct > 0 ? "up" : pct < 0 ? "down" : ""}`}>
      {pct > 0 ? "▲ +" : pct < 0 ? "▼ " : ""}
      {pct}% <span className="an-muted">vs the {period} before</span>
    </p>
  );
}

function Dashboard({ data, range }: { data: StatsResponse; range: RangeDays }) {
  const r = summarizeRange(data, range);
  const today = data.days.at(-1);
  const labels = r.days.map((d) => dayLabel(d.day));
  const full = (i: number) => dayLabel(r.days[i]?.day ?? "", { weekday: "short", month: "short", day: "numeric" });
  const period = `${range} days`;
  const tz = tzName(data.timeZone);
  const deviceDays = r.days.reduce((n, d) => n + d.users, 0);
  const startRate = r.routes > 0 ? Math.round((r.ridesStarted / r.routes) * 100) : null;

  return (
    <>
      <section aria-label="Unique users" className="an-card an-hero">
        <p className="an-muted">Unique users, last {period}</p>
        <p className="an-hero-val">{formatCount(r.users)}</p>
        <Delta value={change(r.users, r.usersBefore)} period={period} />
      </section>

      <div className="an-tiles">
        <Tile label="Active now" value={formatCount(data.activeNow)} sub={`Peak today: ${formatCount(today?.peakActive ?? 0)}`} />
        <Tile label="Users today" value={formatCount(r.today)} sub={`${formatCount(today?.newUsers ?? 0)} new`} />
        <Tile label={`New users, ${period}`} value={formatCount(r.newUsers)} sub={`${formatCount(r.opens)} app opens`} />
        <Tile label={`Rides started, ${period}`} value={formatCount(r.ridesStarted)} sub={startRate !== null ? `${startRate}% of routes planned` : undefined} />
        <Tile label="All-time users" value={formatCount(data.allTimeUsers)} sub={data.since ? `Since ${dayLabel(data.since, { month: "short", day: "numeric", year: "numeric" })}` : "No visits yet"} />
      </div>

      <ChartCard
        title="Daily users"
        note="Unique devices each day: new and returning"
        legend={<Legend items={[{ label: "Returning", color: "var(--viz-1)", mark: "rect" }, { label: "New", color: "var(--viz-2)", mark: "rect" }]} />}
        table={{ columns: ["Day", "Users", "New", "Returning", "Opens"], rows: r.days.map((d) => [d.day, d.users, d.newUsers, d.users - d.newUsers, d.opens]).slice().reverse() }}
      >
        <ColumnChart
          title={`Daily users, last ${period}`}
          labels={labels}
          tooltipTitle={full}
          series={[
            { label: "Returning", color: "var(--viz-1)", values: r.days.map((d) => d.users - d.newUsers) },
            { label: "New", color: "var(--viz-2)", values: r.days.map((d) => d.newUsers) },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Unique users over time"
        note="Devices that used the app in the 7 and 30 days up to each day"
        legend={<Legend items={[{ label: "Last 30 days", color: "var(--viz-1)", mark: "line" }, { label: "Last 7 days", color: "var(--viz-2)", mark: "line" }]} />}
        table={{ columns: ["Day", "7 days", "30 days", "90 days"], rows: r.days.map((d) => [d.day, d.users7, d.users30, d.users90]).slice().reverse() }}
      >
        <LineChart
          title={`Unique users in the 7 and 30 days up to each day, last ${period}`}
          labels={labels}
          tooltipTitle={full}
          series={[
            { label: "Last 30 days", color: "var(--viz-1)", values: r.days.map((d) => d.users30) },
            { label: "Last 7 days", color: "var(--viz-2)", values: r.days.map((d) => d.users7) },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Rides"
        note="Routes planned (a start and an end searched) and rides started (the Start button in the app)"
        legend={<Legend items={[{ label: "Routes planned", color: "var(--viz-1)", mark: "line" }, { label: "Rides started", color: "var(--viz-2)", mark: "line" }]} />}
        table={{ columns: ["Day", "Routes planned", "Rides started"], rows: r.days.map((d) => [d.day, d.counts.route_search ?? 0, d.counts.ride_start ?? 0]).slice().reverse() }}
      >
        <LineChart
          title={`Routes planned and rides started per day, last ${period}`}
          labels={labels}
          tooltipTitle={full}
          series={[
            { label: "Routes planned", color: "var(--viz-1)", values: r.days.map((d) => d.counts.route_search ?? 0) },
            { label: "Rides started", color: "var(--viz-2)", values: r.days.map((d) => d.counts.ride_start ?? 0) },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="When people use the app"
        note={`Average devices with the app open, by hour (${tz})`}
        table={{ columns: ["Hour", "Devices open"], rows: r.hourly.map((v, h) => [hourLabel(h), Math.round(v * 10) / 10]) }}
      >
        <ColumnChart
          title={`Average devices with the app open by hour of day, last ${period}`}
          labels={r.hourly.map((_, h) => hourLabel(h))}
          tooltipTitle={(h) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`}
          series={[{ label: "devices open", color: "var(--viz-1)", values: r.hourly }]}
        />
      </ChartCard>

      <div className="an-grid">
        <Breakdown title="Devices" note="Share of daily users" items={named(r.platforms, (k) => PLATFORM_NAMES[k] ?? k)} total={deviceDays} />
        <Breakdown title="Browser or Home Screen" note="Share of daily users" items={named(r.howUsed, (k) => HOW_NAMES[k] ?? k)} total={deviceDays} />
      </div>

      <Breakdown title="Features used" note={`Times used, last ${period}`} items={named(r.features, (k) => FEATURE_NAMES[k] ?? k)} />

      <section className="an-how">
        <h2>How this is counted</h2>
        <p>
          “Users” are devices (browsers), not people: one person on a phone and a computer counts twice, and so do Safari and the Home Screen app on the same iPhone, or a
          browser after its site data is cleared. The app sends no identifier: each device reports that it opened the app and, with its first open of a day, how many days it
          has been since its previous one. That is enough to count unique devices over any window up to 90 days without telling them apart.
        </p>
        <p>
          “Active now” is devices with the app open in the last 5 minutes (a rider in Google Maps isn’t counted until they come back to the app). Days and hours are in {tz}.
          Browsers with Do Not Track or Global Privacy Control on, automated browsers and bots aren’t counted.
        </p>
      </section>
    </>
  );
}

function Breakdown({ title, note, items, total }: { title: string; note: string; items: Array<{ label: string; value: number }>; total?: number }) {
  return (
    <section aria-label={title} className="an-card">
      <h2>
        <span>{title}</span>
        <span className="an-muted">{note}</span>
      </h2>
      <BarList items={items} total={total} empty="No counts in this range yet." />
    </section>
  );
}
