"use client";

/**
 * app/manager/payroll-runs/page.tsx
 *
 * Payroll Run Approval page.
 *
 * Flow:
 *  1. Manager selects pay frequency + date range + optional branch filter.
 *  2. Page loads all clock_sessions in that range and groups them by employee.
 *  3. Each employee row shows a status badge:
 *       - Approved     → all closed sessions have approved = true
 *       - Needs Attention → has open sessions (no clock_out) or suspicious
 *                          unedited large spans
 *       - Pending      → otherwise
 *  4. Manager can expand an employee row to see individual sessions and
 *     edit any of them inline (same pattern as approval/page.tsx).
 *  5. "Approve Employee" marks all that employee's closed sessions approved.
 *  6. "Approve Whole Run" marks every closed session in the current filter approved.
 *  7. A link to the Payroll Report pre-fills the same date range so only
 *     approved sessions get exported.
 */

import { useEffect, useState, useCallback } from "react";
import ManagerNav from "@/components/ManagerNav";
import { supabase } from "@/lib/supabase";
import {
  calcSessionFinalMinutes,
  calcPayPeriod,
  formatHours,
  formatTime,
  formatDate,
  formatEmployeeNumber,
  isoToDatetimeLocal,
  localToday,
  toDateStr,
  PayrollSettings,
} from "@/lib/time-calc";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  // audit columns
  edited: boolean;
  edited_by: string | null;
  edited_at: string | null;
  edit_reason: string | null;
  manually_added: boolean;
  manual_add_reason: string | null;
  // time-correction columns
  break_minutes: number | null;
  edited_total_hours: number | null;
  manager_note: string | null;
  // approval columns
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
};

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  employee_number: string | null;
  branch: string | null;
  pay_frequency: string | null;
};

