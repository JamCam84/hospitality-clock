"use client";

/**
 * app/manager/calendar-times/page.tsx
 *
 * Calendar-style timesheet view.
 * Rows = dates  |  Columns = employees  |  Cells = total hours worked.
 * Click any cell to open a side panel to view, edit, or manually add sessions.
 *
 * Row styling supports three tiers:
 *   1. Public holidays  — amber tint  (configure publicHolidays array below)
 *   2. Weekends         — violet tint (Saturday + Sunday auto-detected)
 *   3. Weekdays         — white / light stone alternating
 *
 * Each row also shows an approval status badge (Unapproved / Approved).
 * To mark rows as approved later, add their dates to the `approvedDates` Set
 * or replace `getRowStatus()` with a real database lookup.
 */

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import { isoToDatetimeLocal, localToday } from "@/lib/time-calc";
import { PageHeader } from "@/components/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  employee_number: string | null;
  pay_frequency: string | null;
  role: string | null;
  branch: string | null;
};

type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  status: string | null;
  edited: boolean | null;
  edited_by: string | null;
  edit_reason: string | null;
  manually_added: boolean | null;
  manual_add_reason: string | null;
};

type SelectedCell = {
  date: string;    // "YYYY-MM-DD"
  staffId: string; // UUID
};

/**
 * RowStatus
 * The approval state of a date row in the timesheet.
 *
 * "unapproved" — default; manager has not signed off on this day yet.
 * "approved"   — manager has reviewed and approved all entries for this day.
 *
 * To hook this up to a real database table later, replace `approvedDates`
 * and `getRowStatus()` with a Supabase query and a state variable.
 */
type RowStatus = "unapproved" | "approved";

// ─── Shared input style ───────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 " +
  "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent " +
  "transition placeholder:text-gray-400";

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC HOLIDAYS
// ───────────────────────────────────────────────────────────────────────────────
// Add date strings in "YYYY-MM-DD" format to highlight public holidays.
//
// Example:
//   const publicHolidays: string[] = [
//     "2026-04-17", // Good Friday
//     "2026-04-20", // Easter Monday
//     "2026-05-01", // Workers Day
//   ];
//
// Later you can replace this static array with a Supabase fetch, a config file,
// or a country-specific holidays API.
// ═══════════════════════════════════════════════════════════════════════════════

const publicHolidays: string[] = [];

/**
 * isPublicHoliday
 * Returns true when the given date string is in the publicHolidays list.
 * O(1) once the Set is built at module load.
 */
