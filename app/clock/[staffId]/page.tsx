"use client";

import { use, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  shouldShowReminderModal,
  formatReminderTime,
  minutesLateForReminder,
  type ReminderSettings,
  type ReminderSessionFields,
} from "@/lib/reminder-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  branch: string;
};

// Extended open session — now includes reminder tracking fields
type OpenSession = ReminderSessionFields & {
  clock_in_time: string;
};

type LocationResult = {
  latitude:          number | null;
  longitude:         number | null;
  accuracy:          number | null;
  location_status:   "granted" | "denied" | "unavailable";
  suspicious:        boolean;
  suspicious_reason: "ok" | "permission_denied" | "location_unavailable" | "low_accuracy";
};

// ─── Geolocation helper ───────────────────────────────────────────────────────

const ACCURACY_THRESHOLD_METRES = 100;

function getLocation(): Promise<LocationResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({
        latitude: null, longitude: null, accuracy: null,
        location_status: "unavailable",
        suspicious: true, suspicious_reason: "location_unavailable",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude, accuracy } }) => {
        const lowAccuracy = accuracy > ACCURACY_THRESHOLD_METRES;
        resolve({
          latitude, longitude, accuracy,
          location_status: "granted",
          suspicious: lowAccuracy,
          suspicious_reason: lowAccuracy ? "low_accuracy" : "ok",
        });
      },
      (err) => {
        const isDenied = err.code === 1;
        resolve({
          latitude: null, longitude: null, accuracy: null,
          location_status: isDenied ? "denied" : "unavailable",
          suspicious: true,
          suspicious_reason: isDenied ? "permission_denied" : "location_unavailable",
        });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClockPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {

  const { staffId } = use(params);

  // ── Data state ───────────────────────────────────────────────────────────────
  const [staff,           setStaff]           = useState<StaffMember | null>(null);
  const [openSession,     setOpenSession]     = useState<OpenSession | null>(null);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isLoading,         setIsLoading]         = useState(true);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isWorking,         setIsWorking]         = useState(false);
  const [message,           setMessage]           = useState("");
  const [isError,           setIsError]           = useState(false);

  // ── Reminder modal state ──────────────────────────────────────────────────────
  // showModal  = controlled by the time-check interval
  // locallyDismissed = set to true if the employee taps "Still Working"
  //                    resets if they navigate away and come back
  const [showModal,        setShowModal]        = useState(false);
  const [locallyDismissed, setLocallyDismissed] = useState(false);
  const [isRespondingToReminder, setIsRespondingToReminder] = useState(false);

  // Keep a ref to the interval so we can clear it cleanly
  const reminderCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Load staff + open session + settings ─────────────────────────────────────
  async function loadData() {
    setIsLoading(true);
    setMessage("");

    const [staffResult, settingsResult] = await Promise.all([
      supabase
        .from("staff")
        .select("id, first_name, last_name, role, branch")
        .eq("id", staffId)
        .single(),
      supabase
        .from("payroll_settings")
        .select("reminder_enabled, reminder_time")
        .limit(1)
        .maybeSingle(),
    ]);

    if (staffResult.error || !staffResult.data) {
      setMessage("Staff member not found. Please check your link.");
      setIsError(true);
      setIsLoading(false);
      return;
    }

    setStaff(staffResult.data as StaffMember);

    // Store reminder settings (null if row doesn't exist yet)
    const raw = settingsResult.data;
    setReminderSettings(
      raw
        ? {
            reminder_enabled: raw.reminder_enabled ?? false,
            // Postgres TIME comes back as "HH:MM:SS" — trim to "HH:MM"
            reminder_time: raw.reminder_time
              ? String(raw.reminder_time).slice(0, 5)
              : null,
          }
        : { reminder_enabled: false, reminder_time: null }
    );

    // Load open session with reminder fields
    const { data: sessionData } = await supabase
      .from("clock_sessions")
      .select(
        "id, clock_in_time, " +
        "clock_out_reminder_sent_at, " +
        "clock_out_reminder_response, " +
        "clock_out_reminder_acknowledged_at"
      )
      .eq("staff_id", staffId)
      .is("clock_out_time", null)
      .order("clock_in_time", { ascending: false })
      .limit(1)
      .maybeSingle();

    setOpenSession(sessionData as OpenSession | null);
    setIsLoading(false);
  }

  useEffect(() => {
    if (!staffId || staffId.trim() === "") {
      setMessage("Invalid staff link.");
      setIsError(true);
      setIsLoading(false);
      return;
    }
    loadData();
  }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Reminder modal time-check interval ───────────────────────────────────────
  // Runs every 60 seconds. Re-evaluates whether the modal should appear.
  // We also run it once immediately after data loads (see the separate useEffect).
  useEffect(() => {
    function checkReminderCondition() {
      const show = shouldShowReminderModal({
        settings:         reminderSettings,
        openSession:      openSession,
        locallyDismissed: locallyDismissed,
      });
      setShowModal(show);
    }

    // Initial check (covers the case where the page loads after reminder_time)
    checkReminderCondition();

    // Set up recurring check
    reminderCheckIntervalRef.current = setInterval(checkReminderCondition, 60_000);

    return () => {
      if (reminderCheckIntervalRef.current) {
        clearInterval(reminderCheckIntervalRef.current);
      }
    };
  }, [reminderSettings, openSession, locallyDismissed]);

  // ─── Clock In ─────────────────────────────────────────────────────────────────
  async function handleClockIn() {
    if (!staff) return;
    setIsWorking(true);
    setMessage("");

    setIsGettingLocation(true);
    const loc = await getLocation();
    setIsGettingLocation(false);

    const { error } = await supabase
      .from("clock_sessions")
      .insert([{
        staff_id:      staff.id,
        work_date:     new Date().toISOString().slice(0, 10),
        clock_in_time: new Date().toISOString(),
        status:        "clocked_in",
        clock_in_latitude:        loc.latitude,
        clock_in_longitude:       loc.longitude,
        clock_in_accuracy:        loc.accuracy,
        clock_in_location_status: loc.location_status,
        suspicious_clock_in:       loc.suspicious,
        suspicious_clock_in_reason: loc.suspicious_reason,
      }]);

    if (error) {
      setMessage("Could not clock in. Please try again.");
      setIsError(true);
    } else {
      setMessage("Clocked in successfully! Have a great shift. 👋");
      setIsError(false);
      setLocallyDismissed(false); // reset so a future reminder can appear
      await loadData();
    }
    setIsWorking(false);
  }

  // ─── Core clock-out logic (shared by button + reminder modal) ─────────────────
  async function performClockOut(reminderResponse?: "clocked_out") {
    if (!openSession) {
      setMessage("You are not currently clocked in.");
      setIsError(true);
      return false;
    }

    setIsGettingLocation(true);
    const loc = await getLocation();
    setIsGettingLocation(false);

    const updatePayload: Record<string, unknown> = {
      clock_out_time: new Date().toISOString(),
      status:         "clocked_out",
      clock_out_latitude:        loc.latitude,
      clock_out_longitude:       loc.longitude,
      clock_out_accuracy:        loc.accuracy,
      clock_out_location_status: loc.location_status,
      suspicious_clock_out:       loc.suspicious,
      suspicious_clock_out_reason: loc.suspicious_reason,
    };

    // If this clock-out is a response to the reminder modal, record it
    if (reminderResponse) {
      updatePayload.clock_out_reminder_response        = reminderResponse;
      updatePayload.clock_out_reminder_acknowledged_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("clock_sessions")
      .update(updatePayload)
      .eq("id", openSession.id);

    if (error) {
      setMessage("Could not clock out. Please try again.");
      setIsError(true);
      return false;
    }

    return true;
  }

  // ─── Regular Clock Out (main button) ──────────────────────────────────────────
  async function handleClockOut() {
    setIsWorking(true);
    setMessage("");

    const ok = await performClockOut();
    if (ok) {
      setMessage("Clocked out successfully! See you next time. 👋");
      setIsError(false);
      setShowModal(false);
      await loadData();
    }
    setIsWorking(false);
  }

  // ─── Reminder: "Still Working" ────────────────────────────────────────────────
  async function handleStillWorking() {
    if (!openSession) return;
    setIsRespondingToReminder(true);

    const now = new Date().toISOString();
    await supabase
      .from("clock_sessions")
      .update({
        clock_out_reminder_response:        "still_working",
        clock_out_reminder_acknowledged_at: now,
        // If the backend hasn't stamped it yet, do it now from the client
        clock_out_reminder_sent_at: openSession.clock_out_reminder_sent_at ?? now,
      })
      .eq("id", openSession.id);

    // Optimistically update local state so the modal won't reappear this session
    setOpenSession((prev) =>
      prev
        ? {
            ...prev,
            clock_out_reminder_response: "still_working",
            clock_out_reminder_acknowledged_at: now,
          }
        : prev
    );

    setLocallyDismissed(true); // Belt-and-suspenders: hide immediately
    setShowModal(false);
    setIsRespondingToReminder(false);
  }

  // ─── Reminder: "Clock Out" ────────────────────────────────────────────────────
  async function handleClockOutFromReminder() {
    setIsRespondingToReminder(true);
    setMessage("");

    const ok = await performClockOut("clocked_out");
    if (ok) {
      setMessage("Clocked out. Thanks — see you next time! 👋");
      setIsError(false);
      setShowModal(false);
      await loadData();
    }
    setIsRespondingToReminder(false);
  }

  // ─── Derived UI values ────────────────────────────────────────────────────────
  const statusLabel = isLoading   ? "Checking status…"
                    : openSession ? "Currently clocked in"
                                  : "Not clocked in";

  const statusColor = openSession
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-gray-100 text-gray-500 border-gray-200";

  const clockInLabel  = isGettingLocation ? "Getting location…"
                      : isWorking         ? "Clocking in…"
                                          : "Clock In";

  const clockOutLabel = isGettingLocation ? "Getting location…"
                      : isWorking         ? "Clocking out…"
                                          : "Clock Out";

  // Minutes past reminder time (for modal subtitle)
  const minutesLate = reminderSettings?.reminder_time
    ? minutesLateForReminder(reminderSettings.reminder_time)
    : 0;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Top banner ── */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-400 rounded-b-3xl px-5 pt-10 pb-8
                      flex items-end justify-between">
        <div>
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2}
              viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Staff Clock</h1>
          {staff && !isLoading && (
            <p className="text-white/75 text-sm mt-0.5">{staff.first_name} {staff.last_name}</p>
          )}
        </div>

        {/* Status pill in the header */}
        {!isLoading && staff && (
          <div className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
            openSession
              ? "bg-white/20 text-white border-white/30"
              : "bg-black/10 text-white/80 border-white/20"
          }`}>
            {openSession ? "● Clocked in" : "Not clocked in"}
          </div>
        )}
      </div>

      <main className="flex-1 flex flex-col items-center justify-start
                       px-4 py-6 max-w-sm mx-auto w-full gap-5">

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-6
                          flex flex-col items-center gap-3 animate-pulse">
            <div className="w-16 h-16 rounded-full bg-gray-200" />
            <div className="h-5 w-40 bg-gray-200 rounded-lg" />
            <div className="h-4 w-24 bg-gray-100 rounded-lg" />
          </div>
        )}

        {/* ── Staff not found ── */}
        {!isLoading && !staff && (
          <div className="w-full bg-red-50 border border-red-200 rounded-2xl px-5 py-6 text-center">
            <p className="text-red-600 font-semibold text-base">{message}</p>
            <p className="text-red-400 text-sm mt-1">
              Ask your manager to resend the correct link.
            </p>
          </div>
        )}

        {/* ── Main content ── */}
        {!isLoading && staff && (
          <>
            {/* Staff identity card */}
            <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-6
                            flex flex-col items-center gap-3">
              {/* Avatar */}
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700
                              flex items-center justify-center text-2xl font-bold">
                {staff.first_name.charAt(0).toUpperCase()}
              </div>

              {/* Name */}
              <p className="text-xl font-bold text-gray-800">
                {staff.first_name} {staff.last_name}
              </p>

              {/* Badges */}
              <div className="flex flex-wrap justify-center gap-2">
                {staff.role && (
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-sky-100 text-sky-700">
                    {staff.role}
                  </span>
                )}
                {staff.branch && (
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-600">
                    📍 {staff.branch}
                  </span>
                )}
              </div>

              {/* Status pill */}
              <div className={`mt-1 px-4 py-1.5 rounded-full border text-sm font-semibold ${statusColor}`}>
                {statusLabel}
              </div>
            </div>

            {/* Location loading notice */}
            {isGettingLocation && (
              <div className="w-full flex items-center justify-center gap-2 text-sm
                              text-gray-500 bg-white border border-gray-100 rounded-xl px-4 py-3">
                <svg className="w-4 h-4 animate-spin text-emerald-500 shrink-0" fill="none"
                  viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Getting your location…
              </div>
            )}

            {/* Feedback message */}
            {message && !isGettingLocation && (
              <p className={`w-full text-sm font-medium text-center rounded-xl px-4 py-3 ${
                isError ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
              }`}>
                {message}
              </p>
            )}

            {/* Clock In */}
            {!openSession && (
              <button
                onClick={handleClockIn}
                disabled={isWorking}
                className="w-full bg-green-500 hover:bg-green-600 active:scale-95
                           disabled:opacity-60 disabled:cursor-not-allowed
                           text-white font-bold text-xl rounded-2xl py-5
                           transition-all duration-150 shadow-sm"
              >
                {clockInLabel}
              </button>
            )}

            {/* Clock Out */}
            {openSession && (
              <button
                onClick={handleClockOut}
                disabled={isWorking}
                className="w-full bg-rose-500 hover:bg-rose-600 active:scale-95
                           disabled:opacity-60 disabled:cursor-not-allowed
                           text-white font-bold text-xl rounded-2xl py-5
                           transition-all duration-150 shadow-sm"
              >
                {clockOutLabel}
              </button>
            )}

            {/* Helper hint */}
            <p className="text-xs text-gray-400 text-center px-4">
              {openSession
                ? "Tap Clock Out when your shift ends."
                : "Tap Clock In when your shift starts."}
            </p>

          </>
        )}

      </main>

      {/* ══════════════════════════════════════════════════════════════════════════
          CLOCK-OUT REMINDER MODAL
          Shown when:
            • staff is clocked in
            • current time ≥ reminder_time (set in payroll settings)
            • employee hasn't responded yet this session
      ════════════════════════════════════════════════════════════════════════════ */}
      {showModal && reminderSettings?.reminder_time && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />

          {/* Modal card — slides up from the bottom on mobile */}
          <div
            className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-sm
                       animate-slide-up"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reminder-title"
          >
            <div className="bg-white rounded-t-3xl shadow-2xl px-6 pt-8 pb-10">

              {/* Pulsing clock icon */}
              <div className="flex justify-center mb-5">
                <div className="relative flex items-center justify-center">
                  {/* Outer ring pulse */}
                  <div className="absolute w-20 h-20 rounded-full bg-amber-100 animate-ping
                                  opacity-50" />
                  <div className="relative w-16 h-16 rounded-full bg-amber-100
                                  flex items-center justify-center">
                    <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor"
                      strokeWidth={2} viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="9" />
                      <path strokeLinecap="round" d="M12 7v5l3.5 2" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Title */}
              <h2
                id="reminder-title"
                className="text-2xl font-bold text-gray-800 text-center leading-tight"
              >
                Are you still working?
              </h2>

              {/* Subtitle */}
              <p className="text-gray-500 text-center text-sm mt-2 leading-relaxed">
                It&apos;s past{" "}
                <span className="font-semibold text-gray-700">
                  {formatReminderTime(reminderSettings.reminder_time)}
                </span>
                {minutesLate > 0 && (
                  <> — {minutesLate} minute{minutesLate !== 1 ? "s" : ""} ago</>
                )}
                . Are you still on shift?
              </p>

              {/* Divider */}
              <div className="my-6 h-px bg-gray-100" />

              {/* Action buttons */}
              <div className="flex flex-col gap-3">

                {/* Still Working */}
                <button
                  onClick={handleStillWorking}
                  disabled={isRespondingToReminder}
                  className="w-full bg-green-500 hover:bg-green-600 active:scale-95
                             disabled:opacity-60 disabled:cursor-not-allowed
                             text-white font-bold text-lg rounded-2xl py-4
                             transition-all duration-150"
                >
                  {isRespondingToReminder ? "Saving…" : "✅ Still Working"}
                </button>

                {/* Clock Out */}
                <button
                  onClick={handleClockOutFromReminder}
                  disabled={isRespondingToReminder || isGettingLocation}
                  className="w-full bg-white hover:bg-red-50 active:scale-95
                             disabled:opacity-60 disabled:cursor-not-allowed
                             text-rose-600 font-bold text-lg rounded-2xl py-4
                             border-2 border-rose-200 hover:border-rose-300
                             transition-all duration-150"
                >
                  {isGettingLocation
                    ? "Getting location…"
                    : isRespondingToReminder
                    ? "Clocking out…"
                    : "🕐 Clock Out"}
                </button>

              </div>

              {/* Reassurance footer */}
              <p className="text-xs text-gray-400 text-center mt-4">
                This reminder is sent automatically.
                If you clock out you can always clock back in.
              </p>

            </div>
          </div>
        </>
      )}

    </div>
  );
}
