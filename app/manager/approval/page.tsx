"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import EmployeeSearchSelect from "@/components/EmployeeSearchSelect";
import { PageHeader, SummaryCard } from "@/components/ui";
import {
  calcSessionFinalMinutes,
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
  // Audit columns
  edited: boolean | null;
  edited_by: string | null;
  edited_at: string | null;
  edit_reason: string | null;
  manually_added: boolean | null;
  manual_add_reason: string | null;
  // Time-correction columns
  break_minutes: number | null;
  edited_total_hours: number | null;
  manager_note: string | null;
  // Approval columns
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
};

// ─── Approval status per employee ─────────────────────────────────────────────
type ApprovalStatus = "approved" | "needs_attention" | "pending";

// ─── Per-employee computed row ─────────────────────────────────────────────────

type PayrollRow = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  pay_frequency: string;
  role: string;
  branch: string;
  sessions: ClockSession[];
  closedCount: number;
  workedMins: number;
  breakMins: number;
  hasDiscrepancy: boolean;
  editedCount: number;
  approvalStatus: ApprovalStatus;
};

// ─── Safe row mapper ──────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ClockSession {
  return row as unknown as ClockSession;
}

// ─── Derive per-employee approval status ──────────────────────────────────────
function deriveApprovalStatus(mySessions: ClockSession[]): ApprovalStatus {
  if (mySessions.length === 0) return "pending";
  // Any open session (no clock-out) = needs attention
  const hasOpen = mySessions.some((s) => !s.clock_out_time);
  if (hasOpen) return "needs_attention";
  // Any unedited suspicious flag = needs attention
  const hasSuspicious = mySessions.some(
    (s) => (s.suspicious_clock_in || s.suspicious_clock_out) && !s.edited
  );
  if (hasSuspicious) return "needs_attention";
  // All closed sessions approved = approved
  const closed = mySessions.filter((s) => s.clock_in_time && s.clock_out_time);
  if (closed.length > 0 && closed.every((s) => s.approved)) return "approved";
  return "pending";
}

// ─── Input class reused across all form inputs ─────────────────────────────────
const inputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 " +
  "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent " +
  "transition disabled:opacity-50";

