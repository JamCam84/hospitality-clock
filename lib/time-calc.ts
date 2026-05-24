/**
 * lib/time-calc.ts
 *
 * Shared payroll calculation helpers used across the payroll report,
 * approval page, and employee detail pages.
 *
 * All functions operate on a minimal session shape so they work with
 * any page's full ClockSession type via structural typing.
 */

// ─── Minimal session shape needed for calculations ────────────────────────────
// Your full ClockSession type will satisfy this automatically as long as it
// has at least these fields.  The optional fields below are used by the
// manager time-correction feature; existing callers that omit them still work.
export type SessionForCalc = {
  work_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  // Manager-editable time fields (optional — ignored if not present)
  break_minutes?: number | null;       // break deducted from this session
  edited_total_hours?: number | null;  // override: if set, used directly as payroll hours
};

// ─── Worked minutes ───────────────────────────────────────────────────────────

/**
 * calcWorkedMinutes
 * Sums the duration of every CLOSED session (both times present).
 * Open sessions (no clock_out_time) are excluded.
 */
export function calcWorkedMinutes(sessions: SessionForCalc[]): number {
  return sessions
    .filter((s) => s.clock_in_time && s.clock_out_time)
    .reduce((total, s) => {
      const ms =
        new Date(s.clock_out_time!).getTime() -
        new Date(s.clock_in_time!).getTime();
      return total + ms / 60_000;
    }, 0);
}

// ─── Break minutes ────────────────────────────────────────────────────────────

/**
 * calcBreakMinutes
 * For each work_date, sorts the closed sessions by clock_in_time, then
 * sums the gaps between one session's clock_out_time and the next
 * session's clock_in_time. Negative or zero gaps are ignored.
 */
export function calcBreakMinutes(sessions: SessionForCalc[]): number {
  // Only work with fully-closed sessions
  const closed = sessions.filter((s) => s.clock_in_time && s.clock_out_time);

  // Group by work date
  const byDate: Record<string, SessionForCalc[]> = {};
  for (const s of closed) {
    if (!byDate[s.work_date]) byDate[s.work_date] = [];
    byDate[s.work_date].push(s);
  }

  let totalBreakMins = 0;

  for (const date in byDate) {
    // Sort sessions on this date by start time (earliest first)
    const sorted = [...byDate[date]].sort(
      (a, b) =>
        new Date(a.clock_in_time!).getTime() -
        new Date(b.clock_in_time!).getTime()
    );

    // Gap between each consecutive pair of sessions
    for (let i = 1; i < sorted.length; i++) {
      const gapMs =
        new Date(sorted[i].clock_in_time!).getTime() -
        new Date(sorted[i - 1].clock_out_time!).getTime();

      if (gapMs > 0) totalBreakMins += gapMs / 60_000;
    }
  }

  return totalBreakMins;
}

// ─── Per-session payroll minutes ──────────────────────────────────────────────

/**
 * calcSessionFinalMinutes
 *
 * Returns the payroll-billable minutes for a single closed session.
 *
 * Priority order:
 *  1. If edited_total_hours is set → use that directly (manager override).
 *  2. Otherwise → (clock_out − clock_in) minus break_minutes.
 *  3. Open sessions (no clock_out_time) always return 0.
 *
 * The result is always >= 0 (never negative).
 *
 * Examples:
 *   { in: 08:00, out: 17:00, break_minutes: 60 }           → 480m (8 hrs)
 *   { in: 08:00, out: 17:00, edited_total_hours: 7.5 }     → 450m (7.5 hrs override)
 *   { in: 08:00, out: null  }                               → 0  (still clocked in)
 */