const publicHolidaySet = new Set(publicHolidays);
function isPublicHoliday(dateStr: string): boolean {
  return publicHolidaySet.has(dateStr);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROW APPROVAL STATUS
// ───────────────────────────────────────────────────────────────────────────────
// Each date row can be marked as "approved" or "unapproved".
// Right now all rows default to "unapproved".
//
// To approve a date later, you can:
//   1. Add the date string to `approvedDates` here (quick, local-only), OR
//   2. Replace `getRowStatus()` with a lookup against a Supabase table such as:
//        SELECT * FROM timesheet_approvals WHERE work_date = ?
//
// The badge rendering in the grid reads from `getRowStatus()` so only
// that one function needs to change when you build real approval logic.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * approvedDates
 * A Set of "YYYY-MM-DD" strings that have been approved.
 * Populate this from a database query when you implement real approval.
 */
const approvedDates: Set<string> = new Set();

/**
 * getRowStatus
 * Returns the approval status for a given date row.
 * Falls back to "unapproved" when the date is not found in approvedDates.
 */
function getRowStatus(dateStr: string): RowStatus {
  return approvedDates.has(dateStr) ? "approved" : "unapproved";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROW STYLE SYSTEM
// ───────────────────────────────────────────────────────────────────────────────
// Three row types, each with its own colour palette.
// Priority: holiday > weekend > weekday
// ═══════════════════════════════════════════════════════════════════════════════

type RowType = "holiday" | "weekend" | "weekday-even" | "weekday-odd";

/**
 * getRowType
 * Determines which visual category a date falls into.
 * Public holidays take priority over weekend detection.
 */
function getRowType(dateStr: string, rowIdx: number): RowType {
  if (isPublicHoliday(dateStr)) return "holiday";
  if (isWeekend(dateStr))       return "weekend";
  return rowIdx % 2 === 0 ? "weekday-even" : "weekday-odd";
}

/**
 * ROW_PALETTE
 * Maps each RowType to the Tailwind classes used in that row.
 *
 * stickyBg   — solid background for sticky cells (prevents bleed-through).
 * rowBg      — background for the whole <tr>.
 * leftAccent — coloured left border on the Date sticky cell (visual anchor).
 * dateText   — colour for the date label.
 * dayText    — colour for the weekday abbreviation.
 * emptyCell  — background for employee cells that have 0 hours.
 */
const ROW_PALETTE: Record<
  RowType,
  {
    stickyBg:   string;
    rowBg:      string;
    leftAccent: string;
    dateText:   string;
    dayText:    string;
    emptyCell:  string;
  }
> = {
  holiday: {
    stickyBg:   "bg-amber-50",
    rowBg:      "bg-amber-50/60",
    leftAccent: "border-l-4 border-amber-400",
    dateText:   "text-amber-700",
    dayText:    "text-amber-600",
    emptyCell:  "hover:bg-amber-50",
  },
  weekend: {
    stickyBg:   "bg-violet-50",
    rowBg:      "bg-violet-50/50",
    leftAccent: "border-l-4 border-violet-300",
    dateText:   "text-violet-700",
    dayText:    "text-violet-500",
    emptyCell:  "hover:bg-violet-100/50",
  },
  "weekday-even": {
    stickyBg:   "bg-white",
    rowBg:      "bg-white",
    leftAccent: "",
    dateText:   "text-stone-700",
    dayText:    "text-stone-500",
    emptyCell:  "hover:bg-stone-50",
  },
  "weekday-odd": {
    stickyBg:   "bg-stone-50",
    rowBg:      "bg-stone-50/80",
    leftAccent: "",
    dateText:   "text-stone-700",
    dayText:    "text-stone-500",
    emptyCell:  "hover:bg-stone-100",
  },
};

// ─── Date / time helper functions ─────────────────────────────────────────────

/**
 * getDateRange
 * Returns every calendar date (as "YYYY-MM-DD") from `from` to `to` inclusive.
 * Dates are built in the device's local timezone to avoid UTC midnight shifts.
 */
function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from + "T00:00:00");
  const end     = new Date(to   + "T00:00:00");
  while (current <= end) {
    dates.push(toLocalDateStr(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Convert a Date to "YYYY-MM-DD" in local timezone. */
function toLocalDateStr(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** True when the date string falls on a Saturday (6) or Sunday (0). */
function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

/** Returns abbreviated weekday name: "Mon", "Tue", etc. */
function formatWeekday(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short" });
}

/** Returns a compact date label: "3 Apr". */
function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}

/** Returns a fuller label: "Wed, 3 Apr 2026". */
function formatLongDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * groupByDateAndEmployee
 * Builds a two-level lookup: { work_date → { staff_id → ClockSession[] } }
 * so grid cells can find their sessions in O(1).
 */
function groupByDateAndEmployee(
  sessions: ClockSession[]
): Record<string, Record<string, ClockSession[]>> {
  const result: Record<string, Record<string, ClockSession[]>> = {};
  for (const s of sessions) {
    if (!result[s.work_date])             result[s.work_date] = {};
    if (!result[s.work_date][s.staff_id]) result[s.work_date][s.staff_id] = [];
    result[s.work_date][s.staff_id].push(s);
  }
  return result;
}

/**
 * calcCellHours
 * Sums total worked hours for a set of sessions on one date for one employee.
 * Only CLOSED sessions (both clock_in_time and clock_out_time present) count.
 */
function calcCellHours(sessions: ClockSession[]): number {
  const totalMins = sessions
    .filter((s) => s.clock_in_time && s.clock_out_time)
    .reduce((sum, s) => {
      const ms =
        new Date(s.clock_out_time!).getTime() -
        new Date(s.clock_in_time!).getTime();
      return sum + ms / 60_000;
    }, 0);
  return totalMins / 60;
}

/** Formats an ISO timestamp to a short local time string: "08:30". */
function fmt12(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Formats total minutes as "Xh Ym". */
function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Default start date: first calendar day of the current month. */
function firstOfMonth(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarTimesPage() {

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [dateFrom,     setDateFrom]     = useState(firstOfMonth());
  const [dateTo,       setDateTo]       = useState(localToday());
  const [payFrequency, setPayFrequency] = useState<"all" | "monthly" | "weekly">("all");

  // ── Data state ───────────────────────────────────────────────────────────────
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [sessions,  setSessions]  = useState<ClockSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  // ── Selected cell (drives the side panel) ────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  // ── Edit session state ────────────────────────────────────────────────────────
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editIn,           setEditIn]           = useState("");
  const [editOut,          setEditOut]          = useState("");
  const [editReason,       setEditReason]       = useState("");
  const [isSavingEdit,     setIsSavingEdit]     = useState(false);
  const [editMessage,      setEditMessage]      = useState("");
  const [editIsError,      setEditIsError]      = useState(false);

  // ── Manual add state ──────────────────────────────────────────────────────────
  const [manualIn,       setManualIn]       = useState("");
  const [manualOut,      setManualOut]      = useState("");
  const [manualReason,   setManualReason]   = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [manualMessage,  setManualMessage]  = useState("");
  const [manualIsError,  setManualIsError]  = useState(false);

  // ── Load data from Supabase ───────────────────────────────────────────────────

  const loadData = useCallback(async (from: string, to: string, freq: string) => {
    if (!from || !to) return;
    setIsLoading(true);
    setLoadError("");

    let staffQuery = supabase
      .from("staff")
      .select("id, first_name, last_name, employee_number, pay_frequency, role, branch")
      .order("first_name", { ascending: true });

    if (freq !== "all") {
      staffQuery = staffQuery.eq("pay_frequency", freq);
    }

    const [staffResult, sessionResult] = await Promise.all([
      staffQuery,
      supabase
        .from("clock_sessions")
        .select(
          "id, staff_id, work_date, clock_in_time, clock_out_time, status, " +
          "edited, edited_by, edit_reason, manually_added, manual_add_reason"
        )
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date",     { ascending: true })
        .order("clock_in_time", { ascending: true }),
    ]);

    if (staffResult.error || sessionResult.error) {
      setLoadError("Could not load data. Check your connection and try again.");
    } else {
      setStaffList((staffResult.data  ?? []) as StaffMember[]);
      setSessions( (sessionResult.data ?? []) as ClockSession[]);
    }

    setHasLoaded(true);
    setIsLoading(false);
  }, []);

  // Auto-load on mount
  useEffect(() => {
    loadData(dateFrom, dateTo, payFrequency);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleLoad() {
    setSelectedCell(null);
    cancelEdit();
    loadData(dateFrom, dateTo, payFrequency);
  }

  function handleCellClick(date: string, staffId: string) {
    if (selectedCell?.date === date && selectedCell?.staffId === staffId) {
      setSelectedCell(null);
      return;
    }
    setSelectedCell({ date, staffId });
    cancelEdit();
    setManualIn("");
    setManualOut("");
    setManualReason("");
    setManualMessage("");
    setEditMessage("");
  }

  function closePanel() {
    setSelectedCell(null);
    cancelEdit();
  }

  // ── Session edit ─────────────────────────────────────────────────────────────

  function startEdit(session: ClockSession) {
    setEditingSessionId(session.id);
    setEditIn(isoToDatetimeLocal(session.clock_in_time));
    setEditOut(isoToDatetimeLocal(session.clock_out_time));
    setEditReason("");
    setEditMessage("");
  }

  function cancelEdit() {
    setEditingSessionId(null);
    setEditIn("");
    setEditOut("");
    setEditReason("");
    setEditMessage("");
  }

  async function handleSaveEdit(session: ClockSession) {
    if (!editIn) {
      setEditMessage("Clock-in time is required.");
      setEditIsError(true);
      return;
    }
    if (!editReason.trim()) {
      setEditMessage("A reason for the edit is required.");
      setEditIsError(true);
      return;
    }

    const newClockIn  = new Date(editIn).toISOString();
    const newClockOut = editOut ? new Date(editOut).toISOString() : null;

    if (newClockOut && new Date(newClockOut) <= new Date(newClockIn)) {
      setEditMessage("Clock-out must be after clock-in.");
      setEditIsError(true);
      return;
    }

    setIsSavingEdit(true);
    setEditMessage("");

    // 1. Update clock_sessions row
    const { error: updateError } = await supabase
      .from("clock_sessions")
      .update({
        clock_in_time:  newClockIn,
        clock_out_time: newClockOut,
        status:         newClockOut ? "clocked_out" : "clocked_in",
        edited:         true,
        edited_by:      "Manager",
        edited_at:      new Date().toISOString(),
        edit_reason:    editReason.trim(),
      })
      .eq("id", session.id);

    if (updateError) {
      setEditMessage("Error saving: " + updateError.message);
      setEditIsError(true);
      setIsSavingEdit(false);
      return;
    }

    // 2. Write to audit log
    await supabase.from("time_edit_log").insert({
      clock_session_id:   session.id,
      staff_id:           session.staff_id,
      old_clock_in_time:  session.clock_in_time,
      old_clock_out_time: session.clock_out_time,
      new_clock_in_time:  newClockIn,
      new_clock_out_time: newClockOut,
      action_type:        "edit",
      changed_by:         "Manager",
      reason:             editReason.trim(),
    });

    // 3. Update local state — avoids a full reload
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== session.id
          ? s
          : {
              ...s,
              clock_in_time:  newClockIn,
              clock_out_time: newClockOut,
              status:         newClockOut ? "clocked_out" : "clocked_in",
              edited:         true,
              edited_by:      "Manager",
              edit_reason:    editReason.trim(),
            }
      )
    );

    cancelEdit();
    setIsSavingEdit(false);
    setEditMessage("Session updated.");
    setEditIsError(false);
  }

  // ── Manual add ────────────────────────────────────────────────────────────────

  async function handleManualAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCell) return;

    if (!manualIn) {
      setManualMessage("Clock-in time is required.");
      setManualIsError(true);
      return;
    }
    if (!manualReason.trim()) {
      setManualMessage("A reason is required.");
      setManualIsError(true);
      return;
    }

    const { date, staffId } = selectedCell;
    const clockInISO  = new Date(`${date}T${manualIn}:00`).toISOString();
    const clockOutISO = manualOut
      ? new Date(`${date}T${manualOut}:00`).toISOString()
      : null;

    if (clockOutISO && new Date(clockOutISO) <= new Date(clockInISO)) {
      setManualMessage("Clock-out must be after clock-in.");
      setManualIsError(true);
      return;
    }

    setIsSavingManual(true);
    setManualMessage("");

    const { data: newRow, error: insertError } = await supabase
      .from("clock_sessions")
      .insert({
        staff_id:          staffId,
        work_date:         date,
        clock_in_time:     clockInISO,
        clock_out_time:    clockOutISO,
        status:            clockOutISO ? "clocked_out" : "clocked_in",
        manually_added:    true,
        manual_add_reason: manualReason.trim(),
      })
      .select()
      .single();

    if (insertError) {
      setManualMessage("Error adding entry: " + insertError.message);
      setManualIsError(true);
      setIsSavingManual(false);
      return;
    }

    await supabase.from("time_edit_log").insert({
      clock_session_id:  (newRow as ClockSession).id,
      staff_id:          staffId,
      new_clock_in_time: clockInISO,
      new_clock_out_time: clockOutISO,
      action_type:       "manual_add",
      changed_by:        "Manager",
      reason:            manualReason.trim(),
    });

    setSessions((prev) => [...prev, newRow as ClockSession]);

    setManualIn("");
    setManualOut("");
    setManualReason("");
    setManualMessage("Session added.");
    setManualIsError(false);
    setIsSavingManual(false);
  }

  // ── Derived grid data ─────────────────────────────────────────────────────────

  const dateRange = hasLoaded ? getDateRange(dateFrom, dateTo) : [];
  const grouped   = groupByDateAndEmployee(sessions);

  const panelStaff = staffList.find((s) => s.id === selectedCell?.staffId) ?? null;
  const panelSessions: ClockSession[] = selectedCell
    ? (grouped[selectedCell.date]?.[selectedCell.staffId] ?? [])
    : [];

  function employeePeriodHours(staffId: string): number {
    return sessions
      .filter((s) => s.staff_id === staffId && s.clock_in_time && s.clock_out_time)
      .reduce((sum, s) => {
        const ms =
          new Date(s.clock_out_time!).getTime() -
          new Date(s.clock_in_time!).getTime();
        return sum + ms / 60_000;
      }, 0) / 60;
  }

  const grandTotalHours = staffList.reduce(
    (sum, s) => sum + employeePeriodHours(s.id),
    0
  );

  // Quick counts for the legend bar
  const weekendCount = dateRange.filter(isWeekend).length;
  const holidayCount = dateRange.filter(isPublicHoliday).length;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      <PageHeader
        title="Calendar Timesheet"
        subtitle="Hours per employee per day — click any cell to edit"
        right={
          <Link
            href="/manager/approval"
            className="flex items-center gap-1.5 text-xs font-semibold text-white/80
                       hover:text-white hover:bg-white/20 border border-white/30
                       rounded-xl px-3 py-2 transition-all duration-150"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}
              viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Approval
          </Link>
        }
      />

      <ManagerNav />

      <main className="max-w-[100vw] px-4 py-6 space-y-5">

        {/* ══ Filters ══════════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Date Range &amp; Filters
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pay Type</label>
              <select
                value={payFrequency}
                onChange={(e) =>
                  setPayFrequency(e.target.value as "all" | "monthly" | "weekly")
                }
                className={inputCls}
              >
                <option value="all">All staff</option>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <button
                onClick={handleLoad}
                disabled={isLoading}
                className="w-full bg-green-500 hover:bg-green-600 active:scale-95
                           disabled:opacity-60 disabled:cursor-not-allowed text-white
                           font-semibold text-sm rounded-xl px-5 py-2.5 transition-all
                           duration-150 shadow-sm"
              >
                {isLoading ? "Loading…" : "Load"}
              </button>
            </div>
          </div>

          {/* Period summary */}
          {hasLoaded && !isLoading && (
            <div className="flex flex-wrap gap-4 mt-4 text-xs text-stone-500">
              <span>
                <span className="font-semibold text-stone-700">{dateRange.length}</span> days
              </span>
              <span>
                <span className="font-semibold text-stone-700">{staffList.length}</span> employees
              </span>
              <span>
                <span className="font-semibold text-stone-700">{sessions.length}</span> sessions
              </span>
              {weekendCount > 0 && (
                <span className="text-violet-500">
                  <span className="font-semibold">{weekendCount}</span> weekend days
                </span>
              )}
              {holidayCount > 0 && (
                <span className="text-amber-600">
                  <span className="font-semibold">{holidayCount}</span> public holiday
                  {holidayCount !== 1 ? "s" : ""}
                </span>
              )}
              <span>
                Total:{" "}
                <span className="font-semibold text-emerald-700">
                  {grandTotalHours.toFixed(2)} hrs
                </span>
              </span>
            </div>
          )}
        </section>

        {/* Load error */}
        {loadError && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-100
                        rounded-2xl px-4 py-4 text-center">
            {loadError}
          </p>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="animate-pulse space-y-2">
            <div className="bg-white rounded-2xl border border-stone-200 h-12" />
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n}
                className="bg-white rounded-2xl border border-stone-200 h-10 flex gap-4 px-5 py-3">
                <div className="h-4 bg-stone-100 rounded w-20" />
                <div className="h-4 bg-stone-100 rounded w-12" />
                <div className="flex-1 h-4 bg-stone-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Empty states */}
        {hasLoaded && !isLoading && dateRange.length === 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm px-5 py-14
                          text-center text-stone-400 text-sm">
            No date range selected. Choose a start and end date above and click Load.
          </div>
        )}
        {hasLoaded && !isLoading && dateRange.length > 0 && staffList.length === 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm px-5 py-14
                          text-center text-stone-400 text-sm">
            No employees found for the selected pay type.
          </div>
        )}

        {/* ══ Timesheet Grid ═══════════════════════════════════════════════════ */}
        {hasLoaded && !isLoading && dateRange.length > 0 && staffList.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

            {/* ── Legend / hint bar ── */}
            <div className="px-5 py-3 border-b border-gray-50 flex items-center
                            justify-between gap-4 flex-wrap">
              <p className="text-xs text-gray-400 shrink-0">
                Click any cell to view and edit sessions.
              </p>

              {/* Colour legend */}
              <div className="flex items-center gap-4 flex-wrap text-xs text-stone-500">
                <LegendDot color="bg-emerald-200 border-emerald-400" label="Has hours" />
                <LegendDot color="bg-violet-100 border-violet-300" label="Weekend" />
                <LegendDot color="bg-amber-100 border-amber-400"   label="Public holiday" />
                <LegendDot color="bg-sky-100 border-sky-400"       label="Selected" />

                {/* Approval status legend */}
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                                   bg-stone-100 text-stone-500 border border-stone-200">
                    Unapproved
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                                   bg-emerald-100 text-emerald-700 border border-emerald-300">
                    Approved
                  </span>
                </span>
              </div>
            </div>

            {/* ── Horizontally scrollable table ── */}
            <div className="overflow-x-auto">
              <table
                className="border-collapse text-sm"
                style={{ minWidth: `${260 + staffList.length * 96}px` }}
              >

                {/* ── Column headers ── */}
                <thead className="bg-gray-50">
                  <tr className="border-b border-gray-100">

                    {/* Date — sticky col 1 */}
                    <th
                      className="sticky left-0 z-20 bg-gray-50 border-r border-gray-100
                                 px-4 py-3 text-left text-xs font-semibold text-gray-500
                                 uppercase tracking-wider whitespace-nowrap"
                      style={{ minWidth: "8.5rem" }}
                    >
                      Date
                    </th>

                    {/* Day — sticky col 2 */}
                    <th
                      className="sticky z-20 bg-gray-50 border-r border-gray-100
                                 px-3 py-3 text-left text-xs font-semibold text-gray-500
                                 uppercase tracking-wider whitespace-nowrap"
                      style={{ left: "8.5rem", minWidth: "3.5rem" }}
                    >
                      Day
                    </th>

                    {/* Status — sticky col 3 */}
                    <th
                      className="sticky z-20 bg-gray-50 border-r border-gray-100
                                 px-3 py-3 text-left text-xs font-semibold text-gray-500
                                 uppercase tracking-wider whitespace-nowrap"
                      style={{ left: "12rem", minWidth: "6rem" }}
                    >
                      Status
                    </th>

                    {/* One column per employee */}
                    {staffList.map((staff) => (
                      <th
                        key={staff.id}
                        className="px-3 py-3 text-center text-xs font-semibold
                                   text-gray-600 whitespace-nowrap border-l border-gray-100"
                        style={{ minWidth: "6rem" }}
                      >
                        <div
                          className="font-semibold text-stone-700 truncate max-w-[80px] mx-auto"
                          title={`${staff.first_name ?? ""} ${staff.last_name ?? ""}`}
                        >
                          {staff.first_name ?? ""}
                        </div>
                        <div className="font-normal text-stone-400 text-[10px] truncate
                                        max-w-[80px] mx-auto">
                          {staff.employee_number ?? staff.last_name ?? ""}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* ── Date rows ── */}
                <tbody>
                  {dateRange.map((date, rowIdx) => {
                    const rowType  = getRowType(date, rowIdx);
                    const palette  = ROW_PALETTE[rowType];
                    const status   = getRowStatus(date);
                    const holiday  = isPublicHoliday(date);

                    return (
                      <tr
                        key={date}
                        className={`border-b border-stone-100 ${palette.rowBg}`}
                      >

                        {/* ── Date cell (sticky col 1) ── */}
                        <td
                          className={`sticky left-0 z-10 border-r border-stone-200 px-4 py-2.5
                                      whitespace-nowrap ${palette.stickyBg} ${palette.leftAccent}`}
                          style={{ minWidth: "8.5rem" }}
                        >
                          <p className={`text-xs font-bold leading-tight ${palette.dateText}`}>
                            {formatShortDate(date)}
                          </p>
                          <p className="text-[10px] text-stone-400 font-mono mt-0.5">{date}</p>
                          {/* Public holiday label (only shown when configured) */}
                          {holiday && (
                            <span className="inline-block mt-1 text-[9px] font-semibold
                                             px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800">
                              Public Holiday
                            </span>
                          )}
                        </td>

                        {/* ── Day cell (sticky col 2) ── */}
                        <td
                          className={`sticky z-10 border-r border-stone-200 px-3 py-2.5
                                      text-xs font-semibold whitespace-nowrap
                                      ${palette.stickyBg} ${palette.dayText}`}
                          style={{ left: "8.5rem", minWidth: "3.5rem" }}
                        >
                          {formatWeekday(date)}
                        </td>

                        {/* ── Status cell (sticky col 3) ── */}
                        <td
                          className={`sticky z-10 border-r border-stone-200 px-3 py-2.5
                                      whitespace-nowrap ${palette.stickyBg}`}
                          style={{ left: "12rem", minWidth: "6rem" }}
                        >
                          <RowStatusBadge status={status} />
                        </td>

                        {/* ── Employee hour cells ── */}
                        {staffList.map((staff) => {
                          const cellSessions = grouped[date]?.[staff.id] ?? [];
                          const hours        = calcCellHours(cellSessions);
                          const hasHours     = hours > 0;
                          const isOpen       = cellSessions.some(
                            (s) => s.clock_in_time && !s.clock_out_time
                          );
                          const isSelected   =
                            selectedCell?.date === date &&
                            selectedCell?.staffId === staff.id;
                          const hasEdited    = cellSessions.some(
                            (s) => s.edited || s.manually_added
                          );

                          // Layer cell background: selected > has-hours > row-default
                          let cellBg: string;
                          if (isSelected) {
                            cellBg = "bg-sky-100 ring-2 ring-inset ring-sky-400";
                          } else if (hasHours) {
                            cellBg = "bg-emerald-50 hover:bg-emerald-100";
                          } else {
                            cellBg = palette.emptyCell;
                          }

                          return (
                            <td
                              key={staff.id}
                              onClick={() => handleCellClick(date, staff.id)}
                              className={`cursor-pointer transition-all duration-100
                                          border-l border-stone-100 px-2 py-2.5 text-center
                                          ${cellBg}`}
                              style={{ minWidth: "6rem" }}
                            >
                              {hasHours ? (
                                <div>
                                  <p className={`text-sm font-bold leading-tight
                                    ${isSelected ? "text-sky-700" : "text-emerald-700"}`}>
                                    {hours.toFixed(2)}
                                  </p>
                                  <p className="text-[10px] text-stone-400 leading-tight">hrs</p>
                                  {/* Mini status chips inside the cell */}
                                  <div className="flex justify-center gap-0.5 mt-1 flex-wrap">
                                    {isOpen && (
                                      <span className="text-[9px] px-1 rounded-full
                                                       bg-amber-100 text-amber-600 font-medium">
                                        open
                                      </span>
                                    )}
                                    {hasEdited && (
                                      <span className="text-[9px] px-1 rounded-full
                                                       bg-sky-100 text-sky-600 font-medium">
                                        edited
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-stone-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>

                {/* ── Period totals footer ── */}
                <tfoot className="bg-gray-100 border-t-2 border-gray-200">
                  <tr>
                    {/* Sticky label */}
                    <td
                      className="sticky left-0 z-10 bg-gray-100 border-r border-gray-200
                                 px-4 py-3 text-xs font-bold text-gray-600 uppercase
                                 tracking-wider whitespace-nowrap"
                      style={{ minWidth: "8.5rem" }}
                    >
                      Period Total
                    </td>
                    {/* Sticky day cell (empty) */}
                    <td
                      className="sticky z-10 bg-gray-100 border-r border-gray-200 px-3 py-3"
                      style={{ left: "8.5rem", minWidth: "3.5rem" }}
                    />
                    {/* Sticky status cell (empty) */}
                    <td
                      className="sticky z-10 bg-gray-100 border-r border-gray-200 px-3 py-3"
                      style={{ left: "12rem", minWidth: "6rem" }}
                    />
                    {/* Per-employee totals */}
                    {staffList.map((staff) => {
                      const total = employeePeriodHours(staff.id);
                      return (
                        <td
                          key={staff.id}
                          className="px-2 py-3 text-center border-l border-gray-200"
                          style={{ minWidth: "6rem" }}
                        >
                          {total > 0 ? (
                            <span className="text-sm font-bold text-emerald-700">
                              {total.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">0</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>

              </table>
            </div>
          </section>
        )}

      </main>

      {/* ══ Side Panel ══════════════════════════════════════════════════════════ */}
      {selectedCell && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30 bg-black/25 backdrop-blur-[1px]"
            onClick={closePanel}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-md
                          bg-white shadow-2xl flex flex-col overflow-hidden">

            {/* Panel header */}
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4
                            border-b border-gray-100">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
                  Editing
                </p>
                <h2 className="text-base font-bold text-gray-800 leading-tight">
                  {panelStaff
                    ? `${panelStaff.first_name ?? ""} ${panelStaff.last_name ?? ""}`
                    : "—"}
                </h2>
                <p className="text-sm text-stone-500 mt-0.5">
                  {formatLongDate(selectedCell.date)}
                  {isPublicHoliday(selectedCell.date) && (
                    <span className="ml-2 text-xs font-semibold text-amber-600">
                      Public Holiday
                    </span>
                  )}
                  {isWeekend(selectedCell.date) && !isPublicHoliday(selectedCell.date) && (
                    <span className="ml-2 text-xs font-semibold text-violet-500">
                      Weekend
                    </span>
                  )}
                </p>
                {panelStaff?.employee_number && (
                  <p className="text-xs text-stone-400 font-mono mt-0.5">
                    #{panelStaff.employee_number}
                    {panelStaff.role ? ` · ${panelStaff.role}` : ""}
                  </p>
                )}
              </div>
              <button
                onClick={closePanel}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                           text-gray-400 hover:bg-gray-100 hover:text-gray-700
                           transition-colors mt-1"
                aria-label="Close panel"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}
                  viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

              {/* ── A. Existing sessions ── */}
              <div>
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
                  Sessions this day
                  {panelSessions.length > 0 && (
                    <span className="ml-2 font-bold text-emerald-600">
                      {calcCellHours(panelSessions).toFixed(2)} hrs
                    </span>
                  )}
                </p>

                {panelSessions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6
                                  text-sm text-gray-400 text-center">
                    No sessions recorded for this date.
                    <br />
                    <span className="text-xs">Use the form below to add one.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {panelSessions.map((session) => {
                      const isEditing = editingSessionId === session.id;
                      const closedMins =
                        session.clock_in_time && session.clock_out_time
                          ? (new Date(session.clock_out_time).getTime() -
                              new Date(session.clock_in_time).getTime()) / 60_000
                          : null;

                      return (
                        <div key={session.id}
                          className="rounded-xl border border-stone-200 overflow-hidden">

                          {/* Display view */}
                          {!isEditing && (
                            <div className="px-4 py-3 space-y-2">
                              <div className="flex items-center gap-4 flex-wrap">
                                <div>
                                  <p className="text-[10px] text-stone-400 uppercase tracking-wide">
                                    Clock In
                                  </p>
                                  <p className="text-sm font-semibold text-stone-800">
                                    {fmt12(session.clock_in_time)}
                                  </p>
                                </div>
                                <div className="text-stone-300">→</div>
                                <div>
                                  <p className="text-[10px] text-stone-400 uppercase tracking-wide">
                                    Clock Out
                                  </p>
                                  <p className={`text-sm font-semibold ${
                                    session.clock_out_time ? "text-stone-800" : "text-amber-500"
                                  }`}>
                                    {session.clock_out_time
                                      ? fmt12(session.clock_out_time)
                                      : "Still in"}
                                  </p>
                                </div>
                                {closedMins !== null && (
                                  <div className="ml-auto">
                                    <p className="text-[10px] text-stone-400 uppercase tracking-wide">
                                      Duration
                                    </p>
                                    <p className="text-sm font-semibold text-emerald-700">
                                      {fmtDuration(closedMins)}
                                    </p>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                {session.edited && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5
                                                   rounded-full bg-sky-100 text-sky-700">
                                    Edited
                                  </span>
                                )}
                                {session.manually_added && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5
                                                   rounded-full bg-violet-100 text-violet-700">
                                    Manual
                                  </span>
                                )}
                                <button
                                  onClick={() => startEdit(session)}
                                  className="ml-auto text-xs font-semibold text-stone-500
                                             hover:text-sky-700 hover:bg-sky-50 border border-stone-200
                                             hover:border-sky-200 rounded-lg px-2.5 py-1
                                             transition-all duration-150"
                                >
                                  Edit
                                </button>
                              </div>

                              {session.edit_reason && (
                                <p className="text-[11px] text-stone-400">
                                  Edit reason:{" "}
                                  <span className="italic">{session.edit_reason}</span>
                                </p>
                              )}
                              {session.manual_add_reason && (
                                <p className="text-[11px] text-stone-400">
                                  Manual reason:{" "}
                                  <span className="italic">{session.manual_add_reason}</span>
                                </p>
                              )}
                            </div>
                          )}

                          {/* Inline edit form */}
                          {isEditing && (
                            <div className="px-4 py-4 bg-sky-50 border-l-4 border-sky-400">
                              <p className="text-xs font-bold text-sky-700 uppercase
                                            tracking-wider mb-3">
                                Editing session
                              </p>
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-xs font-medium text-stone-600 mb-1">
                                    Clock In *
                                  </label>
                                  <input
                                    type="datetime-local"
                                    value={editIn}
                                    onChange={(e) => setEditIn(e.target.value)}
                                    className={inputCls}
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-stone-600 mb-1">
                                    Clock Out
                                  </label>
                                  <input
                                    type="datetime-local"
                                    value={editOut}
                                    onChange={(e) => setEditOut(e.target.value)}
                                    className={inputCls}
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-stone-600 mb-1">
                                    Reason *
                                  </label>
                                  <input
                                    type="text"
                                    value={editReason}
                                    onChange={(e) => setEditReason(e.target.value)}
                                    placeholder="e.g. Employee forgot to clock out"
                                    className={inputCls}
                                  />
                                </div>

                                {editMessage && (
                                  <p className={`text-xs font-medium rounded-lg px-3 py-2 ${
                                    editIsError
                                      ? "bg-red-50 text-red-600"
                                      : "bg-emerald-50 text-emerald-700"
                                  }`}>
                                    {editMessage}
                                  </p>
                                )}

                                <div className="flex gap-2 pt-1">
                                  <button
                                    onClick={() => handleSaveEdit(session)}
                                    disabled={isSavingEdit}
                                    className="bg-sky-600 hover:bg-sky-700 text-white font-semibold
                                               text-xs rounded-lg px-4 py-2 transition-colors
                                               disabled:opacity-50"
                                  >
                                    {isSavingEdit ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    disabled={isSavingEdit}
                                    className="text-stone-500 hover:text-stone-700 text-xs
                                               font-medium px-3 py-2 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Edit success message */}
                {!editingSessionId && editMessage && !editIsError && (
                  <p className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg
                                px-3 py-2 mt-2">
                    {editMessage}
                  </p>
                )}
              </div>

              {/* ── B. Manual add form ── */}
              <div>
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
                  Add a session manually
                </p>
                <form
                  onSubmit={handleManualAdd}
                  className="rounded-xl border border-dashed border-violet-300 bg-violet-50/40
                             px-4 py-4 space-y-3"
                >
                  <p className="text-xs text-stone-400">
                    This entry will be marked{" "}
                    <span className="font-medium text-violet-600">Manual</span> and
                    logged in the audit trail.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Clock In *
                      </label>
                      <input
                        type="time"
                        value={manualIn}
                        onChange={(e) => setManualIn(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Clock Out
                        <span className="text-stone-400 font-normal ml-1">(opt)</span>
                      </label>
                      <input
                        type="time"
                        value={manualOut}
                        onChange={(e) => setManualOut(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">
                      Reason *
                    </label>
                    <input
                      type="text"
                      value={manualReason}
                      onChange={(e) => setManualReason(e.target.value)}
                      placeholder="e.g. Forgot to clock in"
                      className={inputCls}
                    />
                  </div>

                  {manualMessage && (
                    <p className={`text-xs font-medium rounded-lg px-3 py-2 ${
                      manualIsError
                        ? "bg-red-50 text-red-600"
                        : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {manualMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSavingManual}
                    className="w-full bg-violet-600 hover:bg-violet-700 active:scale-95
                               disabled:opacity-60 disabled:cursor-not-allowed text-white
                               font-semibold text-sm rounded-xl py-2.5 transition-all
                               duration-150 shadow-sm"
                  >
                    {isSavingManual ? "Adding…" : "Add Session"}
                  </button>
                </form>
              </div>

            </div>{/* end scrollable body */}
          </div>
        </>
      )}

    </div>
  );
}

// ─── Small render helpers ─────────────────────────────────────────────────────

/**
 * LegendDot
 * A colour swatch + label used in the legend bar above the grid.
 */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-sm border inline-block shrink-0 ${color}`} />
      {label}
    </span>
  );
}

/**
 * RowStatusBadge
 * Shows the approval state for a date row.
 *
 * "unapproved" — neutral gray chip.
 * "approved"   — emerald green chip.
 *
 * To hook up real approval toggling later, make this a <button> and wire
 * it to a Supabase UPDATE on a `timesheet_approvals` table.
 */
function RowStatusBadge({ status }: { status: RowStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1
                       rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300
                       whitespace-nowrap">
        {/* Checkmark icon */}
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={3}
          viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Approved
      </span>
    );
  }

  // Default: unapproved
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1
                     rounded-full bg-gray-100 text-gray-500 border border-gray-200
                     whitespace-nowrap">
      {/* Clock / pending icon */}
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5}
        viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 7v5l3 3" />
      </svg>
      Unapproved
    </span>
  );
}
