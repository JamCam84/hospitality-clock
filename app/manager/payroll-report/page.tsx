"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  pay_frequency: string;
  role: string;
  branch: string;
};

type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;          // "YYYY-MM-DD"
  clock_in_time: string;      // ISO timestamp
  clock_out_time: string | null;
};

// The final row we show in the table and export to CSV
type PayrollRow = {
  employee_number: string;
  first_name: string;
  last_name: string;
  pay_frequency: string;
  role: string;
  branch: string;
  sessions_count: number;
  total_worked_minutes: number;  // raw — used for display + export
  total_break_minutes: number;   // raw — used for display + export
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

// Returns today's date as "YYYY-MM-DD" in local time
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Returns the first day of the current month as "YYYY-MM-DD"
function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ─── Calculation helpers ──────────────────────────────────────────────────────

/**
 * calcWorkedMinutes
 * Sums the duration (in minutes) of every CLOSED session (both times present).
 * Open sessions (clock_out_time is null) are deliberately excluded.
 */
function calcWorkedMinutes(sessions: ClockSession[]): number {
  return sessions
    .filter((s) => s.clock_in_time && s.clock_out_time)
    .reduce((total, s) => {
      const ms = new Date(s.clock_out_time!).getTime() - new Date(s.clock_in_time).getTime();
      return total + ms / 60_000;
    }, 0);
}

/**
 * calcBreakMinutes
 * For each work_date, sorts the CLOSED sessions by clock_in_time, then sums
 * the gaps between consecutive sessions. A gap is:
 *   next session's clock_in_time  −  previous session's clock_out_time
 * Negative gaps (data anomalies) are ignored.
 */
function calcBreakMinutes(sessions: ClockSession[]): number {
  // Only work with closed sessions
  const closed = sessions.filter((s) => s.clock_in_time && s.clock_out_time);

  // Group by work_date
  const byDate: Record<string, ClockSession[]> = {};
  for (const s of closed) {
    if (!byDate[s.work_date]) byDate[s.work_date] = [];
    byDate[s.work_date].push(s);
  }

  let totalBreakMins = 0;

  for (const date in byDate) {
    // Sort sessions on this date by when they started
    const sorted = [...byDate[date]].sort(
      (a, b) => new Date(a.clock_in_time).getTime() - new Date(b.clock_in_time).getTime()
    );

    // Gap between each consecutive pair
    for (let i = 1; i < sorted.length; i++) {
      const gapMs =
        new Date(sorted[i].clock_in_time).getTime() -
        new Date(sorted[i - 1].clock_out_time!).getTime();

      if (gapMs > 0) totalBreakMins += gapMs / 60_000;
    }
  }

  return totalBreakMins;
}

/**
 * formatHours
 * Converts minutes to a hours string rounded to 2 decimal places.
 * e.g. 90 minutes → "1.50 hrs"
 */
function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2) + " hrs";
}

// ─── CSV export helper ────────────────────────────────────────────────────────

