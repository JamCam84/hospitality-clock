"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import EmployeeSearchSelect from "@/components/EmployeeSearchSelect";
import { PageHeader, SummaryCard } from "@/components/ui";
import {
  calcWorkedMinutes,
  calcBreakMinutes,
  formatHours,
  formatTime,
  formatDate,
  calcPayPeriod,
  formatEmployeeNumber,
  isoToDatetimeLocal,
  localToday,
  type PayrollSettings,
} from "@/lib/time-calc";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  employee_number: string;
  pay_frequency: string;
  role: string;
  branch: string;
};

type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_time: string;
  clock_out_time: string | null;
  status: string;
  suspicious_clock_in: boolean | null;
  suspicious_clock_in_reason: string | null;
  suspicious_clock_out: boolean | null;
  suspicious_clock_out_reason: string | null;
  // Added columns for approval workflow
  edited: boolean | null;
  edited_by: string | null;
  edited_at: string | null;
  edit_reason: string | null;
  manually_added: boolean | null;
  manual_add_reason: string | null;
};

// ─── Per-employee computed row (built from staffList + sessions) ───────────────

type PayrollRow = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  pay_frequency: string;
  role: string;
  branch: string;
  sessions: ClockSession[];       // all sessions for this employee in the period
  closedCount: number;            // sessions with both times present
  workedMins: number;
  breakMins: number;
  hasDiscrepancy: boolean;        // any un-edited suspicious flag
  editedCount: number;            // sessions that were edited or manually added
};

// ─── Safe row mapper ──────────────────────────────────────────────────────────
// Supabase's generated types don't include columns added by SQL migrations
// (edited, edited_by, edited_at, edit_reason, manually_added, manual_add_reason),
// so a direct `as ClockSession[]` cast produces "GenericStringError[]" at build
// time. Routing through `unknown` first is the TypeScript-standard way to break
// the incompatible-types error intentionally and safely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ClockSession {
  return row as unknown as ClockSession;
}