// Per-employee roll-up used to render the summary table
type EmployeeRun = {
  staff: StaffMember;
  sessions: ClockSession[];
  status: "approved" | "needs_attention" | "pending";
  finalMins: number;
  breakMins: number;
  openCount: number;
  editedCount: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ClockSession {
  return row as unknown as ClockSession;
}

/** Minutes in a session span — raw, no break deduction, 0 for open sessions */
function rawSpanMins(s: ClockSession): number {
  if (!s.clock_in_time || !s.clock_out_time) return 0;
  return Math.max(
    0,
    (new Date(s.clock_out_time).getTime() - new Date(s.clock_in_time).getTime()) /
      60_000
  );
}

/** A session is "suspicious" if the raw span > 14 hours and not edited */
function isSuspicious(s: ClockSession): boolean {
  return rawSpanMins(s) > 14 * 60 && !s.edited && !s.edited_total_hours;
}

function deriveStatus(sessions: ClockSession[]): EmployeeRun["status"] {
  const closed = sessions.filter((s) => s.clock_in_time && s.clock_out_time);
  const open = sessions.filter((s) => !s.clock_out_time);
  if (open.length > 0) return "needs_attention";
  if (closed.some(isSuspicious)) return "needs_attention";
  if (closed.length > 0 && closed.every((s) => s.approved)) return "approved";
  return "pending";
}

const LARGE_SPAN_HOURS = 14; // flag as suspicious above this

// ─── Component ────────────────────────────────────────────────────────────────

export default function PayrollRunsPage() {
  // ── Filter state ────────────────────────────────────────────────────────────
  const [payType, setPayType] = useState<"monthly" | "weekly" | "all">("monthly");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(localToday());
  const [branchFilter, setBranchFilter] = useState("all");

  // ── Data ────────────────────────────────────────────────────────────────────
  const [employeeRuns, setEmployeeRuns] = useState<EmployeeRun[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit form state (one session at a time)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editBreakMins, setEditBreakMins] = useState("");
  const [editTotalHours, setEditTotalHours] = useState("");
  const [editManagerNote, setEditManagerNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Approval state
  const [approvingId, setApprovingId] = useState<string | null>(null); // staff_id being approved
  const [approvalNote, setApprovalNote] = useState("");
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [approveAllNote, setApproveAllNote] = useState("");
  const [approving, setApproving] = useState(false);

  // ── Bootstrap: load payroll settings then derive date range ─────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("payroll_settings").select("*").single();
      const s = data as PayrollSettings | null;
      setSettings(s);
      const { from } = calcPayPeriod(s, payType);
      setDateFrom(from);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When pay type changes, recalculate the date range
  useEffect(() => {
    const { from, to } = calcPayPeriod(settings, payType);
    setDateFrom(from);
    setDateTo(to);
  }, [payType, settings]);

  // ── Load data ────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError(null);

    try {
      // Load all staff
      const { data: staffData, error: staffErr } = await supabase
        .from("staff")
        .select("id, first_name, last_name, employee_number, branch, pay_frequency")
        .order("first_name");

      if (staffErr) throw staffErr;
      const allStaff = (staffData ?? []) as StaffMember[];

      // Collect distinct branches for filter UI
      const branchSet = new Set<string>();
      for (const s of allStaff) {
        if (s.branch) branchSet.add(s.branch);
      }
      setBranches(Array.from(branchSet).sort());

      // Load all sessions in range
      const { data: sessionData, error: sessionErr } = await supabase
        .from("clock_sessions")
        .select(
          `id, staff_id, work_date,
           clock_in_time, clock_out_time,
           edited, edited_by, edited_at, edit_reason,
           manually_added, manual_add_reason,
           break_minutes, edited_total_hours, manager_note,
           approved, approved_by, approved_at, approval_note`
        )
        .gte("work_date", dateFrom)
        .lte("work_date", dateTo)
        .order("work_date", { ascending: true });

      if (sessionErr) throw sessionErr;
      const sessions = (sessionData ?? []).map(toSession);

      // Group sessions by staff_id
      const byStaff: Record<string, ClockSession[]> = {};
      for (const s of sessions) {
        if (!byStaff[s.staff_id]) byStaff[s.staff_id] = [];
        byStaff[s.staff_id].push(s);
      }

      // Filter staff by pay type and branch
      const filtered = allStaff.filter((s) => {
        if (branchFilter !== "all" && s.branch !== branchFilter) return false;
        if (payType !== "all") {
          const freq = (s.pay_frequency ?? "").toLowerCase();
          if (payType === "monthly" && freq !== "monthly") return false;
          if (payType === "weekly" && freq !== "weekly") return false;
        }
        return true;
      });

      // Build EmployeeRun for each filtered staff member
      const runs: EmployeeRun[] = filtered.map((staff) => {
        const mySessions = byStaff[staff.id] ?? [];
        const closed = mySessions.filter((s) => s.clock_in_time && s.clock_out_time);
        const finalMins = closed.reduce(
          (sum, s) => sum + calcSessionFinalMinutes(s),
          0
        );
        const breakMins = closed.reduce(
          (sum, s) => sum + (s.break_minutes ?? 0),
          0
        );
        return {
          staff,
          sessions: mySessions,
          status: deriveStatus(mySessions),
          finalMins,
          breakMins,
          openCount: mySessions.filter((s) => !s.clock_out_time).length,
          editedCount: mySessions.filter((s) => s.edited || s.manually_added).length,
        };
      });

      // Sort: needs_attention → pending → approved
      const ORDER = { needs_attention: 0, pending: 1, approved: 2 };
      runs.sort((a, b) => ORDER[a.status] - ORDER[b.status]);

      setEmployeeRuns(runs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, branchFilter, payType]);

  useEffect(() => {
    if (dateFrom) loadData();
  }, [loadData, dateFrom]);

  // ── Edit helpers ─────────────────────────────────────────────────────────────
  function startEdit(session: ClockSession) {
    setEditingSessionId(session.id);
    setEditIn(isoToDatetimeLocal(session.clock_in_time));
    setEditOut(isoToDatetimeLocal(session.clock_out_time));
    setEditReason("");
    setEditBreakMins(session.break_minutes != null ? String(session.break_minutes) : "");
    setEditTotalHours(
      session.edited_total_hours != null ? String(session.edited_total_hours) : ""
    );
    setEditManagerNote(session.manager_note ?? "");
  }

  function cancelEdit() {
    setEditingSessionId(null);
    setEditIn("");
    setEditOut("");
    setEditReason("");
    setEditBreakMins("");
    setEditTotalHours("");
    setEditManagerNote("");
  }

  async function handleSaveEdit(session: ClockSession) {
    if (!editReason.trim()) {
      alert("Please provide a reason for the edit.");
      return;
    }
    setSaving(true);
    try {
      const newClockIn = editIn ? new Date(editIn).toISOString() : null;
      const newClockOut = editOut ? new Date(editOut).toISOString() : null;
      const newBreakMins =
        editBreakMins.trim() !== "" ? parseInt(editBreakMins, 10) : null;
      const newTotalHours =
        editTotalHours.trim() !== "" ? parseFloat(editTotalHours) : null;
      const newManagerNote = editManagerNote.trim() || null;
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("clock_sessions")
        .update({
          clock_in_time: newClockIn,
          clock_out_time: newClockOut,
          status: newClockOut ? "clocked_out" : "clocked_in",
          edited: true,
          edited_by: "Manager",
          edited_at: now,
          edit_reason: editReason.trim(),
          break_minutes: newBreakMins,
          edited_total_hours: newTotalHours,
          manager_note: newManagerNote,
          // Reset approval when times change
          approved: false,
          approved_by: null,
          approved_at: null,
        })
        .eq("id", session.id);

      if (updateError) throw updateError;

      // Audit log — silently skip if it fails
      try {
        await supabase.from("time_edit_log").insert({
          clock_session_id: session.id,
          staff_id: session.staff_id,
          old_clock_in_time: session.clock_in_time,
          old_clock_out_time: session.clock_out_time,
          new_clock_in_time: newClockIn,
          new_clock_out_time: newClockOut,
          old_break_minutes: session.break_minutes,
          new_break_minutes: newBreakMins,
          old_edited_total_hours: session.edited_total_hours,
          new_edited_total_hours: newTotalHours,
          old_manager_note: session.manager_note,
          new_manager_note: newManagerNote,
          action_type: "edit",
          changed_by: "Manager",
          reason: editReason.trim(),
        });
      } catch (_) {
        // audit log failure is non-fatal
      }

      cancelEdit();
      await loadData();
    } catch (e: unknown) {
      alert("Save failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  // ── Approve one employee ─────────────────────────────────────────────────────
  async function handleApproveEmployee(run: EmployeeRun) {
    const closedSessionIds = run.sessions
      .filter((s) => s.clock_in_time && s.clock_out_time)
      .map((s) => s.id);

    if (closedSessionIds.length === 0) {
      alert("No closed sessions to approve for this employee.");
      return;
    }

    setApproving(true);
    try {
      const now = new Date().toISOString();
      const { error: approveError } = await supabase
        .from("clock_sessions")
        .update({
          approved: true,
          approved_by: "Manager",
          approved_at: now,
          approval_note: approvalNote.trim() || null,
        })
        .in("id", closedSessionIds);

      if (approveError) throw approveError;

      setApprovingId(null);
      setApprovalNote("");
      await loadData();
    } catch (e: unknown) {
      alert("Approval failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setApproving(false);
    }
  }

  // ── Approve whole run ────────────────────────────────────────────────────────
  async function handleApproveAll() {
    const allClosedIds = employeeRuns.flatMap((r) =>
      r.sessions
        .filter((s) => s.clock_in_time && s.clock_out_time)
        .map((s) => s.id)
    );

    if (allClosedIds.length === 0) {
      alert("No closed sessions to approve.");
      return;
    }

    setApproving(true);
    try {
      const now = new Date().toISOString();
      // Supabase .in() has a limit; batch in chunks of 200
      const CHUNK = 200;
      for (let i = 0; i < allClosedIds.length; i += CHUNK) {
        const chunk = allClosedIds.slice(i, i + CHUNK);
        const { error: approveError } = await supabase
          .from("clock_sessions")
          .update({
            approved: true,
            approved_by: "Manager",
            approved_at: now,
            approval_note: approveAllNote.trim() || null,
          })
          .in("id", chunk);
        if (approveError) throw approveError;
      }

      setApproveAllOpen(false);
      setApproveAllNote("");
      await loadData();
    } catch (e: unknown) {
      alert("Approval failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setApproving(false);
    }
  }

  // ── Summary counts ───────────────────────────────────────────────────────────
  const totalEmployees = employeeRuns.length;
  const approvedCount = employeeRuns.filter((r) => r.status === "approved").length;
  const pendingCount = employeeRuns.filter((r) => r.status === "pending").length;
  const attentionCount = employeeRuns.filter(
    (r) => r.status === "needs_attention"
  ).length;
  const totalFinalMins = employeeRuns.reduce((sum, r) => sum + r.finalMins, 0);
  const totalEditedSessions = employeeRuns.reduce(
    (sum, r) => sum + r.editedCount,
    0
  );

  // Payroll report link pre-filled with current dates
  const payrollReportHref = `/manager/payroll-report?from=${dateFrom}&to=${dateTo}`;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50">
      <ManagerNav />

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Payroll Run Approval</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              Review, correct, and approve staff hours before exporting to payroll.
            </p>
          </div>
          <a
            href={payrollReportHref}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600
                       text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Payroll
          </a>
        </div>

        {/* ── Filters ── */}
        <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
          <div className="flex flex-wrap gap-4 items-end">

            {/* Pay frequency */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                Pay Frequency
              </label>
              <div className="flex rounded-xl overflow-hidden border border-stone-200">
                {(["monthly", "weekly", "all"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setPayType(t)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors
                      ${payType === t
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-stone-600 hover:bg-stone-100"
                      }`}
                  >
                    {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700
                           focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700
                           focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            {/* Branch */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                Branch
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700
                           focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="all">All branches</option>
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Refresh */}
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200
                         bg-white text-stone-700 text-sm font-medium hover:bg-stone-50
                         disabled:opacity-50 transition-colors"
            >
              <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0
                     0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <SummaryCard
            label="Employees"
            value={String(totalEmployees)}
            color="stone"
          />
          <SummaryCard
            label="Approved"
            value={String(approvedCount)}
            color="green"
          />
          <SummaryCard
            label="Pending"
            value={String(pendingCount)}
            color="amber"
          />
          <SummaryCard
            label="Needs Attention"
            value={String(attentionCount)}
            color="red"
          />
          <SummaryCard
            label="Total Hours"
            value={(totalFinalMins / 60).toFixed(1) + " hrs"}
            color="emerald"
            sub={`${totalEditedSessions} edited session${totalEditedSessions !== 1 ? "s" : ""}`}
          />
        </div>

        {/* ── Notice about export ── */}
        <p className="text-xs text-stone-400 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          <strong className="text-amber-700">Tip:</strong> Only approved sessions are
          exported when you use the Payroll Export.{" "}
          <a href={payrollReportHref} className="text-emerald-600 underline">
            Open Payroll Report →
          </a>
        </p>

        {/* ── Approve whole run button ── */}
        <div className="flex justify-end">
          <button
            onClick={() => setApproveAllOpen(true)}
            disabled={approving || employeeRuns.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white
                       text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50
                       transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Approve Whole Run
          </button>
        </div>

        {/* ── Employee table ── */}
        {employeeRuns.length === 0 && !loading && (
          <div className="text-center py-16 text-stone-400">
            No sessions found for this period.
          </div>
        )}

        {employeeRuns.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-3
                            px-5 py-3 border-b border-stone-100 bg-stone-50
                            text-xs font-semibold text-stone-500 uppercase tracking-wide">
              <span>Employee</span>
              <span>Branch</span>
              <span className="text-right">Sessions</span>
              <span className="text-right">Break</span>
              <span className="text-right">Final Hrs</span>
              <span className="text-center">Status</span>
              <span></span>
            </div>

            {employeeRuns.map((run) => {
              const isExpanded = expandedId === run.staff.id;
              return (
                <div key={run.staff.id} className="border-b border-stone-100 last:border-0">
                  {/* Summary row */}
                  <div
                    className={`grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-3
                                px-5 py-4 items-center cursor-pointer hover:bg-stone-50
                                transition-colors
                                ${isExpanded ? "bg-stone-50" : ""}`}
                    onClick={() =>
                      setExpandedId(isExpanded ? null : run.staff.id)
                    }
                  >
                    {/* Name */}
                    <div>
                      <p className="font-medium text-stone-800 text-sm">
                        {run.staff.first_name} {run.staff.last_name}
                      </p>
                      <p className="text-xs text-stone-400">
                        #{formatEmployeeNumber(run.staff.employee_number)}
                        {run.openCount > 0 && (
                          <span className="ml-2 text-red-500 font-medium">
                            {run.openCount} open
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Branch */}
                    <span className="text-sm text-stone-600">
                      {run.staff.branch ?? "—"}
                    </span>

                    {/* Session count */}
                    <span className="text-sm text-stone-700 text-right font-medium">
                      {run.sessions.length}
                    </span>

                    {/* Break */}
                    <span className="text-sm text-stone-500 text-right">
                      {run.breakMins > 0
                        ? (run.breakMins / 60).toFixed(1) + " h"
                        : "—"}
                    </span>

                    {/* Final hours */}
                    <span className="text-sm font-semibold text-stone-800 text-right">
                      {formatHours(run.finalMins)}
                    </span>

                    {/* Status badge */}
                    <div className="flex justify-center">
                      <StatusBadge status={run.status} />
                    </div>

                    {/* Chevron */}
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform
                                  ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* ── Expanded session detail ── */}
                  {isExpanded && (
                    <div className="bg-stone-50 border-t border-stone-100 px-5 py-4 space-y-3">

                      {/* Approve employee row */}
                      {run.status !== "approved" && (
                        <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-stone-200">
                          {approvingId === run.staff.id ? (
                            <>
                              <input
                                type="text"
                                placeholder="Approval note (optional)"
                                value={approvalNote}
                                onChange={(e) => setApprovalNote(e.target.value)}
                                className="flex-1 min-w-48 border border-stone-200 rounded-xl px-3 py-2
                                           text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                              />
                              <button
                                onClick={() => handleApproveEmployee(run)}
                                disabled={approving}
                                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm
                                           font-medium hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {approving ? "Approving…" : "Confirm Approval"}
                              </button>
                              <button
                                onClick={() => {
                                  setApprovingId(null);
                                  setApprovalNote("");
                                }}
                                className="px-4 py-2 rounded-xl border border-stone-200 text-sm
                                           text-stone-600 hover:bg-stone-100"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setApprovingId(run.staff.id)}
                              disabled={run.openCount > 0}
                              title={
                                run.openCount > 0
                                  ? "Cannot approve while there are open sessions"
                                  : undefined
                              }
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50
                                         border border-emerald-200 text-emerald-700 text-sm font-medium
                                         hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor"
                                strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Approve {run.staff.first_name}
                            </button>
                          )}
                          {run.openCount > 0 && (
                            <p className="text-xs text-red-500">
                              {run.openCount} session{run.openCount > 1 ? "s" : ""} still open —
                              clock out required before approving.
                            </p>
                          )}
                        </div>
                      )}

                      {run.status === "approved" && (
                        <div className="flex items-center gap-2 pb-3 border-b border-stone-200 text-xs text-emerald-700">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor"
                            strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          All sessions approved for this employee.
                        </div>
                      )}

                      {/* Sessions list */}
                      {run.sessions.length === 0 && (
                        <p className="text-sm text-stone-400 py-2">
                          No sessions in this period.
                        </p>
                      )}

                      {run.sessions
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(a.work_date).getTime() -
                            new Date(b.work_date).getTime()
                        )
                        .map((session) => {
                          const isEditing = editingSessionId === session.id;
                          const isOpen = !session.clock_out_time;
                          const rawMins = rawSpanMins(session);
                          const finalMins = calcSessionFinalMinutes(session);
                          const isOverride = session.edited_total_hours != null;
                          const suspicious = isSuspicious(session);

                          return (
                            <div
                              key={session.id}
                              className={`rounded-xl border p-4 space-y-3
                                ${isOpen
                                  ? "border-red-200 bg-red-50"
                                  : suspicious
                                    ? "border-amber-200 bg-amber-50"
                                    : session.approved
                                      ? "border-emerald-200 bg-emerald-50"
                                      : "border-stone-200 bg-white"
                                }`}
                            >
                              {/* Session header */}
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-stone-800 text-sm">
                                    {formatDate(session.work_date)}
                                  </span>
                                  {session.manually_added && (
                                    <span className="text-xs px-2 py-0.5 bg-purple-100
                                                     text-purple-700 rounded-full">
                                      Manual
                                    </span>
                                  )}
                                  {session.edited && (
                                    <span className="text-xs px-2 py-0.5 bg-blue-100
                                                     text-blue-700 rounded-full">
                                      Edited
                                    </span>
                                  )}
                                  {suspicious && (
                                    <span className="text-xs px-2 py-0.5 bg-amber-100
                                                     text-amber-700 rounded-full">
                                      ⚠ Suspicious span
                                    </span>
                                  )}
                                  {session.approved && (
                                    <span className="text-xs px-2 py-0.5 bg-emerald-100
                                                     text-emerald-700 rounded-full">
                                      ✓ Approved
                                    </span>
                                  )}
                                </div>

                                {/* Actions */}
                                {!isEditing && (
                                  <button
                                    onClick={() => startEdit(session)}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-stone-200
                                               text-stone-600 hover:bg-stone-100 transition-colors"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>

                              {/* Times display (not editing) */}
                              {!isEditing && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                  <div>
                                    <p className="text-xs text-stone-400 mb-0.5">Clock In</p>
                                    <p className="font-medium text-stone-700">
                                      {formatTime(session.clock_in_time)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-stone-400 mb-0.5">Clock Out</p>
                                    <p className={`font-medium ${isOpen ? "text-red-600" : "text-stone-700"}`}>
                                      {isOpen ? "Still clocked in" : formatTime(session.clock_out_time)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-stone-400 mb-0.5">Raw Span</p>
                                    <p className="font-medium text-stone-700">
                                      {isOpen ? "—" : formatHours(rawMins)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-stone-400 mb-0.5">
                                      Final Payroll
                                    </p>
                                    <p className={`font-semibold ${isOverride ? "text-amber-600" : "text-stone-800"}`}>
                                      {isOpen ? "—" : formatHours(finalMins)}
                                      {isOverride && " ⚠"}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Break / note display */}
                              {!isEditing && (session.break_minutes || session.manager_note) && (
                                <div className="text-xs text-stone-500 space-y-0.5">
                                  {session.break_minutes != null && (
                                    <p>Break: {session.break_minutes} min</p>
                                  )}
                                  {session.manager_note && (
                                    <p>Note: {session.manager_note}</p>
                                  )}
                                </div>
                              )}

                              {/* Edit form */}
                              {isEditing && (
                                <div className="space-y-3 pt-1">
                                  {/* Times + break + override */}
                                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <div className="flex flex-col gap-1">
                                      <label className="text-xs font-medium text-stone-500">
                                        Clock In
                                      </label>
                                      <input
                                        type="datetime-local"
                                        value={editIn}
                                        onChange={(e) => setEditIn(e.target.value)}
                                        className="border border-stone-200 rounded-xl px-3 py-2
                                                   text-sm focus:outline-none focus:ring-2
                                                   focus:ring-emerald-400"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <label className="text-xs font-medium text-stone-500">
                                        Clock Out
                                      </label>
                                      <input
                                        type="datetime-local"
                                        value={editOut}
                                        onChange={(e) => setEditOut(e.target.value)}
                                        className="border border-stone-200 rounded-xl px-3 py-2
                                                   text-sm focus:outline-none focus:ring-2
                                                   focus:ring-emerald-400"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <label className="text-xs font-medium text-stone-500">
                                        Break (mins)
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        placeholder="e.g. 30"
                                        value={editBreakMins}
                                        onChange={(e) => setEditBreakMins(e.target.value)}
                                        className="border border-stone-200 rounded-xl px-3 py-2
                                                   text-sm focus:outline-none focus:ring-2
                                                   focus:ring-emerald-400"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <label className="text-xs font-medium text-amber-600">
                                        Override Total (hrs)
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.25"
                                        placeholder="e.g. 7.5"
                                        value={editTotalHours}
                                        onChange={(e) => setEditTotalHours(e.target.value)}
                                        className="border border-amber-300 rounded-xl px-3 py-2
                                                   text-sm focus:outline-none focus:ring-2
                                                   focus:ring-amber-400"
                                      />
                                    </div>
                                  </div>

                                  {/* Reason + manager note */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                      <label className="text-xs font-medium text-stone-500">
                                        Reason <span className="text-red-400">*</span>
                                      </label>
                                      <input
                                        type="text"
                                        placeholder="Required"
                                        value={editReason}
                                        onChange={(e) => setEditReason(e.target.value)}
                                        className="border border-stone-200 rounded-xl px-3 py-2
                                                   text-sm focus:outline-none focus:ring-2
                                                   focus:ring-emerald-400"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <label className="text-xs font-medium text-stone-500">
                                        Manager Note (internal)
                                      </label>
                                      <input
                                        type="text"
                                        placeholder="Optional"
                                        value={editManagerNote}
                                        onChange={(e) => setEditManagerNote(e.target.value)}
                                        className="border border-stone-200 rounded-xl px-3 py-2
                                                   text-sm focus:outline-none focus:ring-2
                                                   focus:ring-emerald-400"
                                      />
                                    </div>
                                  </div>

                                  {/* Live preview */}
                                  {(() => {
                                    const previewRaw =
                                      editIn && editOut
                                        ? Math.max(
                                            0,
                                            (new Date(editOut).getTime() -
                                              new Date(editIn).getTime()) /
                                              60_000
                                          )
                                        : null;
                                    const previewBreak =
                                      editBreakMins !== "" ? parseInt(editBreakMins, 10) : 0;
                                    const isOverridePreview = editTotalHours.trim() !== "";
                                    const previewFinal = isOverridePreview
                                      ? parseFloat(editTotalHours) * 60
                                      : previewRaw != null
                                        ? Math.max(0, previewRaw - previewBreak)
                                        : null;

                                    return (
                                      <div
                                        className={`rounded-xl px-4 py-3 text-sm
                                          ${isOverridePreview
                                            ? "bg-amber-50 border border-amber-200"
                                            : "bg-stone-100 border border-stone-200"
                                          }`}
                                      >
                                        <span className="text-stone-500 mr-2">Preview:</span>
                                        {previewRaw != null ? (
                                          <>
                                            Raw {formatHours(previewRaw)}
                                            {previewBreak > 0 && !isOverridePreview && (
                                              <span className="text-stone-400">
                                                {" "}- {previewBreak}m break
                                              </span>
                                            )}
                                            <span
                                              className={`ml-2 font-semibold
                                                ${isOverridePreview
                                                  ? "text-amber-600"
                                                  : "text-emerald-700"
                                                }`}
                                            >
                                              → Final{" "}
                                              {previewFinal != null
                                                ? formatHours(previewFinal)
                                                : "—"}
                                              {isOverridePreview && " (override)"}
                                            </span>
                                          </>
                                        ) : (
                                          <span className="text-stone-400">
                                            Enter clock in/out to preview
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* Save / cancel */}
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSaveEdit(session)}
                                      disabled={saving}
                                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white
                                                 text-sm font-medium hover:bg-emerald-700
                                                 disabled:opacity-50"
                                    >
                                      {saving ? "Saving…" : "Save Changes"}
                                    </button>
                                    <button
                                      onClick={cancelEdit}
                                      disabled={saving}
                                      className="px-4 py-2 rounded-xl border border-stone-200
                                                 text-stone-600 text-sm hover:bg-stone-100"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Approve All modal ── */}
      {approveAllOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-stone-800">Approve Whole Run</h2>
            <p className="text-sm text-stone-600">
              This will approve <strong>all closed sessions</strong> for all{" "}
              <strong>{totalEmployees}</strong> employee{totalEmployees !== 1 ? "s" : ""} in the
              current filter (
              {dateFrom} → {dateTo}
              {branchFilter !== "all" ? `, ${branchFilter}` : ""}).
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200
                           rounded-xl px-3 py-2">
              Open sessions are skipped. Any session edited after approval will need
              re-approval.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-stone-500">
                Approval note (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Payroll run approved for May 2026"
                value={approveAllNote}
                onChange={(e) => setApproveAllNote(e.target.value)}
                className="border border-stone-200 rounded-xl px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleApproveAll}
                disabled={approving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white
                           text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {approving ? "Approving…" : "Confirm — Approve All"}
              </button>
              <button
                onClick={() => setApproveAllOpen(false)}
                disabled={approving}
                className="px-4 py-2.5 rounded-xl border border-stone-200 text-stone-600
                           text-sm hover:bg-stone-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: "stone" | "green" | "amber" | "red" | "emerald";
  sub?: string;
}) {
  const colorMap = {
    stone:   "bg-stone-50   border-stone-200  text-stone-800",
    green:   "bg-green-50   border-green-200  text-green-800",
    amber:   "bg-amber-50   border-amber-200  text-amber-800",
    red:     "bg-red-50     border-red-200    text-red-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };

  return (
    <div className={`rounded-2xl border p-4 ${colorMap[color]}`}>
      <p className="text-xs font-medium opacity-70 uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: EmployeeRun["status"] }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                       font-semibold bg-emerald-100 text-emerald-700">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Approved
      </span>
    );
  }
  if (status === "needs_attention") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                       font-semibold bg-red-100 text-red-700">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3
               L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        Attention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                     font-semibold bg-amber-100 text-amber-700">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Pending
    </span>
  );
}
