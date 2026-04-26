/**
 * lib/reminder-utils.ts
 *
 * Pure helper functions for the clock-out reminder feature.
 * No Supabase imports here — all DB calls stay in the pages / API routes
 * so these functions remain fully unit-testable.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReminderSettings = {
  reminder_enabled: boolean;
  /** "HH:MM" in 24-hour format, e.g. "16:30". null = not configured. */
  reminder_time: string | null;
};

export type ReminderSessionFields = {
  id: string;
  clock_in_time: string | null;
  clock_out_reminder_sent_at: string | null;
  clock_out_reminder_response: "still_working" | "clocked_out" | null;
  clock_out_reminder_acknowledged_at: string | null;
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

/**
 * parseReminderTime
 * Converts a stored "HH:MM" string to { hours, minutes }.
 * Returns null if the string is malformed.
 */
export function parseReminderTime(
  reminderTime: string
): { hours: number; minutes: number } | null {
  const parts = reminderTime.split(":");
  if (parts.length < 2) return null;
  const hours   = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * isPastReminderTime
 * Returns true when the local device clock is AT or AFTER the configured
 * reminder time today.
 *
 * Uses the device's local timezone intentionally — reminders are always
 * "relative to the venue's wall clock", not UTC.
 */
export function isPastReminderTime(reminderTime: string): boolean {
  const parsed = parseReminderTime(reminderTime);
  if (!parsed) return false;

  const now = new Date();
  const todayReminder = new Date();
  todayReminder.setHours(parsed.hours, parsed.minutes, 0, 0);

  return now >= todayReminder;
}

/**
 * clockedInBeforeReminder
 * Returns true when the employee clocked in BEFORE the reminder time.
 *
 * We skip the reminder for employees who start their shift AFTER the
 * reminder time — e.g. a 17:00 shift getting a 16:30 reminder would
 * be jarring. Only flag people who've actually been working through the
 * reminder window.
 */
export function clockedInBeforeReminder(
  clockInTime: string | null,
  reminderTime: string
): boolean {
  if (!clockInTime) return false;
  const parsed = parseReminderTime(reminderTime);
  if (!parsed) return false;

  const clockIn = new Date(clockInTime);
  const todayReminder = new Date();
  todayReminder.setHours(parsed.hours, parsed.minutes, 0, 0);

  return clockIn < todayReminder;
}

/**
 * shouldShowReminderModal
 * Single source of truth for when the on-page reminder modal should appear.
 *
 * All of these must be true:
 *  1. The reminder feature is enabled in settings.
 *  2. A reminder_time is configured.
 *  3. The current time is at or past the reminder_time.
 *  4. The employee is currently clocked in (openSession is not null).
 *  5. The employee clocked in BEFORE the reminder time.
 *  6. No reminder response has been recorded yet (null = not answered).
 *  7. The modal hasn't been locally dismissed in this browser tab session.
 */
export function shouldShowReminderModal({
  settings,
  openSession,
  locallyDismissed,
}: {
  settings: ReminderSettings | null;
  openSession: ReminderSessionFields | null;
  locallyDismissed: boolean;
}): boolean {
  if (!settings?.reminder_enabled)    return false;
  if (!settings.reminder_time)         return false;
  if (!openSession)                    return false;
  if (locallyDismissed)                return false;

  // Already responded — don't pester them again
  if (openSession.clock_out_reminder_response !== null) return false;

  if (!isPastReminderTime(settings.reminder_time)) return false;

  if (!clockedInBeforeReminder(openSession.clock_in_time, settings.reminder_time)) {
    return false;
  }

  return true;
}

/**
 * formatReminderTime
 * Converts "16:30" to "4:30 PM" for display in the modal.
 */
export function formatReminderTime(reminderTime: string): string {
  const parsed = parseReminderTime(reminderTime);
  if (!parsed) return reminderTime;

  const { hours, minutes } = parsed;
  const suffix = hours >= 12 ? "PM" : "AM";
  const display12 = hours % 12 === 0 ? 12 : hours % 12;
  const minStr = String(minutes).padStart(2, "0");
  return `${display12}:${minStr} ${suffix}`;
}

/**
 * minutesLateForReminder
 * How many whole minutes past the reminder time is it right now?
 * Returns 0 if reminder time hasn't been reached yet.
 */
export function minutesLateForReminder(reminderTime: string): number {
  const parsed = parseReminderTime(reminderTime);
  if (!parsed) return 0;

  const now = new Date();
  const todayReminder = new Date();
  todayReminder.setHours(parsed.hours, parsed.minutes, 0, 0);

  const diffMs = now.getTime() - todayReminder.getTime();
  return diffMs > 0 ? Math.floor(diffMs / 60_000) : 0;
}
