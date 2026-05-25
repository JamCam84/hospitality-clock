"use client";

import { useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import {
  calcSessionFinalMinutes,
  formatHours,
  formatEmployeeNumber,
  localToday,
  toDateStr,
} from "@/lib/time-calc";
import { useCurrentUser } from "@/lib/useCurrentUser";

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

// Includes approval + time-correction columns needed for accurate hour calculation.
// Uses toSession() mapper to avoid GenericStringError for migration-added columns.
type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  approved: boolean;
  break_minutes: number | null;
  edited_total_hours: number | null;
};

// Safe row mapper — bypasses Supabase GenericStringError for migration-added columns
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ClockSession {
  return row as unknown as ClockSession;
}

// "approved" = all closed sessions for this employee are approved
// "pending"  = no approved sessions (all still waiting)
// "partial"  = mix of approved + unapproved sessions
type ApprovedStatus = "approved" | "pending" | "partial";

// One row in the report table and in the export file
type PayrollRow = {
  // Identity
  employee_number: string;
  first_name: string;
  last_name: string;
  pay_frequency: string;
  role: string;
  branch: string;
  // Counts — used for the Approved column and the status badge
  sessions_included: number;     // sessions that matched the active filter
  approved_sessions_count: number;
  unapproved_sessions_count: number;
  // Hours — calculated only from sessions that matched the active filter
  total_worked_minutes: number;  // → normal_hours in the export
  total_break_minutes: number;   // → break_hours in the export
  // Per-employee approval status (derived from ALL closed sessions)
  approved_status: ApprovedStatus;
};