export function calcSessionFinalMinutes(session: SessionForCalc): number {
  // Manager override takes top priority
  if (session.edited_total_hours != null && session.edited_total_hours >= 0) {
    return session.edited_total_hours * 60;
  }
  // Open session — not counted
  if (!session.clock_in_time || !session.clock_out_time) return 0;
  const rawMins =
    (new Date(session.clock_out_time).getTime() -
      new Date(session.clock_in_time).getTime()) / 60_000;
  // Deduct explicit break (floor at 0 — can't have negative worked time)
  return Math.max(0, rawMins - (session.break_minutes ?? 0));
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Converts minutes to "X.XX hrs" string */
export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2) + " hrs";
}

/** Formats an ISO timestamp to a short local time string e.g. "08:30" */
export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Formats "YYYY-MM-DD" to e.g. "Mon, 3 Apr" using local timezone */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-").map(Number);
  const d = new Date(year, month - 1, day); // local — avoids UTC shift
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── Date string helpers ──────────────────────────────────────────────────────

/** Returns today as "YYYY-MM-DD" in the device's local timezone */
export function localToday(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Returns a Date as "YYYY-MM-DD" in local timezone */
export function toDateStr(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// ─── Pay period calculator ────────────────────────────────────────────────────

export type PayrollSettings = {
  id: string;
  monthly_cutoff_day: number;
  weekly_processing_day: string;
};

const DEFAULTS = { monthly_cutoff_day: 25, weekly_processing_day: "Friday" };
const WEEK_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

/**
 * calcPayPeriod
 * Returns the { from, to } date strings for the current pay period.
 *
 * monthly: from the cutoff day of the previous/current month to today
 * weekly:  from the last occurrence of the processing day to today
 * all:     last 30 days
 */
export function calcPayPeriod(
  settings: PayrollSettings | null,
  payType: "monthly" | "weekly" | "all"
): { from: string; to: string } {
  const s = settings ?? DEFAULTS;
  const today = new Date();
  const todayStr = toDateStr(today);

  if (payType === "monthly") {
    const cutoff = s.monthly_cutoff_day;
    const currentDay = today.getDate();
    // Period started on the cutoff day of this month (if we're past it)
    // or the cutoff day of last month (if we haven't reached it yet)
    const from =
      currentDay >= cutoff
        ? new Date(today.getFullYear(), today.getMonth(), cutoff)
        : new Date(today.getFullYear(), today.getMonth() - 1, cutoff);
    return { from: toDateStr(from), to: todayStr };
  }

  if (payType === "weekly") {
    const targetDayIdx = WEEK_DAYS.indexOf(s.weekly_processing_day);
    const todayDayIdx = today.getDay();
    // How many days since the last processing day?
    // Use `|| 7` so that when today IS the processing day, we look back 7 days
    const daysSince = (todayDayIdx - targetDayIdx + 7) % 7 || 7;
    const from = new Date(today);
    from.setDate(today.getDate() - daysSince);
    return { from: toDateStr(from), to: todayStr };
  }

  // "all" — last 30 days
  const from = new Date(today);
  from.setDate(today.getDate() - 30);
  return { from: toDateStr(from), to: todayStr };
}

// ─── Datetime-local conversion ────────────────────────────────────────────────

/**
 * Converts an ISO timestamp to the "YYYY-MM-DDTHH:MM" format required by
 * <input type="datetime-local">, in the user's local timezone.
 */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-") + "T" + [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
  ].join(":");
}

/**
 * formatEmployeeNumber
 *
 * Formats an employee number as a zero-padded 3-digit payroll ID.
 * Only the display is affected — the underlying database value is unchanged.
 *
 * Examples:
 *   "1"   → "001"
 *   "2"   → "002"
 *   "15"  → "015"
 *   "125" → "125"
 *   ""    → "—"
 *   null  → "—"
 */
export function formatEmployeeNumber(
  raw: string | null | undefined
): string {
  if (!raw || !raw.trim()) return "—";
  // If the value is numeric, pad it to 3 digits.
  // If it's already a custom string (e.g. "EMP-001"), return it unchanged.
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed.padStart(3, "0");
  }
  return trimmed;
}
