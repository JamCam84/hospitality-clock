"use client";

/**
 * app/manager/location-view/page.tsx
 *
 * Lets managers review where staff clocked in and out, spot missing GPS
 * coordinates, check geofence compliance, and flag poor-accuracy readings.
 *
 * The sidebar is provided by app/manager/layout.tsx — this page only
 * renders its own content.
 *
 * DB column names:
 *   clock_sessions → clock_in_time, clock_out_time  (ISO timestamp strings)
 *   staff          → expected_work_area_id           (FK → work_areas.id)
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatEmployeeNumber } from "@/lib/time-calc";

// ─── Constants ────────────────────────────────────────────────────────────────

/** GPS readings worse than this (metres) are flagged as poor accuracy. */
const ACCURACY_THRESHOLD = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkArea = {
  id: string;
  name: string;
  radius_meters: number;
};

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  employee_number: string | null;
  branch: string | null;
  role: string | null;
  expected_work_area_id: string | null;
};

type ClockSession = {
  id: string;
  staff_id: string;
  work_date: string;
  // ISO timestamp strings — DB columns are clock_in_time / clock_out_time
  clock_in_time: string | null;
  clock_out_time: string | null;
  // GPS — added by migration; use toSession() to bypass Supabase typing
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
  clock_in_accuracy: number | null;
  clock_out_accuracy: number | null;
  clock_in_inside_geofence: boolean | null;
  clock_out_inside_geofence: boolean | null;
  geofence_warning: boolean | null;
};

