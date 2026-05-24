"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  formatDate,
  formatTime,
  formatHours,
  calcSessionFinalMinutes,
  localToday,
  toDateStr,
} from "@/lib/time-calc";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  branch: string;
};

type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  break_minutes: number | null;
  edited_total_hours: number | null;
  status: string;
  manually_added: boolean | null;
  edited: boolean | null;
};

// Bypasses Supabase GenericStringError for migration-added columns
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ClockSession {
  return row as unknown as ClockSession;
}

type FilterOption = "this_week" | "this_month" | "last_30";

// ─── Filter date range helper ─────────────────────────────────────────────────

function getFilterRange(filter: FilterOption): { from: string; to: string } {
  const today = new Date();
  const todayStr = localToday();

  if (filter === "this_week") {
    // Start from Monday of the current week
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday …
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + daysToMonday);
    return { from: toDateStr(monday), to: todayStr };
  }

  if (filter === "this_month") {
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toDateStr(firstOfMonth), to: todayStr };
  }

  // last_30 — rolling 30-day window
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  return { from: toDateStr(thirtyDaysAgo), to: todayStr };
}

// ─── Group sessions by work_date ─────────────────────────────────────────────

function groupByDate(sessions: ClockSession[]): Record<string, ClockSession[]> {
  const groups: Record<string, ClockSession[]> = {};
  for (const s of sessions) {
    if (!groups[s.work_date]) groups[s.work_date] = [];
    groups[s.work_date].push(s);
  }
  // Within each day, sort by clock-in time (earliest first)
  for (const date in groups) {
    groups[date].sort((a, b) => {
      if (!a.clock_in_time) return 1;
      if (!b.clock_in_time) return -1;
      return (
        new Date(a.clock_in_time).getTime() -
        new Date(b.clock_in_time).getTime()
      );
    });
  }
  return groups;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MyTimesPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = use(params);

  // ── Data state ───────────────────────────────────────────────────────────────
  const [staff,    setStaff]    = useState<StaffMember | null>(null);
  const [sessions, setSessions] = useState<ClockSession[]>([]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg,  setErrorMsg]  = useState("");
  const [filter,    setFilter]    = useState<FilterOption>("this_month");

  // ─── Load data ────────────────────────────────────────────────────────────────
  async function loadData() {
    setIsLoading(true);
    setErrorMsg("");

    // 1. Look up the staff member
    const { data: staffData, error: staffError } = await supabase
      .from("staff")
      .select("id, first_name, last_name, role, branch")
      .eq("id", staffId)
      .single();

    if (staffError || !staffData) {
      setErrorMsg("Staff member not found. Please check your link.");
      setIsLoading(false);
      return;
    }

    setStaff(staffData as StaffMember);

    // 2. Load the last 90 days of sessions.
    //    Filtering by date range happens client-side so switching filters
    //    is instant — no extra network round-trips.
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: sessionData, error: sessionError } = await supabase
      .from("clock_sessions")
      .select(
        "id, staff_id, work_date, clock_in_time, clock_out_time, " +
        "break_minutes, edited_total_hours, status, manually_added, edited"
      )
      .eq("staff_id", staffId)
      .gte("work_date", toDateStr(ninetyDaysAgo))
      .order("work_date",      { ascending: false })
      .order("clock_in_time",  { ascending: false });

    if (sessionError) {
      setErrorMsg("Could not load your times. Please try again.");
      setIsLoading(false);
      return;
    }

    setSessions((sessionData ?? []).map(toSession));
    setIsLoading(false);
  }

  useEffect(() => {
    if (!staffId || staffId.trim() === "") {
      setErrorMsg("Invalid staff link.");
      setIsLoading(false);
      return;
    }
    loadData();
  }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived values ───────────────────────────────────────────────────────────

  const { from: filterFrom, to: filterTo } = getFilterRange(filter);

  // Only show sessions that fall inside the chosen date range
  const filteredSessions = sessions.filter(
    (s) => s.work_date >= filterFrom && s.work_date <= filterTo
  );

  // Group newest dates first
  const grouped    = groupByDate(filteredSessions);
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  // Total worked hours for the current filter window
  const totalMins = filteredSessions.reduce(
    (sum, s) => sum + calcSessionFinalMinutes(s),
    0
  );

  const filterLabels: Record<FilterOption, string> = {
    this_week:  "This week",
    this_month: "This month",
    last_30:    "Last 30 days",
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Top banner ── */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-400 rounded-b-3xl px-5 pt-10 pb-8">
        <div className="flex items-start justify-between">
          <div>
            {/* Back link */}
            <Link
              href={`/clock/${staffId}`}
              className="inline-flex items-center gap-1.5 text-white/80 text-sm mb-4
                         hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor"
                strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to clock
            </Link>

            {/* Icon */}
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor"
                strokeWidth={2} viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </div>

            <h1 className="text-xl font-bold text-white tracking-tight">My Times</h1>
            {staff && !isLoading && (
              <p className="text-white/75 text-sm mt-0.5">
                {staff.first_name} {staff.last_name}
              </p>
            )}
          </div>

          {/* Total hours pill — only shown when we have data */}
          {!isLoading && staff && (
            <div className="mt-16 px-4 py-2 rounded-2xl bg-white/20 text-white text-center min-w-[72px]">
              <p className="text-xs text-white/70 leading-tight">Total</p>
              <p className="text-base font-bold leading-snug">
                {(totalMins / 60).toFixed(1)}h
              </p>
            </div>
          )}
        </div>
      </div>

      <main className="flex-1 flex flex-col items-center
                       px-4 py-5 max-w-sm mx-auto w-full gap-4">

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="w-full flex flex-col gap-3 animate-pulse mt-1">
            {/* Filter bar placeholder */}
            <div className="h-10 bg-gray-200 rounded-2xl w-full" />
            {/* Card placeholders */}
            {[1, 2, 3].map((i) => (
              <div key={i}
                className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-2.5">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* ── Error state ── */}
        {!isLoading && errorMsg && (
          <div className="w-full bg-red-50 border border-red-200 rounded-2xl px-5 py-6 text-center">
            <p className="text-red-600 font-semibold">{errorMsg}</p>
            <p className="text-red-400 text-sm mt-1">
              Ask your manager to resend the correct link.
            </p>
          </div>
        )}

        {/* ── Main content ── */}
        {!isLoading && staff && (
          <>
            {/* Filter pills */}
            <div className="w-full flex gap-2">
              {(["this_week", "this_month", "last_30"] as FilterOption[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-semibold
                               transition-all duration-150 ${
                    filter === f
                      ? "bg-green-500 text-white shadow-sm"
                      : "bg-white text-gray-500 border border-gray-200 hover:border-green-300"
                  }`}
                >
                  {filterLabels[f]}
                </button>
              ))}
            </div>

            {/* Empty state */}
            {sortedDates.length === 0 && (
              <div className="w-full bg-white rounded-2xl border border-gray-100
                              px-5 py-12 text-center shadow-sm">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-gray-700 font-semibold">No shifts found</p>
                <p className="text-gray-400 text-sm mt-1">
                  No clock-in records for{" "}
                  {filterLabels[filter].toLowerCase()}.
                </p>
              </div>
            )}

            {/* Sessions grouped by date — newest first */}
            {sortedDates.map((date) => {
              const daySessions = grouped[date];
              const dayMins = daySessions.reduce(
                (sum, s) => sum + calcSessionFinalMinutes(s),
                0
              );

              return (
                <div key={date} className="w-full">

                  {/* Date header row */}
                  <div className="flex items-center justify-between mb-2 px-1">
                    <p className="text-sm font-semibold text-gray-600">
                      {formatDate(date)}
                    </p>
                    {dayMins > 0 && (
                      <p className="text-xs text-gray-400 font-medium">
                        {formatHours(dayMins)}
                      </p>
                    )}
                  </div>

                  {/* Sessions card */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {daySessions.map((session, idx) => {
                      const sessionMins = calcSessionFinalMinutes(session);
                      const isOpen = !session.clock_out_time;

                      return (
                        <div
                          key={session.id}
                          className={`px-4 py-3.5 ${
                            idx < daySessions.length - 1
                              ? "border-b border-gray-100"
                              : ""
                          }`}
                        >
                          {/* Status + audit badges */}
                          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                            {isOpen ? (
                              <span className="inline-flex items-center gap-1.5 text-xs
                                               font-semibold px-2.5 py-1 rounded-full
                                               bg-emerald-100 text-emerald-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500
                                                 animate-pulse inline-block" />
                                Currently clocked in
                              </span>
                            ) : (
                              <span className="text-xs font-medium px-2.5 py-1 rounded-full
                                               bg-gray-100 text-gray-500">
                                Completed
                              </span>
                            )}

                            {session.edited && (
                              <span className="text-xs px-2 py-0.5 rounded-full
                                               bg-blue-50 text-blue-600 font-medium">
                                Edited
                              </span>
                            )}
                            {session.manually_added && (
                              <span className="text-xs px-2 py-0.5 rounded-full
                                               bg-purple-50 text-purple-600 font-medium">
                                Manual
                              </span>
                            )}
                          </div>

                          {/* Clock in → Clock out times */}
                          <div className="flex items-center gap-3 text-sm">
                            {/* Clock-in */}
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none"
                                stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round"
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-gray-700 font-medium">
                                {formatTime(session.clock_in_time)}
                              </span>
                            </div>

                            {/* Arrow */}
                            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none"
                              stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" d="M5 12h14" />
                            </svg>

                            {/* Clock-out */}
                            <span className={`font-medium text-sm ${
                              isOpen ? "text-emerald-500 italic" : "text-gray-700"
                            }`}>
                              {isOpen ? "ongoing…" : formatTime(session.clock_out_time)}
                            </span>
                          </div>

                          {/* Break + total hours (only for completed sessions) */}
                          {!isOpen && (
                            <div className="flex items-center gap-3 mt-2">
                              {session.break_minutes != null && session.break_minutes > 0 && (
                                <span className="text-xs text-gray-400">
                                  {session.break_minutes}m break
                                </span>
                              )}
                              <span className="text-xs font-semibold text-emerald-700 ml-auto">
                                {formatHours(sessionMins)}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              );
            })}

            {/* Footer note */}
            <p className="text-xs text-gray-400 text-center pb-6 px-4 leading-relaxed">
              This is a read-only view of your shifts.
              Contact your manager if anything looks incorrect.
            </p>
          </>
        )}

      </main>
    </div>
  );
}