// Which sessions to include in the report
type SessionFilter = "approved" | "pending" | "all";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns the first day of the current month as "YYYY-MM-DD"
function firstOfMonth(): string {
  const d = new Date();
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

// Derive a per-employee approval status from all of their closed sessions
function deriveStatus(
  approved: ClockSession[],
  unapproved: ClockSession[]
): ApprovedStatus {
  if (approved.length > 0 && unapproved.length === 0) return "approved";
  if (approved.length === 0) return "pending";
  return "partial";
}

// Human-readable label for the export_filter column in the spreadsheet
function filterLabel(f: SessionFilter): string {
  if (f === "approved") return "approved_only";
  if (f === "pending")  return "pending_only";
  return "all_sessions";
}

// ─── Excel export ─────────────────────────────────────────────────────────────
// Produces a .xlsx file with the exact columns required for payroll processing.
// employee_number is force-typed as Text so Excel never strips leading zeros.

function exportXLSX(
  rows: PayrollRow[],
  dateFrom: string,
  dateTo: string,
  filter: SessionFilter
) {
  // ── Column headers (exact names required by spec) ──────────────────────────
  const header = [
    "employee_number",
    "first_name",
    "last_name",
    "pay_frequency",
    "normal_hours",    // worked hours after break deduction / override
    "break_hours",     // break minutes converted to hours
    "approved_status", // per-employee approval status
    // Extra context columns — useful for audit trail
    "role",
    "branch",
    "sessions_count",
    "date_from",
    "date_to",
    "export_filter",
  ];

  const data = rows.map((r) => [
    formatEmployeeNumber(r.employee_number), // col A — kept as Text
    r.first_name    ?? "",
    r.last_name     ?? "",
    r.pay_frequency ?? "",
    parseFloat((r.total_worked_minutes / 60).toFixed(2)),  // normal_hours
    parseFloat((r.total_break_minutes  / 60).toFixed(2)),  // break_hours
    r.approved_status,
    r.role    ?? "",
    r.branch  ?? "",
    r.sessions_included,
    dateFrom,
    dateTo,
    filterLabel(filter),
  ]);

  // ── Build worksheet ────────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);

  // Force column A (employee_number) to Text — prevents Excel stripping "001" → 1
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let row = 1; row <= range.e.r; row++) {
    const addr = XLSX.utils.encode_cell({ r: row, c: 0 });
    if (ws[addr]) {
      ws[addr].t = "s";
      ws[addr].z = "@";
    }
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payroll");
  XLSX.writeFile(
    wb,
    `payroll_${filterLabel(filter)}_${dateFrom}_to_${dateTo}.xlsx`
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PayrollReportPage() {

  // ── Permissions ───────────────────────────────────────────────────────────────
  const { currentUser, canExportPayroll } = useCurrentUser();

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [payFrequency,   setPayFrequency]   = useState<"all" | "weekly" | "monthly">("all");
  const [dateFrom,       setDateFrom]       = useState(firstOfMonth());
  const [dateTo,         setDateTo]         = useState(localToday());
  // Three-way session filter. Default = "approved" so the first export is always safe.
  const [sessionFilter,  setSessionFilter]  = useState<SessionFilter>("approved");

  // ── Results ───────────────────────────────────────────────────────────────────
  const [rows,            setRows]            = useState<PayrollRow[]>([]);
  const [totalClosed,     setTotalClosed]     = useState(0);
  const [unapprovedCount, setUnapprovedCount] = useState(0);
  const [isLoading,       setIsLoading]       = useState(false);
  const [hasLoaded,       setHasLoaded]       = useState(false);
  const [loadError,       setLoadError]       = useState("");

  // ─── Load + compute ───────────────────────────────────────────────────────────
  async function handleApply() {
    setIsLoading(true);
    setLoadError("");
    setRows([]);

    // 1. Staff — optionally filtered by pay_frequency
    let staffQuery = supabase
      .from("staff")
      .select("id, employee_number, first_name, last_name, pay_frequency, role, branch")
      .order("first_name", { ascending: true });

    if (payFrequency !== "all") {
      staffQuery = staffQuery.eq("pay_frequency", payFrequency);
    }

    // 2. Sessions — fetch approval + time-correction columns for correct hour math
    const [staffResult, sessionResult] = await Promise.all([
      staffQuery,
      supabase
        .from("clock_sessions")
        .select(
          "id, staff_id, work_date, clock_in_time, clock_out_time, " +
          "approved, break_minutes, edited_total_hours"
        )
        .gte("work_date", dateFrom)
        .lte("work_date", dateTo),
    ]);

    if (staffResult.error || sessionResult.error) {
      setLoadError("Could not load data. Please try again.");
      setIsLoading(false);
      return;
    }

    const staffList   = (staffResult.data  ?? []) as StaffMember[];
    const allSessions = (sessionResult.data ?? []).map(toSession);

    // ── Global counts for the warning banner ───────────────────────────────────
    const closedSessions = allSessions.filter((s) => s.clock_in_time && s.clock_out_time);
    setTotalClosed(closedSessions.length);
    setUnapprovedCount(closedSessions.filter((s) => !s.approved).length);

    // ── Build one PayrollRow per staff member ──────────────────────────────────
    const computed: PayrollRow[] = staffList.map((staff) => {
      const mySessions  = allSessions.filter((s) => s.staff_id === staff.id);
      const myClosed    = mySessions.filter((s) => s.clock_in_time && s.clock_out_time);
      const myApproved  = myClosed.filter((s) =>  s.approved);
      const myUnapproved = myClosed.filter((s) => !s.approved);

      // Sessions that pass the active three-way filter
      const sessionsForCalc =
        sessionFilter === "approved" ? myApproved  :
        sessionFilter === "pending"  ? myUnapproved :
        myClosed; // "all"

      // Hour calculations respect break_minutes and edited_total_hours overrides
      const workedMins = sessionsForCalc.reduce(
        (sum, s) => sum + calcSessionFinalMinutes(s),
        0
      );
      const breakMins = sessionsForCalc.reduce(
        (sum, s) => sum + (s.break_minutes ?? 0),
        0
      );

      return {
        employee_number:           staff.employee_number ?? "",
        first_name:                staff.first_name,
        last_name:                 staff.last_name,
        pay_frequency:             staff.pay_frequency ?? "",
        role:                      staff.role ?? "",
        branch:                    staff.branch ?? "",
        sessions_included:         sessionsForCalc.length,
        approved_sessions_count:   myApproved.length,
        unapproved_sessions_count: myUnapproved.length,
        total_worked_minutes:      workedMins,
        total_break_minutes:       breakMins,
        approved_status:           deriveStatus(myApproved, myUnapproved),
      };
    });

    // Only show staff who have at least one session in the chosen filter
    setRows(computed.filter((r) => r.sessions_included > 0));
    setHasLoaded(true);
    setIsLoading(false);
  }

  // ─── Derived values ───────────────────────────────────────────────────────────
  // Show the "includes unapproved time" warning only when the filter is "all"
  const showUnapprovedWarning =
    hasLoaded && !isLoading && sessionFilter === "all" && unapprovedCount > 0;

  const showAllApprovedBanner =
    hasLoaded && !isLoading && unapprovedCount === 0 && totalClosed > 0;

  const approvedSessionCount = totalClosed - unapprovedCount;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 font-sans">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-stone-200 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor"
              strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01
                   M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0
                   00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-800 tracking-tight leading-tight">
              Payroll Report
            </h1>
            <p className="text-xs text-stone-400">
              Filter · preview · export approved hours to Excel
            </p>
          </div>
        </div>
      </header>

      <ManagerNav />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ══ FILTER CARD ════════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-5">

          <h2 className="text-sm font-semibold text-stone-600 uppercase tracking-wider">
            Filters
          </h2>

          {/* Date range + pay frequency ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="payFreq">
                Pay Frequency
              </label>
              <select
                id="payFreq"
                value={payFrequency}
                onChange={(e) => setPayFrequency(e.target.value as "all" | "weekly" | "monthly")}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm
                           text-stone-800 bg-white focus:outline-none focus:ring-2
                           focus:ring-emerald-500 focus:border-transparent transition"
              >
                <option value="all">All staff</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="dateFrom">
                From Date
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm
                           text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500
                           focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="dateTo">
                To Date
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm
                           text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500
                           focus:border-transparent transition"
              />
            </div>

          </div>

          {/* Session filter — three-way segmented control ───────────────────── */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Session Filter
            </label>
            <div className="inline-flex rounded-xl border border-stone-200 overflow-hidden
                            bg-stone-50 p-0.5 gap-0.5">
              {(
                [
                  { value: "approved", label: "Approved only",  desc: "Default · safe for payroll" },
                  { value: "pending",  label: "Pending only",   desc: "Not yet approved" },
                  { value: "all",      label: "All sessions",   desc: "Includes unapproved time" },
                ] as { value: SessionFilter; label: string; desc: string }[]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSessionFilter(opt.value)}
                  title={opt.desc}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
                    sessionFilter === opt.value
                      ? opt.value === "approved"
                          ? "bg-emerald-500 text-white shadow-sm"
                          : opt.value === "pending"
                            ? "bg-amber-500 text-white shadow-sm"
                            : "bg-stone-700 text-white shadow-sm"
                      : "text-stone-500 hover:text-stone-700 hover:bg-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-400 mt-1.5">
              {sessionFilter === "approved" && "Only manager-approved sessions are counted and exported — recommended for final payroll."}
              {sessionFilter === "pending"  && "Only unapproved sessions. Useful for reviewing what still needs attention."}
              {sessionFilter === "all"      && "All closed sessions are included. The export will note approved_status per employee."}
            </p>
          </div>

          <button
            onClick={handleApply}
            disabled={isLoading}
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 active:scale-95
                       disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold
                       text-sm rounded-xl px-6 py-2.5 transition-all duration-150 shadow-sm"
          >
            {isLoading ? "Loading…" : "Apply Filters"}
          </button>

        </section>

        {/* ── Load error ── */}
        {loadError && (
          <p className="text-center text-red-500 text-sm bg-red-50 border border-red-100
                        rounded-2xl px-4 py-5">
            {loadError}
          </p>
        )}

        {/* ══ WARNING — includes unapproved time ═════════════════════════════════
            Shown only when the "All sessions" filter is active and there are
            sessions that a manager hasn't approved yet.
        ════════════════════════════════════════════════════════════════════════ */}
        {showUnapprovedWarning && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl px-5 py-4
                          flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none"
              stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0
                   001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-800">
                This report includes unapproved time.
              </p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                {unapprovedCount} session{unapprovedCount !== 1 ? "s" : ""} (of {totalClosed}) in
                this date range have not been approved by a manager. Switch to
                &ldquo;Approved only&rdquo; for a payroll-safe export, or{" "}
                <Link href="/manager/approval"
                  className="underline font-semibold">
                  go to the Approval page
                </Link>{" "}
                to approve them first.
              </p>
            </div>
          </div>
        )}

        {/* ══ SUCCESS — all sessions approved ════════════════════════════════════ */}
        {showAllApprovedBanner && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3
                          flex items-center gap-3">
            <svg className="w-5 h-5 text-emerald-500 shrink-0" fill="none"
              stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-emerald-700 font-medium">
              All {totalClosed} session{totalClosed !== 1 ? "s" : ""} in this range are approved
              — ready to export.
            </p>
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n}
                className="bg-white rounded-2xl border border-stone-200 p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-4 bg-stone-200 rounded w-48" />
                    <div className="h-3 bg-stone-100 rounded w-64" />
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

        {/* ══ RESULTS ════════════════════════════════════════════════════════════ */}
        {!isLoading && hasLoaded && (
          <>
            {/* Permission warning — shown when current user can't export */}
            {currentUser && !canExportPayroll && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200
                              rounded-xl px-4 py-3 text-sm text-amber-800">
                <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none"
                  stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span>
                  <strong>{currentUser.full_name}</strong> does not have permission to export
                  payroll. Contact an Admin to enable the &quot;Export Payroll&quot; permission.
                </span>
              </div>
            )}

            {/* Summary line + export button */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                {rows.length === 0 ? (
                  <p className="text-sm text-stone-500">
                    No staff matched the selected filters.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-stone-600 font-medium">
                      {rows.length} staff member{rows.length !== 1 ? "s" : ""}
                      <span className="text-stone-400 font-normal">
                        {" · "}{dateFrom} → {dateTo}
                      </span>
                    </p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {sessionFilter === "approved" && (
                        <>Approved sessions only · {approvedSessionCount} of {totalClosed} sessions</>
                      )}
                      {sessionFilter === "pending" && (
                        <>{unapprovedCount} pending session{unapprovedCount !== 1 ? "s" : ""}</>
                      )}
                      {sessionFilter === "all" && (
                        <>{totalClosed} total sessions ({approvedSessionCount} approved · {unapprovedCount} pending)</>
                      )}
                    </p>
                  </>
                )}
              </div>

              {rows.length > 0 && (
                <button
                  onClick={() => exportXLSX(rows, dateFrom, dateTo, sessionFilter)}
                  disabled={!canExportPayroll}
                  title={!canExportPayroll ? "You don't have permission to export payroll" : undefined}
                  className="flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700
                             active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                             text-white font-semibold text-sm rounded-xl
                             px-4 py-2.5 transition-all duration-150 shadow-sm shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}
                    viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  {sessionFilter === "approved" ? "Export Approved"
                    : sessionFilter === "pending" ? "Export Pending"
                    : "Export All"}
                </button>
              )}
            </div>

            {/* ── Table ── */}
            {rows.length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">

                    <thead className="bg-stone-50 border-b border-stone-200">
                      <tr>
                        {[
                          { col: "Emp #",          cls: "" },
                          { col: "Name",           cls: "" },
                          { col: "Role",           cls: "" },
                          { col: "Branch",         cls: "" },
                          { col: "Pay",            cls: "" },
                          { col: "Status",         cls: "text-center" },
                          { col: "Sessions",       cls: "text-center" },
                          { col: "Normal Hours",   cls: "" },
                          { col: "Break Hours",    cls: "" },
                        ].map(({ col, cls }) => (
                          <th key={col}
                            className={`text-left text-xs font-semibold text-stone-500 uppercase
                                        tracking-wider px-4 py-3 whitespace-nowrap ${cls}`}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-stone-100">
                      {rows.map((row, i) => (
                        <tr key={i} className="hover:bg-stone-50 transition-colors">

                          {/* Emp # */}
                          <td className="px-4 py-3 text-stone-400 whitespace-nowrap
                                         font-mono text-xs">
                            {formatEmployeeNumber(row.employee_number)}
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
                            <span className="capitalize text-xs font-medium px-2 py-0.5
                                             rounded-full bg-stone-100 text-stone-600">
                              {row.pay_frequency || "—"}
                            </span>
                          </td>

                          {/* Approval status badge */}
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <ApprovalStatusBadge status={row.approved_status} />
                          </td>

                          {/* Sessions count in current filter */}
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <span className="text-stone-700 font-medium">
                              {row.sessions_included}
                            </span>
                            {/* Show approved/total breakdown for the "all" filter */}
                            {sessionFilter === "all" && row.unapproved_sessions_count > 0 && (
                              <span className="text-stone-400 text-xs ml-1">
                                ({row.approved_sessions_count} ✓)
                              </span>
                            )}
                          </td>

                          {/* Normal hours */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`font-semibold ${
                              row.total_worked_minutes > 0
                                ? "text-emerald-600"
                                : "text-stone-300"
                            }`}>
                              {row.total_worked_minutes > 0
                                ? formatHours(row.total_worked_minutes)
                                : "—"}
                            </span>
                          </td>

                          {/* Break hours */}
                          <td className="px-4 py-3 whitespace-nowrap text-stone-500">
                            {row.total_break_minutes > 0
                              ? formatHours(row.total_break_minutes)
                              : "—"}
                          </td>

                        </tr>
                      ))}
                    </tbody>

                    {/* Totals footer */}
                    <tfoot className="bg-stone-50 border-t-2 border-stone-200">
                      <tr>
                        <td colSpan={6}
                          className="px-4 py-3 text-xs font-semibold text-stone-500
                                     uppercase tracking-wider">
                          Totals
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-stone-700">
                          {rows.reduce((s, r) => s + r.sessions_included, 0)}
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
          <div className="text-center py-14 text-stone-400">
            <svg className="w-10 h-10 mx-auto mb-3 text-stone-300" fill="none"
              stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19
                   a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            <p className="text-sm">
              Choose your filters above and tap{" "}
              <strong className="text-stone-600">Apply Filters</strong> to generate the report.
            </p>
            <p className="text-xs mt-2">
              <Link href="/manager/approval" className="text-emerald-600 underline">
                Approve sessions first →
              </Link>
            </p>
          </div>
        )}

      </main>
    </div>
  );
}

// ─── Approval status badge ────────────────────────────────────────────────────

function ApprovalStatusBadge({ status }: { status: ApprovedStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1
                       rounded-full bg-emerald-100 text-emerald-700">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}
          viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Approved
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1
                       rounded-full bg-amber-100 text-amber-700">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}
          viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0
               001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        Partial
      </span>
    );
  }
  // pending
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1
                     rounded-full bg-stone-100 text-stone-500">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}
        viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
      </svg>
      Pending
    </span>
  );
}
