"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import { formatEmployeeNumber } from "@/lib/time-calc";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  role: string;
  branch: string;
  pay_frequency: string;
};

type ClockSession = {
  id: string;
  staff_id: string;
  clock_in_time: string;
  clock_out_time: string | null;
  suspicious_clock_in: boolean;
  suspicious_clock_out: boolean;
};

// ── What we show per staff member after joining the two datasets ──────────────
type AttendanceRow = {
  staff: StaffMember;
  status: "Clocked In" | "Clocked Out" | "Not Clocked In";
  firstClockIn: string | null;   // earliest clock_in_time today
  latestClockOut: string | null; // latest clock_out_time today
  suspiciousClockIn: boolean;
  suspiciousClockOut: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns today's date as "YYYY-MM-DD" in the local timezone.
// This matches the work_date column in clock_sessions.
function todayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Formats an ISO timestamp to a readable time string, e.g. "08:32 AM"
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// Merges staff list + today's sessions into one AttendanceRow per staff member
function buildAttendanceRows(
  staffList: StaffMember[],
  sessions: ClockSession[]
): AttendanceRow[] {
  return staffList.map((staff) => {

    // All sessions for this staff member today
    const mySession = sessions.filter((s) => s.staff_id === staff.id);

    if (mySession.length === 0) {
      return {
        staff,
        status:           "Not Clocked In",
        firstClockIn:     null,
        latestClockOut:   null,
        suspiciousClockIn:  false,
        suspiciousClockOut: false,
      };
    }

    // Sort by clock_in_time ascending so [0] is the earliest
    const sorted = [...mySession].sort(
      (a, b) => new Date(a.clock_in_time).getTime() - new Date(b.clock_in_time).getTime()
    );

    const hasOpenSession = mySession.some((s) => s.clock_out_time === null);

    // Latest clock-out: find the session with the most recent clock_out_time
    const closedSessions  = mySession.filter((s) => s.clock_out_time !== null);
    const latestClosed    = closedSessions.sort(
      (a, b) => new Date(b.clock_out_time!).getTime() - new Date(a.clock_out_time!).getTime()
    )[0];

    // Suspicious flags: true if ANY session today has the flag set
    const suspiciousClockIn  = mySession.some((s) => s.suspicious_clock_in);
    const suspiciousClockOut = mySession.some((s) => s.suspicious_clock_out);

    return {
      staff,
      status:           hasOpenSession ? "Clocked In" : "Clocked Out",
      firstClockIn:     sorted[0].clock_in_time,
      latestClockOut:   latestClosed?.clock_out_time ?? null,
      suspiciousClockIn,
      suspiciousClockOut,
    };
  });
}

// ─── Status badge styles ──────────────────────────────────────────────────────

function statusStyle(status: AttendanceRow["status"]): string {
  if (status === "Clocked In")     return "bg-emerald-100 text-emerald-700";
  if (status === "Clocked Out")    return "bg-stone-100 text-stone-500";
  return "bg-red-50 text-red-400";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AttendancePage() {

  const [rows, setRows]         = useState<AttendanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const today = todayDateString();

  // ─── Load staff + today's sessions in parallel ───────────────────────────────
  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setLoadError("");

      // Run both queries at the same time for speed
      const [staffResult, sessionResult] = await Promise.all([
        supabase
          .from("staff")
          .select("id, employee_number, first_name, last_name, role, branch, pay_frequency")
          .order("first_name", { ascending: true }),

        supabase
          .from("clock_sessions")
          .select("id, staff_id, clock_in_time, clock_out_time, suspicious_clock_in, suspicious_clock_out")
          .eq("work_date", today),
      ]);

      if (staffResult.error || sessionResult.error) {
        setLoadError("Could not load attendance data. Please refresh and try again.");
        setIsLoading(false);
        return;
      }

      const staff    = (staffResult.data   ?? []) as StaffMember[];
      const sessions = (sessionResult.data ?? []) as ClockSession[];

      setRows(buildAttendanceRows(staff, sessions));
      setIsLoading(false);
    }

    load();
  }, [today]);

  // ── Summary counts for the header ────────────────────────────────────────────
  const clockedInCount  = rows.filter((r) => r.status === "Clocked In").length;
  const clockedOutCount = rows.filter((r) => r.status === "Clocked Out").length;
  const absentCount     = rows.filter((r) => r.status === "Not Clocked In").length;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 font-sans">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-stone-200 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
                   M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-800 tracking-tight leading-tight">
              Attendance
            </h1>
            <p className="text-xs text-stone-400">
              {new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
        </div>
      </header>

      {/* ── Manager navigation ── */}
      <ManagerNav />

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* ── Loading ── */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="bg-white rounded-2xl border border-stone-200 p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-stone-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-stone-200 rounded w-36" />
                    <div className="h-3 bg-stone-100 rounded w-24" />
                  </div>
                  <div className="h-6 w-24 bg-stone-100 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Load error ── */}
        {!isLoading && loadError && (
          <p className="text-center text-red-500 text-sm bg-red-50 border border-red-100 rounded-2xl px-4 py-5">
            {loadError}
          </p>
        )}

        {/* ── Summary pills ── */}
        {!isLoading && !loadError && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{clockedInCount}</p>
              <p className="text-xs text-emerald-500 font-medium mt-0.5">Clocked In</p>
            </div>
            <div className="bg-stone-100 border border-stone-200 rounded-2xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-stone-500">{clockedOutCount}</p>
              <p className="text-xs text-stone-400 font-medium mt-0.5">Clocked Out</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-red-400">{absentCount}</p>
              <p className="text-xs text-red-400 font-medium mt-0.5">Not In</p>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && !loadError && rows.length === 0 && (
          <p className="text-center text-stone-400 text-sm py-12">
            No staff found. Add staff members first.
          </p>
        )}

        {/* ── Attendance cards ── */}
        {!isLoading && !loadError && rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map(({ staff, status, firstClockIn, latestClockOut, suspiciousClockIn, suspiciousClockOut }) => (
              <li
                key={staff.id}
                className="bg-white rounded-2xl border border-stone-200 shadow-sm px-4 py-4"
              >
                {/* ── Top row: avatar + name + status badge ── */}
                <div className="flex items-center gap-3">

                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center
                                  justify-center text-base font-bold shrink-0">
                    {staff.first_name.charAt(0).toUpperCase()}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-800 truncate">
                      {staff.first_name} {staff.last_name}
                      {staff.employee_number && (
                        <span className="ml-1.5 text-xs font-normal text-stone-400">
                          #{formatEmployeeNumber(staff.employee_number)}
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {staff.role && (
                        <span className="text-xs text-stone-500">{staff.role}</span>
                      )}
                      {staff.role && staff.branch && (
                        <span className="text-xs text-stone-300">·</span>
                      )}
                      {staff.branch && (
                        <span className="text-xs text-stone-500">📍 {staff.branch}</span>
                      )}
                      {staff.pay_frequency && (
                        <>
                          <span className="text-xs text-stone-300">·</span>
                          <span className="text-xs text-stone-400 capitalize">{staff.pay_frequency}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status badge */}
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full shrink-0 ${statusStyle(status)}`}>
                    {status}
                  </span>
                </div>

                {/* ── Clock times row — only shown if there was activity today ── */}
                {(firstClockIn || latestClockOut) && (
                  <div className="mt-3 flex flex-wrap gap-4 pl-13">
                    {firstClockIn && (
                      <div>
                        <p className="text-xs text-stone-400 font-medium">Clock In</p>
                        <p className="text-sm font-semibold text-stone-700">{formatTime(firstClockIn)}</p>
                      </div>
                    )}
                    {latestClockOut && (
                      <div>
                        <p className="text-xs text-stone-400 font-medium">Clock Out</p>
                        <p className="text-sm font-semibold text-stone-700">{formatTime(latestClockOut)}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Suspicious flags — only shown when flagged ── */}
                {(suspiciousClockIn || suspiciousClockOut) && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {suspiciousClockIn && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1
                                       rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        ⚠️ Suspicious clock-in
                      </span>
                    )}
                    {suspiciousClockOut && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1
                                       rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        ⚠️ Suspicious clock-out
                      </span>
                    )}
                  </div>
                )}

              </li>
            ))}
          </ul>
        )}

      </main>
    </div>
  );
}