// ─── Status badge component ───────────────────────────────────────────────────
function StatusBadge({ status }: { status: ApprovalStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1
                       rounded-full bg-emerald-100 text-emerald-700">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Approved
      </span>
    );
  }
  if (status === "needs_attention") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1
                       rounded-full bg-amber-100 text-amber-700">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        Needs Attention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1
                     rounded-full bg-stone-100 text-stone-500">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
      </svg>
      Pending Review
    </span>
  );
}

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
  const [allStaff, setAllStaff]     = useState<StaffMember[]>([]);
  const [sessions, setSessions]     = useState<ClockSession[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [hasLoaded, setHasLoaded]   = useState(false);
  const [loadError, setLoadError]   = useState("");

  // ── Expanded employee panel ───────────────────────────────────────────────────
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);

  // ── Edit session state ────────────────────────────────────────────────────────
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editIn, setEditIn]                     = useState("");
  const [editOut, setEditOut]                   = useState("");
  const [editReason, setEditReason]             = useState("");
  const [editBreakMins, setEditBreakMins]       = useState("");
  const [editTotalHours, setEditTotalHours]     = useState("");
  const [editManagerNote, setEditManagerNote]   = useState("");
  const [isSavingEdit, setIsSavingEdit]         = useState(false);
  const [editMessage, setEditMessage]           = useState("");
  const [editIsError, setEditIsError]           = useState(false);

  // ── Approval state ────────────────────────────────────────────────────────────
  const [approvingStaffId, setApprovingStaffId]         = useState<string | null>(null);
  const [approvalFeedback, setApprovalFeedback]         = useState("");
  const [approvalFeedbackIsError, setApprovalFeedbackIsError] = useState(false);
  const [showApproveAllModal, setShowApproveAllModal]   = useState(false);
  const [approveAllNote, setApproveAllNote]             = useState("");
  const [isApprovingAll, setIsApprovingAll]             = useState(false);
  const [approveAllError, setApproveAllError]           = useState("");

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
      const [settingsResult, allStaffResult] = await Promise.all([
        supabase.from("payroll_settings").select("*").limit(1).maybeSingle(),
        supabase
          .from("staff")
          .select("id, first_name, last_name, employee_number, pay_frequency, role, branch")
          .order("first_name", { ascending: true }),
      ]);

      const loadedSettings = (settingsResult.data as PayrollSettings | null) ?? null;
      setSettings(loadedSettings);
      setAllStaff((allStaffResult.data ?? []) as unknown as StaffMember[]);

      const period = calcPayPeriod(loadedSettings, "monthly");
      setDateFrom(period.from);
      setDateTo(period.to);

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
          "edited, edited_by, edited_at, edit_reason, manually_added, manual_add_reason, " +
          "break_minutes, edited_total_hours, manager_note, " +
          "approved, approved_by, approved_at, approval_note"
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
    setApprovalFeedback("");
  }

  // ─── Toggle employee detail panel ────────────────────────────────────────────
  function toggleExpand(staffId: string) {
    setExpandedStaffId((prev) => (prev === staffId ? null : staffId));
    setEditingSessionId(null);
    setEditMessage("");
    setApprovalFeedback("");
  }

  // ─── Start editing a session ──────────────────────────────────────────────────
  function startEdit(session: ClockSession) {
    setEditingSessionId(session.id);
    setEditIn(isoToDatetimeLocal(session.clock_in_time));
    setEditOut(isoToDatetimeLocal(session.clock_out_time));
    setEditReason("");
    setEditBreakMins(session.break_minutes != null ? String(session.break_minutes) : "");
    setEditTotalHours(session.edited_total_hours != null ? String(session.edited_total_hours) : "");
    setEditManagerNote(session.manager_note ?? "");
    setEditMessage("");
  }

  function cancelEdit() {
    setEditingSessionId(null);
    setEditIn("");
    setEditOut("");
    setEditReason("");
    setEditBreakMins("");
    setEditTotalHours("");
    setEditManagerNote("");
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

    if (newClockOut && new Date(newClockOut) <= new Date(newClockIn)) {
      setEditMessage("Clock-out must be after clock-in.");
      setEditIsError(true);
      return;
    }

    const newBreakMins: number | null =
      editBreakMins.trim() !== "" ? parseInt(editBreakMins, 10) : null;
    const newTotalHours: number | null =
      editTotalHours.trim() !== "" ? parseFloat(editTotalHours) : null;

    if (newBreakMins !== null && (isNaN(newBreakMins) || newBreakMins < 0)) {
      setEditMessage("Break minutes must be a positive whole number.");
      setEditIsError(true);
      return;
    }
    if (newTotalHours !== null && (isNaN(newTotalHours) || newTotalHours < 0)) {
      setEditMessage("Override total hours must be a positive number (e.g. 7.5).");
      setEditIsError(true);
      return;
    }

    const newManagerNote: string | null = editManagerNote.trim() || null;
    const now = new Date().toISOString();

    setIsSavingEdit(true);
    setEditMessage("");

    // ── Update the clock_session row — resets approval when times change ─────────
    const { error: updateError } = await supabase
      .from("clock_sessions")
      .update({
        clock_in_time:      newClockIn,
        clock_out_time:     newClockOut,
        status:             newClockOut ? "clocked_out" : "clocked_in",
        edited:             true,
        edited_by:          "Manager",
        edited_at:          now,
        edit_reason:        editReason.trim(),
        break_minutes:      newBreakMins,
        edited_total_hours: newTotalHours,
        manager_note:       newManagerNote,
        // Approval reset — edited sessions must be re-approved
        approved:           false,
        approved_by:        null,
        approved_at:        null,
      })
      .eq("id", session.id);

    if (updateError) {
      setEditMessage("Error saving: " + updateError.message);
      setEditIsError(true);
      setIsSavingEdit(false);
      return;
    }

    // ── Audit log ────────────────────────────────────────────────────────────────
    try {
      await supabase.from("time_edit_log").insert({
        clock_session_id:       session.id,
        staff_id:               session.staff_id,
        old_clock_in_time:      session.clock_in_time,
        old_clock_out_time:     session.clock_out_time,
        new_clock_in_time:      newClockIn,
        new_clock_out_time:     newClockOut,
        old_break_minutes:      session.break_minutes ?? null,
        new_break_minutes:      newBreakMins,
        old_edited_total_hours: session.edited_total_hours ?? null,
        new_edited_total_hours: newTotalHours,
        old_manager_note:       session.manager_note ?? null,
        new_manager_note:       newManagerNote,
        action_type:            "edit",
        changed_by:             "Manager",
        reason:                 editReason.trim(),
      });
    } catch (_) {
      // audit log failure is non-fatal
    }

    // ── Update local state ────────────────────────────────────────────────────────
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== session.id
          ? s
          : {
              ...s,
              clock_in_time:      newClockIn,
              clock_out_time:     newClockOut,
              status:             newClockOut ? "clocked_out" : "clocked_in",
              edited:             true,
              edited_by:          "Manager",
              edited_at:          now,
              edit_reason:        editReason.trim(),
              break_minutes:      newBreakMins,
              edited_total_hours: newTotalHours,
              manager_note:       newManagerNote,
              // Reset approval in local state too
              approved:           false,
              approved_by:        null,
              approved_at:        null,
            }
      )
    );

    cancelEdit();
    setIsSavingEdit(false);
  }

  // ─── Approve all sessions for one employee ────────────────────────────────────
  async function handleApproveEmployee(row: PayrollRow) {
    setApprovingStaffId(row.id);
    setApprovalFeedback("");
    setApprovalFeedbackIsError(false);

    const closedIds = row.sessions
      .filter((s) => s.clock_in_time && s.clock_out_time)
      .map((s) => s.id);

    if (closedIds.length === 0) {
      setApprovalFeedback("No closed sessions to approve for " + row.first_name + ".");
      setApprovalFeedbackIsError(true);
      setApprovingStaffId(null);
      return;
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("clock_sessions")
      .update({
        approved:      true,
        approved_by:   "Manager",
        approved_at:   now,
        approval_note: null,
      })
      .in("id", closedIds);

    if (error) {
      setApprovalFeedback("Error approving " + row.first_name + ": " + error.message);
      setApprovalFeedbackIsError(true);
    } else {
      setSessions((prev) =>
        prev.map((s) =>
          closedIds.includes(s.id)
            ? { ...s, approved: true, approved_by: "Manager", approved_at: now, approval_note: null }
            : s
        )
      );
      setApprovalFeedback(row.first_name + " " + row.last_name + " approved successfully.");
      setApprovalFeedbackIsError(false);
    }
    setApprovingStaffId(null);
  }

  // ─── Approve all visible sessions for the full period ─────────────────────────
  async function handleApproveFullPeriod() {
    setIsApprovingAll(true);
    setApproveAllError("");

    const allClosedIds = sessions
      .filter((s) => s.clock_in_time && s.clock_out_time)
      .map((s) => s.id);

    if (allClosedIds.length === 0) {
      setApproveAllError("No closed sessions found to approve.");
      setIsApprovingAll(false);
      return;
    }

    const now = new Date().toISOString();
    const note = approveAllNote.trim() || null;
    const CHUNK = 200;

    try {
      for (let i = 0; i < allClosedIds.length; i += CHUNK) {
        const chunk = allClosedIds.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("clock_sessions")
          .update({
            approved:      true,
            approved_by:   "Manager",
            approved_at:   now,
            approval_note: note,
          })
          .in("id", chunk);
        if (error) throw error;
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.clock_in_time && s.clock_out_time
            ? { ...s, approved: true, approved_by: "Manager", approved_at: now, approval_note: note }
            : s
        )
      );
      setShowApproveAllModal(false);
      setApproveAllNote("");
      setApprovalFeedback(`All ${allClosedIds.length} sessions approved for this pay period.`);
      setApprovalFeedbackIsError(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setApproveAllError("Error: " + msg);
    }

    setIsApprovingAll(false);
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

    const fullReason = manualNotes.trim()
      ? `${manualReason.trim()} — Notes: ${manualNotes.trim()}`
      : manualReason.trim();

    const { data: newRow, error: insertError } = await supabase
      .from("clock_sessions")
      .insert({
        staff_id:          manualStaffId,
        work_date:         manualDate,
        clock_in_time:     clockInISO,
        clock_out_time:    clockOutISO,
        status:            clockOutISO ? "clocked_out" : "clocked_in",
        manually_added:    true,
        manual_add_reason: fullReason,
      })
      .select()
      .single();

    if (insertError) {
      setManualMessage("Error adding entry: " + insertError.message);
      setManualIsError(true);
      setIsSavingManual(false);
      return;
    }

    const insertedSession = toSession(newRow);

    try {
      await supabase.from("time_edit_log").insert({
        clock_session_id:   insertedSession.id,
        staff_id:           manualStaffId,
        new_clock_in_time:  clockInISO,
        new_clock_out_time: clockOutISO,
        action_type:        "manual_add",
        changed_by:         "Manager",
        reason:             fullReason,
      });
    } catch (_) {
      // audit log failure is non-fatal
    }

    if (manualDate >= dateFrom && manualDate <= dateTo) {
      setSessions((prev) => [insertedSession, ...prev]);
    }

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
      workedMins:      mySessions.reduce((sum, s) => sum + calcSessionFinalMinutes(s), 0),
      breakMins:       mySessions.reduce((sum, s) => sum + (s.break_minutes ?? 0), 0),
      hasDiscrepancy:  mySessions.some(
        (s) => (s.suspicious_clock_in || s.suspicious_clock_out) && !s.edited
      ),
      editedCount:     mySessions.filter((s) => s.edited || s.manually_added).length,
      approvalStatus:  deriveApprovalStatus(mySessions),
    };
  });

  // Approval summary counts
  const activeRows           = payrollRows.filter((r) => r.sessions.length > 0);
  const approvedRows         = activeRows.filter((r) => r.approvalStatus === "approved");
  const pendingRows          = activeRows.filter((r) => r.approvalStatus === "pending");
  const needsAttentionRows   = activeRows.filter((r) => r.approvalStatus === "needs_attention");

  const approvedHoursMins    = approvedRows.reduce((s, r) => s + r.workedMins, 0);
  const pendingHoursMins     = [...pendingRows, ...needsAttentionRows].reduce((s, r) => s + r.workedMins, 0);

  const totalDiscrepancies   = payrollRows.filter((r) => r.hasDiscrepancy).length;
  const totalEdited          = sessions.filter((s) => s.edited || s.manually_added).length;

  // Sort: needs_attention first, then pending, then approved
  const SORT_ORDER: Record<ApprovalStatus, number> = {
    needs_attention: 0,
    pending:         1,
    approved:        2,
  };
  const sortedRows = [...payrollRows].sort(
    (a, b) => SORT_ORDER[a.approvalStatus] - SORT_ORDER[b.approvalStatus]
  );

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
        {session.approved && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            ✓ Approved
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date" value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date" value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={inputCls}
              />
            </div>

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

        {loadError && (
          <p className="text-sm text-red-500 text-center bg-red-50 border border-red-100
                        rounded-2xl px-4 py-4">
            {loadError}
          </p>
        )}

        {/* ══ B. SUMMARY CARDS ═══════════════════════════════════════════════ */}
        {hasLoaded && !isLoading && (
          <>
            {/* Row 1 — data overview */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                label="Employees in Period"
                value={activeRows.length}
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

            {/* Row 2 — approval overview */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                label="Approved"
                value={approvedRows.length}
                sub="employees approved"
                valueColor={approvedRows.length > 0 ? "text-emerald-600" : "text-gray-300"}
              />
              <SummaryCard
                label="Pending Review"
                value={pendingRows.length + needsAttentionRows.length}
                sub={`${needsAttentionRows.length} needs attention`}
                valueColor={pendingRows.length + needsAttentionRows.length > 0 ? "text-amber-500" : "text-gray-300"}
              />
              <SummaryCard
                label="Approved Hours"
                value={approvedHoursMins > 0 ? formatHours(approvedHoursMins) : "—"}
                sub="approved employee hours"
                valueColor="text-emerald-600"
              />
              <SummaryCard
                label="Pending Hours"
                value={pendingHoursMins > 0 ? formatHours(pendingHoursMins) : "—"}
                sub="not yet approved"
                valueColor={pendingHoursMins > 0 ? "text-amber-500" : "text-gray-300"}
              />
            </section>
          </>
        )}

        {/* ══ C. EMPLOYEE TABLE ══════════════════════════════════════════════ */}
        {hasLoaded && !isLoading && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

            {/* Section header + Approve Full Period button */}
            <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-700">Employee Time Review</h2>
              <button
                onClick={() => setShowApproveAllModal(true)}
                disabled={sessions.filter((s) => s.clock_in_time && s.clock_out_time).length === 0}
                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600
                           active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                           text-white font-semibold text-xs rounded-xl px-4 py-2
                           transition-all duration-150 shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Approve Full Period
              </button>
            </div>

            {/* Global approval feedback */}
            {approvalFeedback && (
              <div className={`mx-5 mt-4 text-sm rounded-xl px-4 py-2.5 ${
                approvalFeedbackIsError
                  ? "bg-red-50 text-red-600"
                  : "bg-emerald-50 text-emerald-700"
              }`}>
                {approvalFeedback}
              </div>
            )}

            {sortedRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-gray-400 text-sm">
                No employees matched the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">

                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {["Emp #", "Name & Status", "Role", "Department", "Pay", "Sessions", "Worked", "Break", ""].map(
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
                    {sortedRows.map((row) => (
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
                            <div className="flex gap-1 mt-1 flex-wrap">
                              <StatusBadge status={row.approvalStatus} />
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

                          {/* Actions */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              {/* Approve Employee button */}
                              {row.approvalStatus !== "approved" ? (
                                <button
                                  onClick={() => handleApproveEmployee(row)}
                                  disabled={
                                    approvingStaffId === row.id ||
                                    row.approvalStatus === "needs_attention"
                                  }
                                  title={
                                    row.approvalStatus === "needs_attention"
                                      ? "Resolve open sessions or flags before approving"
                                      : "Approve all closed sessions for this employee"
                                  }
                                  className="text-xs font-semibold text-emerald-700 hover:text-white
                                             hover:bg-emerald-500 border border-emerald-300
                                             hover:border-emerald-500 rounded-lg px-2.5 py-1.5
                                             transition-all duration-150 disabled:opacity-40
                                             disabled:cursor-not-allowed"
                                >
                                  {approvingStaffId === row.id ? "…" : "Approve"}
                                </button>
                              ) : (
                                <span className="text-xs text-emerald-500 font-medium px-2.5 py-1.5">
                                  ✓ Done
                                </span>
                              )}
                              <button
                                onClick={() => toggleExpand(row.id)}
                                className="text-xs font-semibold text-emerald-600 hover:text-emerald-800
                                           hover:bg-emerald-50 rounded-lg px-3 py-1.5 transition-colors"
                              >
                                {expandedStaffId === row.id ? "Collapse ▲" : "View / Edit ▼"}
                              </button>
                            </div>
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
                                    <div className="flex items-center justify-between mb-3">
                                      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                                        Sessions for {row.first_name} {row.last_name}
                                      </p>
                                      <StatusBadge status={row.approvalStatus} />
                                    </div>

                                    {/* Attention note for needs_attention */}
                                    {row.approvalStatus === "needs_attention" && (
                                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-3">
                                        <p className="text-xs text-amber-700 font-medium">
                                          ⚠ This employee has open sessions or flagged entries that need review before approval.
                                          Close any open sessions and resolve flags first.
                                        </p>
                                      </div>
                                    )}

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
                                        className={`bg-white rounded-xl border overflow-hidden
                                          ${session.approved
                                            ? "border-emerald-200"
                                            : "border-stone-200"
                                          }`}>

                                        {/* ── Session display row ── */}
                                        {editingSessionId !== session.id && (
                                          <div className="px-4 py-3 flex items-start gap-3 flex-wrap">
                                            {/* Approved indicator strip */}
                                            {session.approved && (
                                              <div className="w-full flex items-center gap-2 mb-1">
                                                <span className="text-xs text-emerald-600 font-medium">
                                                  ✓ Approved by {session.approved_by}
                                                  {session.approved_at && (
                                                    <span className="text-emerald-400 ml-1">
                                                      · {new Date(session.approved_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                                                    </span>
                                                  )}
                                                </span>
                                              </div>
                                            )}

                                            <div className="w-28 shrink-0">
                                              <p className="text-xs text-stone-400">Date</p>
                                              <p className="text-sm font-medium text-stone-700">
                                                {formatDate(session.work_date)}
                                              </p>
                                            </div>

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

                                              {session.clock_in_time && session.clock_out_time && (() => {
                                                const rawMins = Math.round(
                                                  (new Date(session.clock_out_time).getTime() -
                                                    new Date(session.clock_in_time).getTime()) / 60_000
                                                );
                                                const finalMins = calcSessionFinalMinutes(session);
                                                const isOverride = session.edited_total_hours != null;
                                                return (
                                                  <>
                                                    <div>
                                                      <p className="text-xs text-stone-400">Raw Span</p>
                                                      <p className="text-sm text-stone-500">
                                                        {Math.floor(rawMins / 60)}h {rawMins % 60}m
                                                      </p>
                                                    </div>
                                                    {(session.break_minutes ?? 0) > 0 && (
                                                      <div>
                                                        <p className="text-xs text-stone-400">Break</p>
                                                        <p className="text-sm text-stone-500">
                                                          {session.break_minutes}m
                                                        </p>
                                                      </div>
                                                    )}
                                                    <div>
                                                      <p className="text-xs text-stone-400 flex items-center gap-1">
                                                        Final
                                                        {isOverride && (
                                                          <span className="text-amber-500 font-medium">⚠ override</span>
                                                        )}
                                                      </p>
                                                      <p className={`text-sm font-semibold ${isOverride ? "text-amber-600" : "text-emerald-600"}`}>
                                                        {formatHours(finalMins)}
                                                      </p>
                                                    </div>
                                                  </>
                                                );
                                              })()}
                                            </div>

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
                                            {session.manager_note && (
                                              <p className="w-full text-xs text-stone-400 mt-0.5">
                                                Manager note: <span className="italic text-stone-500">{session.manager_note}</span>
                                              </p>
                                            )}
                                            {session.manual_add_reason && (
                                              <p className="w-full text-xs text-stone-400 mt-0.5">
                                                Manual reason: <span className="italic">{session.manual_add_reason}</span>
                                              </p>
                                            )}
                                            {session.approval_note && (
                                              <p className="w-full text-xs text-emerald-500 mt-0.5">
                                                Approval note: <span className="italic">{session.approval_note}</span>
                                              </p>
                                            )}
                                          </div>
                                        )}

                                        {/* ── Edit form ── */}
                                        {editingSessionId === session.id && (() => {
                                          const previewRawMins: number | null =
                                            editIn && editOut
                                              ? Math.max(0,
                                                  (new Date(editOut).getTime() -
                                                    new Date(editIn).getTime()) / 60_000
                                                )
                                              : null;
                                          const previewBreakMins = parseFloat(editBreakMins) || 0;
                                          const isOverride = editTotalHours.trim() !== "";
                                          const previewFinalMins: number | null = isOverride
                                            ? (isNaN(parseFloat(editTotalHours))
                                                ? null
                                                : parseFloat(editTotalHours) * 60)
                                            : previewRawMins != null
                                              ? Math.max(0, previewRawMins - previewBreakMins)
                                              : null;

                                          const fmtMins = (m: number) =>
                                            `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;

                                          return (
                                            <div className="px-4 py-4 bg-sky-50 border-l-4 border-sky-400">
                                              <p className="text-xs font-semibold text-sky-700 uppercase
                                                            tracking-wider mb-1">
                                                Editing session — {formatDate(session.work_date)}
                                              </p>
                                              {session.approved && (
                                                <p className="text-xs text-amber-600 font-medium mb-3">
                                                  ⚠ Saving this edit will reset approval — this session will need to be re-approved.
                                                </p>
                                              )}

                                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
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
                                                    Break Minutes
                                                    <span className="ml-1 font-normal text-stone-400">(optional)</span>
                                                  </label>
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={editBreakMins}
                                                    onChange={(e) => setEditBreakMins(e.target.value)}
                                                    placeholder="e.g. 30"
                                                    className={inputCls}
                                                  />
                                                  <p className="text-[10px] text-stone-400 mt-0.5">
                                                    Deducted from worked time
                                                  </p>
                                                </div>
                                                <div>
                                                  <label className="block text-xs font-medium text-stone-600 mb-1">
                                                    Override Total Hours
                                                    <span className="ml-1 font-normal text-stone-400">(optional)</span>
                                                  </label>
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    step="0.25"
                                                    value={editTotalHours}
                                                    onChange={(e) => setEditTotalHours(e.target.value)}
                                                    placeholder="e.g. 7.5"
                                                    className={inputCls}
                                                  />
                                                  <p className="text-[10px] text-stone-400 mt-0.5">
                                                    Skips auto-calculation
                                                  </p>
                                                </div>
                                              </div>

                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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
                                                <div>
                                                  <label className="block text-xs font-medium text-stone-600 mb-1">
                                                    Manager Note
                                                    <span className="ml-1 font-normal text-stone-400">(internal, optional)</span>
                                                  </label>
                                                  <input
                                                    type="text"
                                                    value={editManagerNote}
                                                    onChange={(e) => setEditManagerNote(e.target.value)}
                                                    placeholder="e.g. Confirmed with employee via WhatsApp"
                                                    className={inputCls}
                                                  />
                                                </div>
                                              </div>

                                              {/* Live preview */}
                                              <div className={`rounded-xl px-4 py-2.5 mb-3 text-xs flex flex-wrap gap-x-4 gap-y-1
                                                              ${isOverride
                                                                ? "bg-amber-50 border border-amber-200"
                                                                : "bg-emerald-50 border border-emerald-100"}`}>
                                                <span className="font-semibold text-stone-500">Preview:</span>
                                                {previewRawMins != null && (
                                                  <span className="text-stone-500">
                                                    Raw span: <strong>{fmtMins(previewRawMins)}</strong>
                                                  </span>
                                                )}
                                                {previewBreakMins > 0 && !isOverride && (
                                                  <span className="text-stone-500">
                                                    Break: <strong>{previewBreakMins}m</strong>
                                                  </span>
                                                )}
                                                {previewFinalMins != null ? (
                                                  <span className={isOverride ? "text-amber-700 font-semibold" : "text-emerald-700 font-semibold"}>
                                                    Final: {fmtMins(previewFinalMins)}
                                                    {" "}({(previewFinalMins / 60).toFixed(2)} hrs)
                                                    {isOverride && " ⚠ overridden"}
                                                  </span>
                                                ) : (
                                                  <span className="text-stone-400 italic">
                                                    Enter clock-in and clock-out to preview
                                                  </span>
                                                )}
                                              </div>

                                              {editMessage && (
                                                <p className={`text-xs mb-2 rounded-lg px-3 py-1.5
                                                               ${editIsError
                                                                 ? "bg-red-50 text-red-600"
                                                                 : "bg-emerald-50 text-emerald-600"}`}>
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
                                          );
                                        })()}

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
                  {sortedRows.length > 0 && (
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                          Totals
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-stone-700">
                          {sortedRows.reduce((s, r) => s + r.closedCount, 0)}
                        </td>
                        <td className="px-4 py-3 font-bold text-emerald-600 whitespace-nowrap">
                          {formatHours(sortedRows.reduce((s, r) => s + r.workedMins, 0))}
                        </td>
                        <td className="px-4 py-3 font-bold text-stone-500 whitespace-nowrap">
                          {formatHours(sortedRows.reduce((s, r) => s + r.breakMins, 0))}
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

                <div className="sm:col-span-2 lg:col-span-1">
                  <EmployeeSearchSelect
                    employees={allStaff}
                    selectedEmployeeId={manualStaffId}
                    onSelect={setManualStaffId}
                    label="Employee *"
                    placeholder="Search by name, number, role…"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Work Date *</label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    required
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Clock In Time *</label>
                  <input
                    type="time"
                    value={manualIn}
                    onChange={(e) => setManualIn(e.target.value)}
                    required
                    className={inputCls}
                  />
                </div>

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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
                  <input
                    type="text"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder="e.g. Employee forgot to clock in"
                    required
                    className={inputCls}
                  />
                </div>

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

      {/* ══ F. APPROVE FULL PERIOD MODAL ══════════════════════════════════════ */}
      {showApproveAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-800">Approve Full Pay Period</h3>
                <p className="text-xs text-stone-400 mt-0.5">
                  This will approve all closed sessions from{" "}
                  <span className="font-medium text-stone-600">{dateFrom}</span> to{" "}
                  <span className="font-medium text-stone-600">{dateTo}</span>.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-amber-700">
                <strong>
                  {sessions.filter((s) => s.clock_in_time && s.clock_out_time && !s.approved).length}
                </strong>{" "}
                sessions will be approved.
                {needsAttentionRows.length > 0 && (
                  <span className="block mt-1">
                    ⚠ <strong>{needsAttentionRows.length}</strong> employee{needsAttentionRows.length > 1 ? "s have" : " has"} open
                    sessions or flags — their closed sessions will still be approved, but open sessions are excluded.
                  </span>
                )}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Approval Note
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <input
                type="text"
                value={approveAllNote}
                onChange={(e) => setApproveAllNote(e.target.value)}
                placeholder="e.g. Approved for May payroll run"
                className={inputCls}
                disabled={isApprovingAll}
              />
            </div>

            {approveAllError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5 mb-4">
                {approveAllError}
              </p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowApproveAllModal(false); setApproveAllNote(""); setApproveAllError(""); }}
                disabled={isApprovingAll}
                className="text-stone-500 hover:text-stone-700 font-medium text-sm px-4 py-2
                           transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveFullPeriod}
                disabled={isApprovingAll}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm
                           rounded-xl px-5 py-2 transition-colors disabled:opacity-60
                           disabled:cursor-not-allowed"
              >
                {isApprovingAll ? "Approving…" : "Confirm Approve All"}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
