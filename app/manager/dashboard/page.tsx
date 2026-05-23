"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import { formatEmployeeNumber } from "@/lib/time-calc";
import {
  PageHeader,
  SummaryCard,
  StatusBadge,
  EmptyState,
  SectionCard,
  RefreshButton,
} from "@/components/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  employee_number: string;
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
  suspicious_clock_out: boolean | null;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function localToday(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function friendlyDate(): string {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    year:    "numeric",
    month:   "long",
    day:     "numeric",
  });
}

function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(isoString: string): string {
  const diffMin = Math.floor((Date.now() - new Date(isoString).getTime()) / 60_000);
  if (diffMin < 1)  return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

function roleBadgeColor(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("manager")) return "bg-amber-100 text-amber-800";
  if (r.includes("chef"))    return "bg-orange-100 text-orange-800";
  if (r.includes("bar"))     return "bg-purple-100 text-purple-800";
  if (r.includes("wait"))    return "bg-sky-100 text-sky-800";
  if (r.includes("host"))    return "bg-pink-100 text-pink-800";
  if (r.includes("kitchen")) return "bg-orange-50 text-orange-700";
  if (r.includes("clean"))   return "bg-teal-100 text-teal-800";
  return "bg-gray-100 text-gray-600";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManagerDashboardPage() {

  const [staffList, setStaffList]   = useState<StaffMember[]>([]);
  const [sessions, setSessions]     = useState<ClockSession[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [loadError, setLoadError]   = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  async function loadData() {
    setIsLoading(true);
    setLoadError("");
    const today = localToday();

    const [staffResult, sessionResult] = await Promise.all([
      supabase
        .from("staff")
        .select("id, first_name, last_name, employee_number, role, branch")
        .order("first_name", { ascending: true }),
      supabase
        .from("clock_sessions")
        .select("id, staff_id, work_date, clock_in_time, clock_out_time, status, suspicious_clock_in, suspicious_clock_out")
        .eq("work_date", today)
        .order("clock_in_time", { ascending: false }),
    ]);

    if (staffResult.error || sessionResult.error) {
      setLoadError("Could not load dashboard data. Please try again.");
    } else {
      setStaffList((staffResult.data ?? []) as StaffMember[]);
      setSessions((sessionResult.data ?? []) as ClockSession[]);
    }

    setLastRefreshed(new Date());
    setIsLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  // ─── Derived values ───────────────────────────────────────────────────────────

  const staffById = new Map<string, StaffMember>();
  for (const s of staffList) staffById.set(s.id, s);

  const openSessions   = sessions.filter((s) => s.clock_out_time === null);
  const closedSessions = sessions.filter((s) => s.clock_out_time !== null);
  const clockedInIds   = new Set(openSessions.map((s) => s.staff_id));

  const openSessionByStaffId = new Map<string, ClockSession>();
  for (const s of openSessions) {
    if (!openSessionByStaffId.has(s.staff_id)) openSessionByStaffId.set(s.staff_id, s);
  }

  const clockedInStaff  = staffList.filter((s) => clockedInIds.has(s.id));
  const suspiciousToday = sessions.filter((s) => s.suspicious_clock_in || s.suspicious_clock_out).length;
  const recentActivity  = sessions.slice(0, 15);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* ── Gradient Header ── */}
      <PageHeader
        title="Dashboard"
        subtitle={friendlyDate()}
        right={<RefreshButton onClick={loadData} loading={isLoading} />}
      />

      <ManagerNav />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── Load error ── */}
        {loadError && (
          <p className="text-sm text-red-500 text-center bg-red-50 border border-red-100
                        rounded-2xl px-4 py-4">
            {loadError}
          </p>
        )}

        {/* ── A. Summary Cards ── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Total Staff"
            value={staffList.length}
            sub="registered"
            loading={isLoading}
          />
          <SummaryCard
            label="Clocked In"
            value={clockedInStaff.length}
            sub="right now"
            valueColor={clockedInStaff.length > 0 ? "text-emerald-600" : "text-gray-300"}
            loading={isLoading}
          />
          <SummaryCard
            label="Suspicious"
            value={suspiciousToday}
            sub="flags today"
            valueColor={suspiciousToday > 0 ? "text-amber-500" : "text-gray-300"}
            loading={isLoading}
          />
          <SummaryCard
            label="Completed"
            value={closedSessions.length}
            sub="shifts today"
            valueColor={closedSessions.length > 0 ? "text-gray-800" : "text-gray-300"}
            loading={isLoading}
          />
        </section>

        {/* ── B. Currently Clocked In ── */}
        <SectionCard
          header={
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-sm font-semibold text-gray-700">Currently Clocked In</h2>
              </div>
              <span className="text-xs text-gray-400">
                {isLoading ? "…" : `${clockedInStaff.length} employee${clockedInStaff.length !== 1 ? "s" : ""}`}
              </span>
            </div>
          }
        >
          {/* Loading skeleton */}
          {isLoading && (
            <div className="divide-y divide-gray-50 animate-pulse">
              {[1, 2, 3].map((n) => (
                <div key={n} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-32" />
                    <div className="h-3 bg-gray-100 rounded w-24" />
                  </div>
                  <div className="h-3 bg-gray-100 rounded w-16" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && clockedInStaff.length === 0 && (
            <EmptyState
              message="No employees are currently clocked in."
              icon={
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M17 20H7a4 4 0 014-4h2a4 4 0 014 4zM12 12a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              }
            />
          )}

          {/* Clocked-in list */}
          {!isLoading && clockedInStaff.length > 0 && (
            <div className="divide-y divide-gray-50">
              {clockedInStaff.map((staff) => {
                const openSession = openSessionByStaffId.get(staff.id);
                return (
                  <div key={staff.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700
                                    flex items-center justify-center text-sm font-bold shrink-0">
                      {staff.first_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800">
                          {staff.first_name} {staff.last_name}
                        </p>
                        {staff.employee_number && (
                          <span className="text-xs text-gray-400 font-mono">#{formatEmployeeNumber(staff.employee_number)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {staff.role && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleBadgeColor(staff.role)}`}>
                            {staff.role}
                          </span>
                        )}
                        {staff.branch && (
                          <span className="text-xs text-gray-400">{staff.branch}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {openSession && (
                        <>
                          <p className="text-xs font-medium text-emerald-600">
                            Since {formatTime(openSession.clock_in_time)}
                          </p>
                          <p className="text-xs text-gray-400">
                            {timeAgo(openSession.clock_in_time)}
                          </p>
                        </>
                      )}
                      {openSession?.suspicious_clock_in && (
                        <StatusBadge variant="suspicious" label="⚠ Suspicious" />
                      )}
                    </div>
                    <Link
                      href={`/manager/employees/${staff.id}`}
                      className="shrink-0 ml-1 flex items-center justify-center w-8 h-8 rounded-xl
                                 text-gray-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                      aria-label={`View ${staff.first_name}'s profile`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* ── C. Recent Activity Today ── */}
        <SectionCard
          header={
            <h2 className="text-sm font-semibold text-gray-700">Recent Activity Today</h2>
          }
        >
          {isLoading && (
            <div className="divide-y divide-gray-50 animate-pulse">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="px-5 py-3 flex items-center gap-4">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-gray-200 rounded w-28" />
                    <div className="h-3 bg-gray-100 rounded w-40" />
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full w-16" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && recentActivity.length === 0 && (
            <EmptyState message="No clock activity recorded today yet." />
          )}

          {!isLoading && recentActivity.length > 0 && (
            <div className="divide-y divide-gray-50">
              {recentActivity.map((session) => {
                const employee = staffById.get(session.staff_id);
                const name = employee ? `${employee.first_name} ${employee.last_name}` : "Unknown";
                return (
                  <div key={session.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-500
                                    flex items-center justify-center text-xs font-bold shrink-0">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{name}</p>
                      <p className="text-xs text-gray-400">
                        In {formatTime(session.clock_in_time)}
                        {session.clock_out_time
                          ? ` · Out ${formatTime(session.clock_out_time)}`
                          : " · Still in"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(session.suspicious_clock_in || session.suspicious_clock_out) && (
                        <StatusBadge variant="suspicious" label="⚠" />
                      )}
                      {session.clock_out_time === null ? (
                        <StatusBadge variant="clocked-in" label="In" pulse />
                      ) : (
                        <StatusBadge variant="clocked-out" label="Done" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && (
            <div className="px-5 py-2.5 border-t border-gray-50 text-xs text-gray-300 text-right">
              Last refreshed at {formatTime(lastRefreshed.toISOString())}
            </div>
          )}
        </SectionCard>

        {/* ── D. Quick Links ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
            Quick Links
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                href:  "/manager/staff",
                label: "Staff",
                desc:  "Add & manage team",
                color: "bg-emerald-50 text-emerald-700 border-emerald-100",
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M17 20H7a4 4 0 014-4h2a4 4 0 014 4zM12 12a4 4 0 100-8 4 4 0 000 8z" />
                  </svg>
                ),
              },
              {
                href:  "/manager/attendance",
                label: "Attendance",
                desc:  "Today's clock status",
                color: "bg-sky-50 text-sky-700 border-sky-100",
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
                         M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                ),
              },
              {
                href:  "/manager/payroll-report",
                label: "Payroll",
                desc:  "Hours & CSV export",
                color: "bg-violet-50 text-violet-700 border-violet-100",
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12
                         11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                ),
              },
              {
                href:  "/manager/clock-links",
                label: "Clock Links",
                desc:  "Staff WhatsApp links",
                color: "bg-amber-50 text-amber-700 border-amber-100",
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5
                         m4.5-4.5l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
                  </svg>
                ),
              },
            ].map(({ href, label, desc, color, icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex flex-col gap-2 p-4 rounded-2xl border ${color}
                            hover:opacity-80 active:scale-95 transition-all duration-150`}
              >
                {icon}
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-xs opacity-70">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
