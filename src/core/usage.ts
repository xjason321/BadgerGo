// Days, hours and check-in windows for the anonymous usage counts (USAGE in usageConfig.ts), shared by the app
// (what to report) and the Worker (where to count it). Pure: clocks are passed in.

const formats = new Map<string, Intl.DateTimeFormat>();
function format(timeZone: string): Intl.DateTimeFormat {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    formats.set(timeZone, f);
  }
  return f;
}

function parts(ms: number, timeZone: string): { day: string; hour: number } {
  const p: Record<string, string> = {};
  for (const { type, value } of format(timeZone).formatToParts(ms)) p[type] = value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** The calendar day (YYYY-MM-DD) of `ms` in `timeZone`. */
export const dayKey = (ms: number, timeZone: string): string => parts(ms, timeZone).day;
/** The hour of day (0-23) of `ms` in `timeZone`. */
export const hourOf = (ms: number, timeZone: string): number => parts(ms, timeZone).hour;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const utcOf = (day: string): number => {
  const m = DAY_RE.exec(day);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};

export const isDayKey = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v) && Number.isFinite(utcOf(v));

/** Calendar days from `from` to `to` (YYYY-MM-DD); NaN for a malformed day. */
export const dayGap = (from: string, to: string): number => Math.round((utcOf(to) - utcOf(from)) / 86_400_000);

/** `day` moved by `n` calendar days. */
export const addDays = (day: string, n: number): string => new Date(utcOf(day) + n * 86_400_000).toISOString().slice(0, 10);

/** The check-in window `ms` falls in. */
export const windowOf = (ms: number, windowMs: number): number => Math.floor(ms / windowMs);

/** What a device remembers between visits: its last active day and its last check-in window. Nothing else. */
export interface UsageMemory {
  day: string | null;
  window: number | null;
}

export function parseUsageMemory(raw: unknown): UsageMemory {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { day: isDayKey(o.day) ? o.day : null, window: typeof o.window === "number" && Number.isInteger(o.window) ? o.window : null };
}

/**
 * Whether an open or check-in today is the device's first of the day, and if so how many days after its
 * previous active day (null: never active before; capped at `maxGap`). Null when it is not the first, or when
 * the device's clock went back to before its last active day.
 */
export function firstOfDay(memory: UsageMemory, today: string, maxGap: number): { gap: number | null } | null {
  if (memory.day === today) return null;
  if (memory.day === null) return { gap: null };
  const gap = dayGap(memory.day, today);
  return Number.isFinite(gap) && gap > 0 ? { gap: Math.min(gap, maxGap) } : null;
}
