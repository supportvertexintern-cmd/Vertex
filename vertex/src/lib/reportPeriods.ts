// A weekly report is always a fixed Monday-Sunday, 7-day window (see
// _period_errors in vertex_be/app/api/v1/reports.py for why) — these helpers keep the
// UI's date pickers from ever producing a mismatched range in the first
// place, rather than relying on the server to reject it after the fact.

/** Given any date string (YYYY-MM-DD), returns that ISO week's Monday, as YYYY-MM-DD. */
export function mondayOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day; // days to subtract to reach Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** The Sunday 6 days after a given Monday, as YYYY-MM-DD. */
export function sundayAfter(mondayStr: string): string {
  const d = new Date(`${mondayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** Monday + Sunday for whatever week contains the given date. */
export function weekRangeContaining(dateStr: string): { start: string; end: string } {
  const start = mondayOfWeek(dateStr);
  return { start, end: sundayAfter(start) };
}

export type KpiCadence = "today" | "week" | "month" | "30" | "90" | "365";

/**
 * Resolves a KpiFilterBar cadence preset into an actual [periodStart,
 * periodEnd] Date pair for the /api/kpi dashboard — "today"/"this week"/
 * "this month" align to the same reporting rhythm the rest of the
 * platform already uses (this week always Monday-Sunday, matching the
 * weekly report period constraint), while the day-count presets stay a
 * simple rolling window from now.
 */
export function resolveCadenceRange(cadence: KpiCadence, now: Date = new Date()): { periodStart: Date; periodEnd: Date } {
  const todayStr = now.toISOString().slice(0, 10);

  if (cadence === "today") {
    return { periodStart: new Date(`${todayStr}T00:00:00.000Z`), periodEnd: now };
  }
  if (cadence === "week") {
    const { start } = weekRangeContaining(todayStr);
    return { periodStart: new Date(`${start}T00:00:00.000Z`), periodEnd: now };
  }
  if (cadence === "month") {
    const monthStart = `${todayStr.slice(0, 7)}-01`;
    return { periodStart: new Date(`${monthStart}T00:00:00.000Z`), periodEnd: now };
  }

  const days = Number(cadence);
  return { periodStart: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), periodEnd: now };
}