// ─── Input class reused across all form inputs ─────────────────────────────────
const inputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 " +
  "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent " +
  "transition disabled:opacity-50";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ApprovalPage() {

  // ── Payroll settings ─────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<PayrollSettings | null>(null);

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [payType, setPayType]   = useState<"monthly" | "weekly" | "all">("monthly");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");

  // ── Loaded data ───────────────────────────────────────────────────────────────
  const [staffList, setStaffList]   = useState<StaffMember[]>([]);
  // allStaff is loaded once on mount (unfiltered) so the Manual Add picker
  // always shows every employee regardless of the pay-period filter.
  const [allStaff, setAllStaff]     = useState<StaffMember[]>([]);
  const [sessions, setSessions]     = useState<ClockSession[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [hasLoaded, setHasLoaded]   = useState(false);
  const [loadError, setLoadError]   = useState("");

  // ── Expanded employee panel ───────────────────────────────────────────────────
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);

  // ── Edit session state ────────────────────────────────────────────────────────
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editIn, setEditIn]           = useState("");
  const [editOut, setEditOut]         = useState("");
  const [editReason, setEditReason]   = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [editIsError, setEditIsError] = useState(false);

  // ── Manual add form ───────────────────────────────────────────────────────────
  const [manualStaffId, setManualStaffId]   = useState("");
  const [manualDate, setManualDate]         = useState(localToday());
  const [manualIn, setManualIn]             = useState("");
  const [manualOut, setManualOut]           = useState("");
  const [manualNotes, setManualNotes]       = useState("");
  const [manualReason, setManualReason]     = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [manualMessage, setManualMessage]   = useState("");
  const [manualIsError, setManualIsError]   = useState(false);

  // ─── 1. Load settings + auto-calculate initial period on mount ────────────────
  useEffect(() => {
    async function init() {
      // Load payroll settings and all staff in parallel
      const [settingsResult, allStaffResult] = await Promise.all([
        supabase.from("payroll_settings").select("*").limit(1).maybeSingle(),
        supabase
          .from("staff")
          .select("id, first_name, last_name, employee_number, pay_frequency, role, branch")
          .order("first_name", { ascending: true }),
      ]);

      const loadedSettings = (settingsResult.data as PayrollSettings | null) ?? null;
      setSettings(loadedSettings);

      // Store the complete unfiltered staff list for the Manual Add picker
      setAllStaff((allStaffResult.data ?? []) as unknown as StaffMember[]);

      // Auto-calculate period dates from settings
      const period = calcPayPeriod(loadedSettings, "monthly");
      setDateFrom(period.from);
      setDateTo(period.to);

      // Auto-load data immediately
      await loadData(period.from, period.to, "monthly");
    }
    init();
  }, []);

  // ─── 2. When payType changes, recalculate the period dates ────────────────────
  useEffect(() => {
    const period = calcPayPeriod(settings, payType);
    setDateFrom(period.from);
    setDateTo(period.to);
  }, [payType]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Load staff + sessions for the selected date range ────────────────────────
  async function loadData(from: string, to: string, type: string) {
    if (!from || !to) return;
    setIsLoading(true);
    setLoadError("");

    // Build staff query (filter by pay_frequency if not "all")
    let staffQuery = supabase
      .from("staff")
      .select("id, first_name, last_name, employee_number, pay_frequency, role, branch")
      .order("first_name", { ascending: true });

    if (type !== "all") {
      staffQuery = staffQuery.eq("pay_frequency", type);
    }

    const [staffResult, sessionResult] = await Promise.all([
      staffQuery,
      supabase
        .from("clock_sessions")
        .select(
          "id, staff_id, work_date, clock_in_time, clock_out_time, status, " +
          "suspicious_clock_in, suspicious_clock_in_reason, " +
          "suspicious_clock_out, suspicious_clock_out_reason, " +
          "edited, edited_by, edited_at, edit_reason, manually_added, manual_add_reason"
        )
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date",     { ascending: false })
        .order("clock_in_time", { ascending: false }),
    ]);

    if (staffResult.error || sessionResult.error) {
      setLoadError("Could not load data. Check your connection and try again.");
    } else {
      setStaffList((staffResult.data ?? []) as unknown as StaffMember[]);
      setSessions((sessionResult.data ?? []).map(toSession));
    }

    setHasLoaded(true);
    setIsLoading(false);
  }

  function handleRefresh() {
    loadData(dateFrom, dateTo, payType);
    setExpandedStaffId(null);
    setEditingSessionId(null);
  }

  // ─── Toggle employee detail panel ────────────────────────────────────────────
  function toggleExpand(staffId: string) {
    setExpandedStaffId((prev) => (prev === staffId ? null : staffId));
    setEditingSessionId(null);
    setEditMessage("");
  }

  // ─── Start editing a session ──────────────────────────────────────────────────
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

  // ─── Save an edited session ───────────────────────────────────────────────────
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

    // Guard against out-before-in
    if (newClockOut && new Date(newClockOut) <= new Date(newClockIn)) {
      setEditMessage("Clock-out must be after clock-in.");
      setEditIsError(true);
      return;
    }

    setIsSavingEdit(true);
    setEditMessage("");

    // 1. Update the clock_session row
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

    // 2. Write audit log entry
    await supabase.from("time_edit_log").insert({
      clock_session_id:  session.id,
      staff_id:          session.staff_id,
      old_clock_in_time: session.clock_in_time,
      old_clock_out_time: session.clock_out_time,
      new_clock_in_time: newClockIn,
      new_clock_out_time: newClockOut,
      action_type:       "edit",
      changed_by:        "Manager",
      reason:            editReason.trim(),
    });

    // 3. Update local state so UI refreshes without a full reload
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
  }

  // ─── Manually add a time entry ────────────────────────────────────────────────
  async function handleManualAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!manualStaffId) {
      setManualMessage("Please select an employee.");
      setManualIsError(true);
      return;
    }
    if (!manualDate || !manualIn) {
      setManualMessage("Date and clock-in time are required.");
      setManualIsError(true);
      return;
    }
    if (!manualReason.trim()) {
      setManualMessage("A reason is required.");
      setManualIsError(true);
      return;
    }

    const clockInISO  = new Date(`${manualDate}T${manualIn}:00`).toISOString();
    const clockOutISO = manualOut
      ? new Date(`${manualDate}T${manualOut}:00`).toISOString()
      : null;

    if (clockOutISO && new Date(clockOutISO) <= new Date(clockInISO)) {
      setManualMessage("Clock-out must be after clock-in.");
      setManualIsError(true);
      return;
    }

    setIsSavingManual(true);
    setManualMessage("");

    // Combine reason + optional notes into one field
    const fullReason = manualNotes.trim()
      ? `${manualReason.trim()} — Notes: ${manualNotes.trim()}`
      : manualReason.trim();

    // 1. Insert the new clock_session row
    const { data: newRow, error: insertError } = await supabase
      .from("clock_sessions")
      .insert({
        staff_id:           manualStaffId,
        work_date:          manualDate,
        clock_in_time:      clockInISO,
        clock_out_time:     clockOutISO,
        status:             clockOutISO ? "clocked_out" : "clocked_in",
        manually_added:     true,
        manual_add_reason:  fullReason,
      })
      .select()
      .single();

    if (insertError) {
      setManualMessage("Error adding entry: " + insertError.message);
      setManualIsError(true);
      setIsSavingManual(false);
      return;
    }

    // 2. Write audit log entry
    const insertedSession = toSession(newRow);
    await supabase.from("time_edit_log").insert({
      clock_session_id:  insertedSession.id,
      staff_id:          manualStaffId,
      new_clock_in_time: clockInISO,
      new_clock_out_time: clockOutISO,
      action_type:       "manual_add",
      changed_by:        "Manager",
      reason:            fullReason,
    });

    // 3. Add to local session list if it falls within the loaded date range
    if (manualDate >= dateFrom && manualDate <= dateTo) {
      setSessions((prev) => [insertedSession, ...prev]);
    }

    // 4. Reset form
    setManualStaffId("");
    setManualDate(localToday());
    setManualIn("");
    setManualOut("");
    setManualNotes("");
    setManualReason("");
    setManualMessage("Time entry added successfully.");
    setManualIsError(false);
    setIsSavingManual(false);
  }

  // ─── Derived values ───────────────────────────────────────────────────────────

  // Build per-employee rows
  const payrollRows: PayrollRow[] = staffList.map((staff) => {
    const mySessions = sessions.filter((s) => s.staff_id === staff.id);
    return {
      id:              staff.id,
      employee_number: staff.employee_number ?? "",
      first_name:      staff.first_name,
      last_name:       staff.last_name,
      pay_frequency:   staff.pay_frequency ?? "",
      role:            staff.role ?? "",
      branch:          staff.branch ?? "",
      sessions:        mySessions,
      closedCount:     mySessions.filter((s) => s.clock_in_time && s.clock_out_time).length,
      workedMins:      calcWorkedMinutes(mySessions),
      breakMins:       calcBreakMinutes(mySessions),
      hasDiscrepancy:  mySessions.some(
        (s) => (s.suspicious_clock_in || s.suspicious_clock_out) && !s.edited
      ),
      editedCount:     mySessions.filter((s) => s.edited || s.manually_added).length,
    };
  });

  // Summary counts
  const activeEmployees    = payrollRows.filter((r) => r.sessions.length > 0).length;
  const totalDiscrepancies = payrollRows.filter((r) => r.hasDiscrepancy).length;
  const totalEdited        = sessions.filter((s) => s.edited || s.manually_added).length;

  // ─── Render helpers ───────────────────────────────────────────────────────────

  function SessionBadges({ session }: { session: ClockSession }) {
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        {session.suspicious_clock_in && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"
            title={session.suspicious_clock_in_reason ?? ""}>
            ⚠ In
          </span>
        )}
        {session.suspicious_clock_out && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"
            title={session.suspicious_clock_out_reason ?? ""}>
            ⚠ Out
          </span>
        )}
        {session.edited && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
            Edited
          </span>
        )}
        {session.manually_added && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
            Manual
          </span>
        )}
      </span>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      <PageHeader
        title="Payroll Approval"
        subtitle="Review, edit, and approve time entries"
        right={
          <Link
            href="/manager/settings"
            className="flex items-center gap-1.5 text-xs font-semibold text-white/80
                       hover:text-white hover:bg-white/20 border border-white/30
                       rounded-xl px-3 py-2 transition-all duration-150"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573
                   1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426
                   1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37
                   2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724
                   1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0
                   00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0
                   001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07
                   2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        }
      />

      <ManagerNav />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ══ A. FILTERS ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Pay Period Filter
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">

            {/* Pay type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pay Type</label>
              <select
                value={payType}
                onChange={(e) => setPayType(e.target.value as "monthly" | "weekly" | "all")}
                className={inputCls}
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="all">All staff</option>
              </select>
            </div>

            {/* From date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date" value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={inputCls}
              />
            </div>

            {/* To date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date" value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={inputCls}
              />
            </div>

            {/* Refresh */}
            <div>
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="w-full bg-green-500 hover:bg-green-600 active:scale-95
                           disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold
                           text-sm rounded-xl px-5 py-2.5 transition-all duration-150 shadow-sm"
              >
                {isLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Period label */}
          {dateFrom && dateTo && (
            <p className="text-xs text-stone-400 mt-3">
              Period: <span className="font-medium text-stone-600">{dateFrom}</span>
              {" → "}
              <span className="font-medium text-stone-600">{dateTo}</span>
              {!settings && (
                <span className="ml-2 text-amber-500">
                  · No payroll settings saved — using defaults.{" "}
                  <Link href="/manager/settings" className="underline">Configure</Link>
                </span>
              )}
            </p>
          )}
        </section>

        {/* Load error */}
        {loadError && (
          <p className="text-sm text-red-500 text-center bg-red-50 border border-red-100
                        rounded-2xl px-4 py-4">
            {loadError}
          </p>
        )}

        {/* ══ B. SUMMARY CARDS ═══════════════════════════════════════════════ */}
        {hasLoaded && !isLoading && (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              label="Employees in Period"
              value={activeEmployees}
              sub={`of ${staffList.length} total`}
            />
            <SummaryCard
              label="Total Sessions"
              value={sessions.length}
              sub="clock sessions"
            />
            <SummaryCard
              label="Open Discrepancies"
              value={totalDiscrepancies}
              sub="employees with flags"
              valueColor={totalDiscrepancies > 0 ? "text-amber-500" : "text-gray-300"}
            />
            <SummaryCard
              label="Edited Entries"
              value={totalEdited}
              sub="manual + manager edits"
              valueColor={totalEdited > 0 ? "text-sky-600" : "text-gray-300"}
            />
          </section>
        )}

        {/* ══ C. EMPLOYEE TABLE ══════════════════════════════════════════════ */}
        {hasLoaded && !isLoading && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">Employee Time Review</h2>
            </div>

            {payrollRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-gray-400 text-sm">
                No employees matched the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[800px]">

                  {/* Header */}
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {["Emp #", "Name", "Role", "Department", "Pay", "Sessions", "Worked", "Break", ""].map(
                        (col) => (
                          <th key={col}
                            className="text-left text-xs font-semibold text-gray-400 uppercase
                                       tracking-wider px-4 py-3 whitespace-nowrap">
                            {col}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {payrollRows.map((row) => (
                      <React.Fragment key={row.id}>

                        {/* ── Employee summary row ── */}
                        <tr
                          className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer
                                      ${expandedStaffId === row.id ? "bg-green-50/40" : ""}`}
                          onClick={() => toggleExpand(row.id)}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-stone-400 whitespace-nowrap">
                            {formatEmployeeNumber(row.employee_number)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-semibold text-stone-800">
                              {row.first_name} {row.last_name}
                            </p>
                            {/* Discrepancy / edited badges on name row */}
                            <div className="flex gap-1 mt-0.5">
                              {row.hasDiscrepancy && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                  ⚠ Needs review
                                </span>
                              )}
                              {row.editedCount > 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
                                  {row.editedCount} edited
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{row.role || "—"}</td>
                          <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{row.branch || "—"}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="capitalize text-xs font-medium px-2 py-0.5 rounded-full
                                             bg-stone-100 text-stone-600">
                              {row.pay_frequency || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-stone-700 whitespace-nowrap">
                            {row.closedCount}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`font-semibold ${row.workedMins > 0 ? "text-emerald-600" : "text-stone-300"}`}>
                              {row.workedMins > 0 ? formatHours(row.workedMins) : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-stone-500 whitespace-nowrap">
                            {row.breakMins > 0 ? formatHours(row.breakMins) : "—"}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}
                              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800
                                         hover:bg-emerald-50 rounded-lg px-3 py-1.5 transition-colors"
                            >
                              {expandedStaffId === row.id ? "Collapse ▲" : "View / Edit ▼"}
                            </button>
                          </td>
                        </tr>

                        {/* ── D. EMPLOYEE DETAIL PANEL ── */}
                        {expandedStaffId === row.id && (
                          <tr>
                            <td colSpan={9} className="bg-stone-50 p-0 border-b border-stone-200">
                              <div className="px-6 py-5">

                                {row.sessions.length === 0 ? (
                                  <p className="text-sm text-stone-400 text-center py-4">
                                    No clock sessions in this period for {row.first_name}.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
                                      Sessions for {row.first_name} {row.last_name}
                                    </p>

                                    {/* Edit feedback message */}
                                    {editMessage && (
                                      <p className={`text-sm rounded-xl px-4 py-2.5 mb-3 ${
                                        editIsError
                                          ? "bg-red-50 text-red-600"
                                          : "bg-emerald-50 text-emerald-700"
                                      }`}>
                                        {editMessage}
                                      </p>
                                    )}

                                    {row.sessions.map((session) => (
                                      <div key={session.id}
                                        className="bg-white rounded-xl border border-stone-200 overflow-hidden">

                                        {/* ── Session display row ── */}
                                        {editingSessionId !== session.id && (
                                          <div className="px-4 py-3 flex items-start gap-3 flex-wrap">
                                            {/* Date */}
                                            <div className="w-28 shrink-0">
                                              <p className="text-xs text-stone-400">Date</p>
                                              <p className="text-sm font-medium text-stone-700">
                                                {formatDate(session.work_date)}
                                              </p>
                                            </div>
                                            {/* Times */}
                                            <div className="flex gap-6 flex-1">
                                              <div>
                                                <p className="text-xs text-stone-400">Clock In</p>
                                                <p className="text-sm font-medium text-stone-700">
                                                  {formatTime(session.clock_in_time)}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="text-xs text-stone-400">Clock Out</p>
                                                <p className="text-sm font-medium text-stone-700">
                                                  {session.clock_out_time
                                                    ? formatTime(session.clock_out_time)
                                                    : <span className="text-emerald-500">Still in</span>}
                                                </p>
                                              </div>
                                              {/* Duration */}
                                              {session.clock_in_time && session.clock_out_time && (
                                                <div>
                                                  <p className="text-xs text-stone-400">Duration</p>
                                                  <p className="text-sm text-stone-500">
                                                    {(() => {
                                                      const mins = Math.round(
                                                        (new Date(session.clock_out_time).getTime() -
                                                          new Date(session.clock_in_time).getTime()) / 60_000
                                                      );
                                                      return `${Math.floor(mins / 60)}h ${mins % 60}m`;
                                                    })()}
                                                  </p>
                                                </div>
                                              )}
                                            </div>
                                            {/* Badges */}
                                            <div className="shrink-0 flex items-center gap-2">
                                              <SessionBadges session={session} />
                                              <button
                                                onClick={() => startEdit(session)}
                                                className="text-xs font-semibold text-stone-500
                                                           hover:text-sky-700 hover:bg-sky-50 border
                                                           border-stone-200 hover:border-sky-200 rounded-lg
                                                           px-2.5 py-1.5 transition-all duration-150"
                                              >
                                                Edit
                                              </button>
                                            </div>
                                            {/* Edit reason (shown if edited) */}
                                            {session.edit_reason && (
                                              <p className="w-full text-xs text-stone-400 mt-0.5">
                                                Edit reason: <span className="italic">{session.edit_reason}</span>
                                                {session.edited_at && (
                                                  <span className="ml-2 text-stone-300">
                                                    · {new Date(session.edited_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                                                  </span>
                                                )}
                                              </p>
                                            )}
                                            {session.manual_add_reason && (
                                              <p className="w-full text-xs text-stone-400 mt-0.5">
                                                Manual reason: <span className="italic">{session.manual_add_reason}</span>
                                              </p>
                                            )}
                                          </div>
                                        )}

                                        {/* ── Edit form (replaces row when editing) ── */}
                                        {editingSessionId === session.id && (
                                          <div className="px-4 py-4 bg-sky-50 border-l-4 border-sky-400">
                                            <p className="text-xs font-semibold text-sky-700 uppercase
                                                          tracking-wider mb-3">
                                              Editing session — {formatDate(session.work_date)}
                                            </p>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
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
                                                  Reason for edit *
                                                </label>
                                                <input
                                                  type="text"
                                                  value={editReason}
                                                  onChange={(e) => setEditReason(e.target.value)}
                                                  placeholder="e.g. Employee forgot to clock out"
                                                  className={inputCls}
                                                />
                                              </div>
                                            </div>

                                            {editMessage && (
                                              <p className={`text-xs mb-2 ${editIsError ? "text-red-600" : "text-emerald-600"}`}>
                                                {editMessage}
                                              </p>
                                            )}

                                            <div className="flex gap-2">
                                              <button
                                                onClick={() => handleSaveEdit(session)}
                                                disabled={isSavingEdit}
                                                className="bg-sky-600 hover:bg-sky-700 text-white font-semibold
                                                           text-xs rounded-lg px-4 py-2 transition-colors
                                                           disabled:opacity-50"
                                              >
                                                {isSavingEdit ? "Saving…" : "Save Edit"}
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
                                        )}

                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}

                      </React.Fragment>
                    ))}
                  </tbody>

                  {/* Totals footer */}
                  {payrollRows.length > 0 && (
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                          Totals
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-stone-700">
                          {payrollRows.reduce((s, r) => s + r.closedCount, 0)}
                        </td>
                        <td className="px-4 py-3 font-bold text-emerald-600 whitespace-nowrap">
                          {formatHours(payrollRows.reduce((s, r) => s + r.workedMins, 0))}
                        </td>
                        <td className="px-4 py-3 font-bold text-stone-500 whitespace-nowrap">
                          {formatHours(payrollRows.reduce((s, r) => s + r.breakMins, 0))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}

                </table>
              </div>
            )}
          </section>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3 animate-pulse">
            <div className="bg-white rounded-2xl border border-gray-100 p-4 h-12" />
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-32" />
                  <div className="h-3 bg-gray-100 rounded w-48" />
                </div>
                <div className="h-4 bg-gray-100 rounded w-20" />
              </div>
            ))}
          </div>
        )}

        {/* ══ E. MANUAL ADD TIME ENTRY ═══════════════════════════════════════ */}
        {hasLoaded && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-violet-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-gray-800">Manually Add Time Entry</h2>
            </div>
            <p className="text-xs text-stone-400 mb-5">
              Use this form when an employee forgot to clock in or out. The entry will be marked
              as <span className="font-medium text-violet-600">Manual</span> and logged in the audit trail.
            </p>

            <form onSubmit={handleManualAdd} className="space-y-4">

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                {/* Employee search select */}
                <div className="sm:col-span-2 lg:col-span-1">
                  <EmployeeSearchSelect
                    employees={allStaff}
                    selectedEmployeeId={manualStaffId}
                    onSelect={setManualStaffId}
                    label="Employee *"
                    placeholder="Search by name, number, role…"
                  />
                </div>

                {/* Work date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Work Date *
                  </label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    required
                    className={inputCls}
                  />
                </div>

                {/* Clock in */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Clock In Time *
                  </label>
                  <input
                    type="time"
                    value={manualIn}
                    onChange={(e) => setManualIn(e.target.value)}
                    required
                    className={inputCls}
                  />
                </div>

                {/* Clock out */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Clock Out Time
                    <span className="text-gray-400 font-normal ml-1">(optional)</span>
                  </label>
                  <input
                    type="time"
                    value={manualOut}
                    onChange={(e) => setManualOut(e.target.value)}
                    className={inputCls}
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason *
                  </label>
                  <input
                    type="text"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder="e.g. Employee forgot to clock in"
                    required
                    className={inputCls}
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                    <span className="text-gray-400 font-normal ml-1">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={manualNotes}
                    onChange={(e) => setManualNotes(e.target.value)}
                    placeholder="Any additional notes"
                    className={inputCls}
                  />
                </div>

              </div>

              {/* Feedback */}
              {manualMessage && (
                <p className={`text-sm font-medium rounded-xl px-4 py-3 ${
                  manualIsError ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
                }`}>
                  {manualMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={isSavingManual}
                className="bg-violet-600 hover:bg-violet-700 active:scale-95 disabled:opacity-60
                           disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl
                           px-6 py-2.5 transition-all duration-150 shadow-sm"
              >
                {isSavingManual ? "Adding Entry…" : "Add Time Entry"}
              </button>

            </form>
          </section>
        )}

      </main>
    </div>
  );
}