// Bypass Supabase's GenericStringError for migration-added columns
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ClockSession {
  return row as unknown as ClockSession;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStaff(row: any): StaffMember {
  return row as unknown as StaffMember;
}

// ─── Warning logic ────────────────────────────────────────────────────────────

/**
 * Returns true when the session should be flagged:
 *  - no GPS coordinates on clock-in
 *  - either event was outside the geofence
 *  - GPS accuracy is worse than ACCURACY_THRESHOLD
 */
function sessionHasWarning(s: ClockSession): boolean {
  if (s.clock_in_latitude === null || s.clock_in_longitude === null) return true;
  if (s.clock_in_inside_geofence === false) return true;
  if (s.clock_in_accuracy !== null && s.clock_in_accuracy > ACCURACY_THRESHOLD) return true;
  if (s.clock_out_inside_geofence === false) return true;
  if (s.clock_out_accuracy !== null && s.clock_out_accuracy > ACCURACY_THRESHOLD) return true;
  return false;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function today(): string { return isoDate(new Date()); }

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Small UI components ──────────────────────────────────────────────────────

/** One of the four stat tiles at the top of the results. */
function SummaryCard({
  label,
  value,
  color = "stone",
}: {
  label: string;
  value: number;
  color?: "stone" | "emerald" | "amber" | "red";
}) {
  const valueColor: Record<string, string> = {
    stone:   "text-stone-800",
    emerald: "text-emerald-600",
    amber:   "text-amber-600",
    red:     "text-red-600",
  };
  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm px-5 py-4">
      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-2xl font-bold mt-1 ${valueColor[color]}`}>{value}</p>
    </div>
  );
}

/** Geofence status badge for one clock event. */
function GeofenceBadge({ inside }: { inside: boolean | null }) {
  if (inside === true) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium
                       px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
          strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Inside
      </span>
    );
  }
  if (inside === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium
                       px-2 py-0.5 rounded-full bg-red-50 text-red-700">
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
          strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Outside
      </span>
    );
  }
  return <span className="text-xs text-stone-300 italic">—</span>;
}

/** Shows GPS accuracy in metres; amber when worse than threshold. */
function AccuracyBadge({ metres }: { metres: number | null }) {
  if (metres === null) {
    return <span className="text-xs text-stone-300 italic">—</span>;
  }
  const poor = metres > ACCURACY_THRESHOLD;
  return (
    <span className={`text-xs font-medium ${poor ? "text-amber-600" : "text-stone-500"}`}>
      ±{Math.round(metres)} m{poor ? " ⚠" : ""}
    </span>
  );
}

/** Row-level worst-case warning summary badge. */
function WarningBadge({ session }: { session: ClockSession }) {
  // No location captured at all
  if (session.clock_in_latitude === null || session.clock_in_longitude === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold
                       px-2 py-0.5 rounded-full bg-amber-50 text-amber-700
                       border border-amber-200">
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
          strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94
               a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        No location
      </span>
    );
  }

  // Outside geofence — highest severity
  if (
    session.clock_in_inside_geofence === false ||
    session.clock_out_inside_geofence === false
  ) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold
                       px-2 py-0.5 rounded-full bg-red-50 text-red-700
                       border border-red-200">
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
          strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94
               a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        Outside geofence
      </span>
    );
  }

  // Poor accuracy
  const worstAcc = Math.max(
    session.clock_in_accuracy  ?? 0,
    session.clock_out_accuracy ?? 0,
  );
  if (worstAcc > ACCURACY_THRESHOLD) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold
                       px-2 py-0.5 rounded-full bg-amber-50 text-amber-700
                       border border-amber-200">
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
          strokeWidth={2} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
        </svg>
        Poor accuracy
      </span>
    );
  }

  // All clear
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium
                     px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
        strokeWidth={2.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      OK
    </span>
  );
}

/** Google Maps link or "No location captured" note. */
function LocationLink({ lat, lng }: { lat: number | null; lng: number | null }) {
  if (lat === null || lng === null) {
    return (
      <span className="text-xs text-stone-400 italic">No location captured</span>
    );
  }
  return (
    <a
      href={`https://maps.google.com/?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600
                 hover:text-sky-800 hover:underline transition-colors"
    >
      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
        strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4
             M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      View Map
      <span className="font-normal text-stone-400">
        ({lat.toFixed(4)}, {lng.toFixed(4)})
      </span>
    </a>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LocationViewPage() {

  // ── State ─────────────────────────────────────────────────────────────────
  const [sessions,   setSessions]   = useState<ClockSession[]>([]);
  const [allStaff,   setAllStaff]   = useState<StaffMember[]>([]);
  const [workAreas,  setWorkAreas]  = useState<WorkArea[]>([]);
  const [isLoading,  setIsLoading]  = useState(false);
  const [hasLoaded,  setHasLoaded]  = useState(false);
  const [errorMsg,   setErrorMsg]   = useState("");

  // ── Filters ───────────────────────────────────────────────────────────────
  const [dateFrom,     setDateFrom]     = useState(daysAgo(30));
  const [dateTo,       setDateTo]       = useState(today());
  const [staffFilter,  setStaffFilter]  = useState("all");
  const [warningsOnly, setWarningsOnly] = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────
  async function loadData() {
    setIsLoading(true);
    setErrorMsg("");

    // 1. Staff list + work areas — run in parallel
    const [staffResult, areasResult] = await Promise.all([
      supabase
        .from("staff")
        .select(
          "id, first_name, last_name, employee_number, branch, role, expected_work_area_id"
        )
        .order("first_name", { ascending: true }),
      supabase
        .from("work_areas")
        .select("id, name, radius_meters")
        .order("name", { ascending: true }),
    ]);

    if (staffResult.error) {
      setErrorMsg("Could not load staff list.");
      setIsLoading(false);
      return;
    }

    setAllStaff((staffResult.data ?? []).map(toStaff));
    // work_areas is optional — ignore errors (table may not exist yet)
    if (!areasResult.error) {
      setWorkAreas((areasResult.data ?? []) as WorkArea[]);
    }

    // 2. Clock sessions in the chosen date range
    let query = supabase
      .from("clock_sessions")
      .select(
        "id, staff_id, work_date, " +
        "clock_in_time, clock_out_time, " +
        "clock_in_latitude, clock_in_longitude, " +
        "clock_out_latitude, clock_out_longitude, " +
        "clock_in_accuracy, clock_out_accuracy, " +
        "clock_in_inside_geofence, clock_out_inside_geofence, " +
        "geofence_warning"
      )
      .gte("work_date", dateFrom)
      .lte("work_date", dateTo)
      .order("work_date",     { ascending: false })
      .order("clock_in_time", { ascending: false });

    if (staffFilter !== "all") {
      query = query.eq("staff_id", staffFilter);
    }

    const { data: sessionData, error: sessionError } = await query;

    if (sessionError) {
      setErrorMsg("Could not load clock sessions.");
      setIsLoading(false);
      return;
    }

    setSessions((sessionData ?? []).map(toSession));
    setHasLoaded(true);
    setIsLoading(false);
  }

  // Auto-load on mount
  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lookup maps ───────────────────────────────────────────────────────────
  const staffById: Record<string, StaffMember> = {};
  for (const s of allStaff) staffById[s.id] = s;

  const areaById: Record<string, WorkArea> = {};
  for (const a of workAreas) areaById[a.id] = a;

  // ── Client-side warnings filter ───────────────────────────────────────────
  const visibleSessions = warningsOnly
    ? sessions.filter(sessionHasWarning)
    : sessions;

  // ── Summary counts (always from full unfiltered list) ─────────────────────
  const totalSessions   = sessions.length;
  const withLocation    = sessions.filter((s) => s.clock_in_latitude !== null).length;
  const missingLocation = sessions.filter((s) => s.clock_in_latitude === null).length;
  const outsideGeofence = sessions.filter(
    (s) => s.clock_in_inside_geofence === false || s.clock_out_inside_geofence === false
  ).length;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-stone-50 px-6 py-8">

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-stone-800">Location Review</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Review where staff clocked in and out — spot missing GPS data,
          geofence violations, and poor-accuracy readings.
        </p>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm
                      px-5 py-4 mb-6 flex flex-wrap gap-4 items-end">

        {/* From date */}
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label className="text-xs font-semibold text-stone-500">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-stone-200 rounded-xl px-3 py-2 text-sm
                       text-stone-700 focus:outline-none focus:ring-2
                       focus:ring-emerald-400 focus:border-transparent"
          />
        </div>

        {/* To date */}
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label className="text-xs font-semibold text-stone-500">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-stone-200 rounded-xl px-3 py-2 text-sm
                       text-stone-700 focus:outline-none focus:ring-2
                       focus:ring-emerald-400 focus:border-transparent"
          />
        </div>

        {/* Employee */}
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-xs font-semibold text-stone-500">Employee</label>
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="border border-stone-200 rounded-xl px-3 py-2 text-sm
                       text-stone-700 bg-white focus:outline-none focus:ring-2
                       focus:ring-emerald-400 focus:border-transparent"
          >
            <option value="all">All employees</option>
            {allStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.first_name} {s.last_name}
              </option>
            ))}
          </select>
        </div>

        {/* Search button */}
        <button
          onClick={loadData}
          disabled={isLoading}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700
                     disabled:opacity-50 text-white font-semibold text-sm
                     rounded-xl px-4 py-2 transition-colors shadow-sm"
        >
          {isLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor"
              strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M4 4v5h5M20 20v-5h-5" />
              <path strokeLinecap="round"
                d="M4 9a9 9 0 0114.13-3.36M20 15A9 9 0 015.87 18.36" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor"
              strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          {isLoading ? "Loading…" : "Search"}
        </button>

        {/* Warnings-only toggle */}
        {hasLoaded && (
          <label className="ml-auto flex items-center gap-2.5 cursor-pointer self-end pb-0.5">
            <button
              type="button"
              role="switch"
              aria-checked={warningsOnly}
              onClick={() => setWarningsOnly((v) => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors duration-200
                          focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                warningsOnly ? "bg-amber-400" : "bg-stone-200"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white
                             shadow-sm transition-transform duration-200 ${
                  warningsOnly ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-sm font-medium text-stone-600 select-none">
              Warnings only
            </span>
          </label>
        )}
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl
                        px-5 py-4 text-red-700 text-sm font-medium">
          {errorMsg}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3 animate-pulse mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n}
                className="bg-white rounded-2xl border border-stone-100 h-20" />
            ))}
          </div>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n}
              className="bg-white rounded-xl border border-stone-100 h-14" />
          ))}
        </div>
      )}

      {/* Results */}
      {!isLoading && hasLoaded && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard label="Total sessions"   value={totalSessions}   color="stone" />
            <SummaryCard label="With location"    value={withLocation}    color="emerald" />
            <SummaryCard label="Missing location" value={missingLocation} color="amber" />
            <SummaryCard label="Outside geofence" value={outsideGeofence} color="red" />
          </div>

          {/* Empty state */}
          {visibleSessions.length === 0 && (
            <div className="bg-white border border-stone-100 rounded-2xl
                            px-6 py-16 text-center shadow-sm">
              <p className="text-4xl mb-3">📍</p>
              <p className="text-stone-700 font-semibold text-base">
                {warningsOnly ? "No sessions with warnings" : "No sessions found"}
              </p>
              <p className="text-stone-400 text-sm mt-1">
                {warningsOnly
                  ? "Everything looks clean for this period."
                  : "Try adjusting the date range or employee filter."}
              </p>
            </div>
          )}

          {/* Table */}
          {visibleSessions.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-200
                            shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1100px]">

                  <thead className="bg-stone-50 border-b border-stone-100">
                    <tr>
                      {[
                        "Emp #",
                        "Employee",
                        "Work Area",
                        "Date",
                        "Clock In",
                        "Clock Out",
                        "In Location",
                        "Out Location",
                        "Accuracy",
                        "Geofence",
                        "Warning",
                      ].map((col) => (
                        <th
                          key={col}
                          className="text-left text-xs font-semibold text-stone-400
                                     uppercase tracking-wide px-4 py-3 whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-stone-50">
                    {visibleSessions.map((session) => {
                      const staff = staffById[session.staff_id];
                      const hasWarning = sessionHasWarning(session);

                      // Worst accuracy across in + out
                      const worstAccuracy: number | null =
                        session.clock_in_accuracy !== null ||
                        session.clock_out_accuracy !== null
                          ? Math.max(
                              session.clock_in_accuracy  ?? 0,
                              session.clock_out_accuracy ?? 0,
                            )
                          : null;

                      // Geofence: false > true > null (worst wins)
                      const geofenceStatus: boolean | null =
                        session.clock_in_inside_geofence === false ||
                        session.clock_out_inside_geofence === false
                          ? false
                          : session.clock_in_inside_geofence === true ||
                            session.clock_out_inside_geofence === true
                          ? true
                          : null;

                      // Assigned work area for this employee
                      const workArea =
                        staff?.expected_work_area_id
                          ? areaById[staff.expected_work_area_id]
                          : undefined;

                      // Row tint: red for geofence violation, amber for other warnings
                      const rowClass =
                        geofenceStatus === false
                          ? "bg-red-50/30 hover:bg-red-50/50"
                          : hasWarning
                          ? "bg-amber-50/30 hover:bg-amber-50/60"
                          : "hover:bg-stone-50";

                      return (
                        <tr
                          key={session.id}
                          className={`transition-colors duration-100 ${rowClass}`}
                        >
                          {/* Emp # */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-xs font-mono text-stone-500">
                              {staff
                                ? formatEmployeeNumber(staff.employee_number)
                                : "—"}
                            </span>
                          </td>

                          {/* Employee */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {staff ? (
                              <div>
                                <p className="font-semibold text-stone-800 text-sm">
                                  {staff.first_name} {staff.last_name}
                                </p>
                                {(staff.role || staff.branch) && (
                                  <p className="text-xs text-stone-400 mt-0.5">
                                    {[staff.role, staff.branch]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-stone-300 italic">
                                Unknown
                              </span>
                            )}
                          </td>

                          {/* Work area */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {workArea ? (
                              <span className="inline-flex items-center text-xs font-medium
                                               px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">
                                {workArea.name}
                              </span>
                            ) : (
                              <span className="text-xs text-stone-300 italic">—</span>
                            )}
                          </td>

                          {/* Date */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-medium text-stone-700 text-sm">
                              {formatDate(session.work_date)}
                            </p>
                          </td>

                          {/* Clock in time */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-medium text-emerald-600">
                              {formatTime(session.clock_in_time)}
                            </p>
                          </td>

                          {/* Clock out time */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {session.clock_out_time ? (
                              <p className="font-medium text-stone-600">
                                {formatTime(session.clock_out_time)}
                              </p>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs
                                               font-medium px-2 py-0.5 rounded-full
                                               bg-emerald-100 text-emerald-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500
                                                 animate-pulse inline-block" />
                                Active
                              </span>
                            )}
                          </td>

                          {/* Clock-in location */}
                          <td className="px-4 py-3">
                            <LocationLink
                              lat={session.clock_in_latitude}
                              lng={session.clock_in_longitude}
                            />
                          </td>

                          {/* Clock-out location */}
                          <td className="px-4 py-3">
                            {session.clock_out_time ? (
                              <LocationLink
                                lat={session.clock_out_latitude}
                                lng={session.clock_out_longitude}
                              />
                            ) : (
                              <span className="text-xs text-stone-300 italic">
                                Still clocked in
                              </span>
                            )}
                          </td>

                          {/* Accuracy */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <AccuracyBadge metres={worstAccuracy} />
                          </td>

                          {/* Geofence */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <GeofenceBadge inside={geofenceStatus} />
                          </td>

                          {/* Warning */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <WarningBadge session={session} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/50">
                <p className="text-xs text-stone-400">
                  Showing {visibleSessions.length}{" "}
                  session{visibleSessions.length !== 1 ? "s" : ""}
                  {warningsOnly ? " with warnings" : ""}
                  {" · "}accuracy threshold ±{ACCURACY_THRESHOLD} m
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pre-load prompt — shown before first auto-load completes */}
      {!isLoading && !hasLoaded && !errorMsg && (
        <div className="bg-white border border-stone-100 rounded-2xl
                        px-6 py-16 text-center shadow-sm">
          <p className="text-4xl mb-3">🗺️</p>
          <p className="text-stone-700 font-semibold">Loading location data…</p>
          <p className="text-stone-400 text-sm mt-1">
            Adjust the filters above and click Search to refine results.
          </p>
        </div>
      )}

    </div>
  );
}