function exportCSV(rows: PayrollRow[], dateFrom: string, dateTo: string) {
  const headers = [
    "employee_number",
    "first_name",
    "last_name",
    "pay_frequency",
    "role",
    "branch",
    "sessions_count",
    "total_worked_hours",
    "total_break_hours",
    "date_from",
    "date_to",
  ];

  const csvLines = rows.map((r) => {
    // Wrap each field in quotes to handle commas inside values (e.g. branch names)
    const fields = [
      r.employee_number,
      r.first_name,
      r.last_name,
      r.pay_frequency,
      r.role,
      r.branch,
      String(r.sessions_count),
      (r.total_worked_minutes / 60).toFixed(2),
      (r.total_break_minutes / 60).toFixed(2),
      dateFrom,
      dateTo,
    ];
    return fields.map((f) => `"${f}"`).join(",");
  });

  // \uFEFF = UTF-8 BOM — tells Excel to open the file with correct encoding
  const csv  = "\uFEFF" + [headers.join(","), ...csvLines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);

  // Trigger a browser download (appending to body ensures the click works in all browsers)
  const a       = document.createElement("a");
  a.href        = url;
  a.download    = `payroll_${dateFrom}_to_${dateTo}.csv`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PayrollReportPage() {

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [payFrequency, setPayFrequency] = useState<"all" | "weekly" | "monthly">("all");
  const [dateFrom, setDateFrom]         = useState(firstOfMonth());
  const [dateTo, setDateTo]             = useState(localToday());

  // ── Result state ─────────────────────────────────────────────────────────────
  const [rows, setRows]         = useState<PayrollRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);  // true after first successful load
  const [loadError, setLoadError] = useState("");

  // ─── Apply filters & load data ────────────────────────────────────────────────
  async function handleApply() {
    setIsLoading(true);
    setLoadError("");
    setRows([]);

    // 1. Build the staff query — filter by pay_frequency if not "all"
    let staffQuery = supabase
      .from("staff")
      .select("id, employee_number, first_name, last_name, pay_frequency, role, branch")
      .order("first_name", { ascending: true });

    if (payFrequency !== "all") {
      staffQuery = staffQuery.eq("pay_frequency", payFrequency);
    }

    // 2. Load sessions for the date range (both queries run in parallel)
    const [staffResult, sessionResult] = await Promise.all([
      staffQuery,
      supabase
        .from("clock_sessions")
        .select("id, staff_id, work_date, clock_in_time, clock_out_time")
        .gte("work_date", dateFrom)   // work_date >= dateFrom
        .lte("work_date", dateTo),    // work_date <= dateTo
    ]);

    if (staffResult.error || sessionResult.error) {
      setLoadError("Could not load data. Please try again.");
      setIsLoading(false);
      return;
    }

    const staffList  = (staffResult.data  ?? []) as StaffMember[];
    const allSessions = (sessionResult.data ?? []) as ClockSession[];

    // 3. Build one PayrollRow per staff member
    const computed: PayrollRow[] = staffList.map((staff) => {

      // Sessions belonging to this staff member in the date range
      const mySessions = allSessions.filter((s) => s.staff_id === staff.id);

      // Only count sessions where BOTH times exist
      const closedCount = mySessions.filter(
        (s) => s.clock_in_time && s.clock_out_time
      ).length;

      return {
        employee_number:      staff.employee_number ?? "",
        first_name:           staff.first_name,
        last_name:            staff.last_name,
        pay_frequency:        staff.pay_frequency ?? "",
        role:                 staff.role ?? "",
        branch:               staff.branch ?? "",
        sessions_count:       closedCount,
        total_worked_minutes: calcWorkedMinutes(mySessions),
        total_break_minutes:  calcBreakMinutes(mySessions),
      };
    });

    setRows(computed);
    setHasLoaded(true);
    setIsLoading(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 font-sans">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-stone-200 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01
                   M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-800 tracking-tight leading-tight">
              Payroll Report
            </h1>
            <p className="text-xs text-stone-400">Filter by pay type and date range, then export to CSV</p>
          </div>
        </div>
      </header>

      {/* ── Manager navigation ── */}
      <ManagerNav />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── Filter card ── */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-4">

          <h2 className="text-sm font-semibold text-stone-600 uppercase tracking-wider">Filters</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* Pay Frequency */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="payFreq">
                Pay Frequency
              </label>
              <select
                id="payFreq"
                value={payFrequency}
                onChange={(e) => setPayFrequency(e.target.value as "all" | "weekly" | "monthly")}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-800 bg-white
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
              >
                <option value="all">All staff</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="dateFrom">
                From Date
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-800
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="dateTo">
                To Date
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-800
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
              />
            </div>

          </div>

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={isLoading}
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 active:scale-95
                       disabled:opacity-60 disabled:cursor-not-allowed
                       text-white font-semibold text-sm rounded-xl px-6 py-2.5
                       transition-all duration-150 shadow-sm"
          >
            {isLoading ? "Loading…" : "Apply Filters"}
          </button>

        </section>

        {/* ── Load error ── */}
        {loadError && (
          <p className="text-center text-red-500 text-sm bg-red-50 border border-red-100 rounded-2xl px-4 py-5">
            {loadError}
          </p>
        )}

        {/* ── Loading skeletons ── */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white rounded-2xl border border-stone-200 p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-stone-200 shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-4 bg-stone-200 rounded w-40" />
                    <div className="h-3 bg-stone-100 rounded w-56" />
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="h-4 bg-stone-100 rounded w-20" />
                    <div className="h-3 bg-stone-100 rounded w-16" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Results ── */}
        {!isLoading && hasLoaded && (
          <>
            {/* Summary + export row */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-stone-500">
                {rows.length === 0
                  ? "No staff matched the selected filters."
                  : `${rows.length} staff member${rows.length !== 1 ? "s" : ""} · ${dateFrom} → ${dateTo}`}
              </p>

              {rows.length > 0 && (
                <button
                  onClick={() => exportCSV(rows, dateFrom, dateTo)}
                  className="flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700 active:scale-95
                             text-white font-semibold text-sm rounded-xl px-4 py-2
                             transition-all duration-150 shadow-sm"
                >
                  {/* Download icon */}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Export CSV
                </button>
              )}
            </div>

            {/* ── Table (scrollable on mobile) ── */}
            {rows.length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">

                    {/* Header */}
                    <thead className="bg-stone-50 border-b border-stone-200">
                      <tr>
                        {[
                          "Emp #",
                          "Name",
                          "Role",
                          "Branch",
                          "Pay",
                          "Sessions",
                          "Worked",
                          "Break",
                        ].map((col) => (
                          <th
                            key={col}
                            className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider
                                       px-4 py-3 whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    {/* Body */}
                    <tbody className="divide-y divide-stone-100">
                      {rows.map((row, i) => (
                        <tr key={i} className="hover:bg-stone-50 transition-colors">

                          {/* Employee number */}
                          <td className="px-4 py-3 text-stone-500 whitespace-nowrap font-mono text-xs">
                            {row.employee_number || "—"}
                          </td>

                          {/* Name */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-semibold text-stone-800">
                              {row.first_name} {row.last_name}
                            </p>
                          </td>

                          {/* Role */}
                          <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                            {row.role || "—"}
                          </td>

                          {/* Branch */}
                          <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                            {row.branch || "—"}
                          </td>

                          {/* Pay frequency */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="capitalize text-xs font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">
                              {row.pay_frequency || "—"}
                            </span>
                          </td>

                          {/* Sessions count */}
                          <td className="px-4 py-3 text-stone-700 text-center whitespace-nowrap">
                            {row.sessions_count}
                          </td>

                          {/* Total worked hours */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`font-semibold ${row.total_worked_minutes > 0 ? "text-emerald-600" : "text-stone-400"}`}>
                              {row.total_worked_minutes > 0
                                ? formatHours(row.total_worked_minutes)
                                : "—"}
                            </span>
                          </td>

                          {/* Total break hours */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-stone-500">
                              {row.total_break_minutes > 0
                                ? formatHours(row.total_break_minutes)
                                : "—"}
                            </span>
                          </td>

                        </tr>
                      ))}
                    </tbody>

                    {/* Footer totals */}
                    <tfoot className="bg-stone-50 border-t-2 border-stone-200">
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                          Totals
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-stone-700">
                          {rows.reduce((s, r) => s + r.sessions_count, 0)}
                        </td>
                        <td className="px-4 py-3 font-bold text-emerald-600 whitespace-nowrap">
                          {formatHours(rows.reduce((s, r) => s + r.total_worked_minutes, 0))}
                        </td>
                        <td className="px-4 py-3 font-bold text-stone-500 whitespace-nowrap">
                          {formatHours(rows.reduce((s, r) => s + r.total_break_minutes, 0))}
                        </td>
                      </tr>
                    </tfoot>

                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Prompt before first load ── */}
        {!isLoading && !hasLoaded && (
          <div className="text-center py-12 text-stone-400">
            <svg className="w-10 h-10 mx-auto mb-3 text-stone-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            <p className="text-sm">Set your filters above and tap <strong>Apply Filters</strong> to generate the report.</p>
          </div>
        )}

      </main>
    </div>
  );
}
