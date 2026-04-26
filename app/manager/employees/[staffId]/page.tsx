"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  employee_number: string;
  pay_frequency: string;
  role: string;
  branch: string;
};

type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;           // "YYYY-MM-DD"
  clock_in_time: string;       // ISO timestamp
  clock_out_time: string | null;
  status: string;
  suspicious_clock_in: boolean | null;
  suspicious_clock_in_reason: string | null;
  suspicious_clock_out: boolean | null;
  suspicious_clock_out_reason: string | null;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

// Returns today as "YYYY-MM-DD" in the device's local timezone
function localToday(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// Returns the date of Monday of the current week as "YYYY-MM-DD"
// Monday is treated as the start of the working week.
function startOfThisWeek(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();                    // 0 = Sunday, 1 = Monday …
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  return [
    monday.getFullYear(),
    String(monday.getMonth() + 1).padStart(2, "0"),
    String(monday.getDate()).padStart(2, "0"),
  ].join("-");
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

// Formats an ISO timestamp to a short time string e.g. "08:30"
function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Formats a "YYYY-MM-DD" date string to e.g. "Mon, 3 Apr"
// Constructs using local time to avoid off-by-one timezone issues.
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// ─── Calculation helpers ──────────────────────────────────────────────────────

/**
 * calcWorkedHoursThisWeek
 * Filters sessions to the current week (Monday → today), sums closed sessions.
 * Returns hours as a number rounded to 2 decimal places.
 */
function calcWorkedHoursThisWeek(sessions: ClockSession[]): number {
  const weekStart = startOfThisWeek();
  const today     = localToday();

  const closedThisWeek = sessions.filter(
    (s) =>
      s.work_date >= weekStart &&
      s.work_date <= today &&
      s.clock_in_time &&
      s.clock_out_time
  );

  const totalMs = closedThisWeek.reduce((sum, s) => {
    const ms = new Date(s.clock_out_time!).getTime() - new Date(s.clock_in_time).getTime();
    return sum + ms;
  }, 0);

  return Math.round((totalMs / 3_600_000) * 100) / 100; // ms → hours, 2dp
}

/**
 * countSessionsThisWeek
 * Returns the count of closed sessions in the current week.
 */
function countSessionsThisWeek(sessions: ClockSession[]): number {
  const weekStart = startOfThisWeek();
  const today     = localToday();
  return sessions.filter(
    (s) =>
      s.work_date >= weekStart &&
      s.work_date <= today &&
      s.clock_in_time &&
      s.clock_out_time
  ).length;
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function statusBadge(status: string) {
  if (status === "clocked_in") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5
                       rounded-full bg-emerald-100 text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Clocked In
      </span>
    );
  }
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">
      Clocked Out
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = use(params);

  // ── Data state ───────────────────────────────────────────────────────────────
  const [staff, setStaff]         = useState<StaffMember | null>(null);
  const [sessions, setSessions]   = useState<ClockSession[]>([]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound]   = useState(false);
  const [loadError, setLoadError] = useState("");

  // ─── Load data on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!staffId || staffId.trim() === "") {
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    async function fetchData() {
      // Load staff info and recent sessions in parallel
      const [staffResult, sessionResult] = await Promise.all([
        supabase
          .from("staff")
          .select("*")
          .eq("id", staffId)
          .single(),

        supabase
          .from("clock_sessions")
          .select("*")
          .eq("staff_id", staffId)
          .order("work_date",      { ascending: false })
          .order("clock_in_time",  { ascending: false })
          .limit(100), // enough to cover suspicious count + this week + 10 most recent
      ]);

      if (staffResult.error || !staffResult.data) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      if (sessionResult.error) {
        setLoadError("Could not load clock sessions.");
      }

      setStaff(staffResult.data as StaffMember);
      setSessions((sessionResult.data ?? []) as ClockSession[]);
      setIsLoading(false);
    }

    fetchData();
  }, [staffId]);

  // ─── Derived values (computed from loaded sessions) ───────────────────────────

  // 10 most recent sessions for display (sessions are already ordered newest first)
  const recentSessions = sessions.slice(0, 10);

  // Suspicious flags across all loaded sessions
  const suspiciousInCount  = sessions.filter((s) => s.suspicious_clock_in).length;
  const suspiciousOutCount = sessions.filter((s) => s.suspicious_clock_out).length;
  const totalSuspicious    = suspiciousInCount + suspiciousOutCount;

  // Hours and sessions this week
  const hoursThisWeek    = calcWorkedHoursThisWeek(sessions);
  const sessionsThisWeek = countSessionsThisWeek(sessions);

  // The very latest clock event (first in the sorted list)
  const latestSession = sessions[0] ?? null;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 font-sans">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-stone-200 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">

          {/* Back arrow */}
          <Link
            href="/manager/staff"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500
                       hover:bg-stone-100 active:scale-95 transition-all duration-150 shrink-0"
            aria-label="Back to staff list"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-stone-800 tracking-tight leading-tight">
              {staff ? `${staff.first_name} ${staff.last_name}` : "Employee Profile"}
            </h1>
            <p className="text-xs text-stone-400 truncate">
              {staff?.employee_number ? `#${staff.employee_number} · ` : ""}
              {staff?.role ?? ""}
            </p>
          </div>

          {/* Edit shortcut */}
          <Link
            href={`/manager/staff/${staffId}`}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-stone-500
                       hover:text-emerald-700 hover:bg-emerald-50 border border-stone-200
                       hover:border-emerald-200 rounded-lg px-3 py-1.5 transition-all duration-150"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </Link>
        </div>
      </header>

      <ManagerNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="space-y-4 animate-pulse">
            <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="flex gap-4">
                  <div className="h-3 bg-stone-200 rounded w-24" />
                  <div className="h-3 bg-stone-100 rounded flex-1" />
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-stone-200 p-6 h-40" />
          </div>
        )}

        {/* ── Not found ── */}
        {!isLoading && notFound && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0
                     001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <p className="text-stone-700 font-semibold mb-1">Employee not found</p>
            <p className="text-sm text-stone-400 mb-6">This link may be invalid.</p>
            <Link
              href="/manager/staff"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white
                         font-semibold text-sm rounded-xl px-5 py-2.5 transition-colors"
            >
              ← Back to Staff
            </Link>
          </div>
        )}

        {/* ── Main content ── */}
        {!isLoading && !notFound && staff && (
          <>
            {/* ─── A. Employee Info ─── */}
            <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">
                Employee Info
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {[
                  { label: "Full Name",       value: `${staff.first_name} ${staff.last_name}` },
                  { label: "Employee #",      value: staff.employee_number || "—" },
                  { label: "Role",            value: staff.role || "—" },
                  { label: "Department",      value: staff.branch || "—" },
                  { label: "Pay Frequency",   value: staff.pay_frequency ? (staff.pay_frequency.charAt(0).toUpperCase() + staff.pay_frequency.slice(1)) : "—" },
                  { label: "Phone",           value: staff.phone_number || "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start justify-between gap-2 py-1
                                              border-b border-stone-50 last:border-0">
                    <span className="text-sm text-stone-400 shrink-0">{label}</span>
                    <span className="text-sm font-medium text-stone-800 text-right">{value}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* ─── D. Hours & Sessions This Week ─── */}
            <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">

              {/* Total hours this week */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm px-4 py-4">
                <p className="text-xs text-stone-400 mb-1">Hours This Week</p>
                <p className={`text-2xl font-bold ${hoursThisWeek > 0 ? "text-emerald-600" : "text-stone-300"}`}>
                  {hoursThisWeek.toFixed(2)}
                </p>
                <p className="text-xs text-stone-400 mt-0.5">hrs</p>
              </div>

              {/* Sessions this week */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm px-4 py-4">
                <p className="text-xs text-stone-400 mb-1">Sessions This Week</p>
                <p className={`text-2xl font-bold ${sessionsThisWeek > 0 ? "text-stone-700" : "text-stone-300"}`}>
                  {sessionsThisWeek}
                </p>
                <p className="text-xs text-stone-400 mt-0.5">shifts</p>
              </div>

              {/* Latest clock event */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm px-4 py-4 col-span-2 sm:col-span-1">
                <p className="text-xs text-stone-400 mb-1">Last Clock Event</p>
                {latestSession ? (
                  <>
                    <p className="text-sm font-semibold text-stone-700">
                      {formatDate(latestSession.work_date)}
                    </p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      In {formatTime(latestSession.clock_in_time)}
                      {latestSession.clock_out_time
                        ? ` · Out ${formatTime(latestSession.clock_out_time)}`
                        : " · Still in"}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-stone-300">No sessions yet</p>
                )}
              </div>

            </section>

            {/* ─── C. Suspicious Flags Summary ─── */}
            {totalSuspicious > 0 && (
              <section className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2
                           2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      Suspicious Clock Flags Detected
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      {suspiciousInCount > 0 && `${suspiciousInCount} suspicious clock-in${suspiciousInCount !== 1 ? "s" : ""}`}
                      {suspiciousInCount > 0 && suspiciousOutCount > 0 && " · "}
                      {suspiciousOutCount > 0 && `${suspiciousOutCount} suspicious clock-out${suspiciousOutCount !== 1 ? "s" : ""}`}
                      {" "}(from the last 100 sessions)
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* No suspicious flags — small green note */}
            {totalSuspicious === 0 && sessions.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 px-1">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                No suspicious clock flags in the last {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              </div>
            )}

            {/* ─── B. Recent Clock Sessions ─── */}
            <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-stone-700">Recent Clock Sessions</h2>
                <span className="text-xs text-stone-400">
                  {recentSessions.length === 0
                    ? "No sessions yet"
                    : `Showing ${recentSessions.length} most recent`}
                </span>
              </div>

              {recentSessions.length === 0 ? (
                <div className="px-5 py-8 text-center text-stone-400 text-sm">
                  No clock sessions recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-stone-50">
                  {recentSessions.map((session) => (
                    <div key={session.id} className="px-5 py-3.5">

                      {/* Top row: date + status */}
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-sm font-semibold text-stone-700">
                          {formatDate(session.work_date)}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Suspicious clock-in badge */}
                          {session.suspicious_clock_in && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full
                                             bg-amber-100 text-amber-700" title={session.suspicious_clock_in_reason ?? ""}>
                              ⚠ In
                            </span>
                          )}
                          {/* Suspicious clock-out badge */}
                          {session.suspicious_clock_out && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full
                                             bg-amber-100 text-amber-700" title={session.suspicious_clock_out_reason ?? ""}>
                              ⚠ Out
                            </span>
                          )}
                          {statusBadge(session.status)}
                        </div>
                      </div>

                      {/* Bottom row: times */}
                      <div className="flex items-center gap-4 text-xs text-stone-400">
                        <span>
                          <span className="text-stone-500 font-medium">In</span>{" "}
                          {formatTime(session.clock_in_time)}
                        </span>
                        <span>
                          <span className="text-stone-500 font-medium">Out</span>{" "}
                          {session.clock_out_time
                            ? formatTime(session.clock_out_time)
                            : <span className="text-emerald-500">Still in</span>}
                        </span>
                        {/* Duration */}
                        {session.clock_in_time && session.clock_out_time && (
                          <span className="text-stone-300">
                            {(() => {
                              const mins = Math.round(
                                (new Date(session.clock_out_time).getTime() -
                                  new Date(session.clock_in_time).getTime()) / 60_000
                              );
                              return `${Math.floor(mins / 60)}h ${mins % 60}m`;
                            })()}
                          </span>
                        )}
                      </div>

                      {/* Suspicious reasons — shown below if present */}
                      {session.suspicious_clock_in_reason && (
                        <p className="text-xs text-amber-600 mt-1 truncate">
                          ⚠ Clock-in: {session.suspicious_clock_in_reason}
                        </p>
                      )}
                      {session.suspicious_clock_out_reason && (
                        <p className="text-xs text-amber-600 mt-0.5 truncate">
                          ⚠ Clock-out: {session.suspicious_clock_out_reason}
                        </p>
                      )}

                    </div>
                  ))}
                </div>
              )}
            </section>

            {loadError && (
              <p className="text-sm text-red-500 text-center bg-red-50 rounded-2xl px-4 py-3">
                {loadError}
              </p>
            )}
          </>
        )}

      </main>
    </div>
  );
}
