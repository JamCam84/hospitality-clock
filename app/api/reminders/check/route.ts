/**
 * app/api/reminders/check/route.ts
 *
 * Backend reminder scanner — GET /api/reminders/check
 *
 * ─── What this does ───────────────────────────────────────────────────────────
 * 1. Reads reminder settings from payroll_settings.
 * 2. If reminders are enabled and the current server time is past reminder_time,
 *    finds all clock_sessions that are still open and haven't had a reminder sent.
 * 3. Stamps those sessions with clock_out_reminder_sent_at = now().
 * 4. Returns a summary payload.
 *
 * The WhatsApp send step is intentionally stubbed out with a comment block.
 * Replace the stub with your WhatsApp Business API / Twilio / etc. call
 * when you're ready to wire that up.
 *
 * ─── How to call this ─────────────────────────────────────────────────────────
 * Externally:  cron job → GET https://your-app/api/reminders/check?secret=XXXX
 * Supabase:    pg_cron → SELECT http_get('https://your-app/api/reminders/check?secret=XXXX')
 * Vercel:      vercel.json cron → { "path": "/api/reminders/check", "schedule": "*/5 * * * *" }
 *
 * ─── Security ─────────────────────────────────────────────────────────────────
 * Set  REMINDER_SECRET  in your environment variables.
 * Pass it as  ?secret=REMINDER_SECRET  in the cron URL.
 * The route returns 401 for any request that omits or mismatches the secret.
 * If REMINDER_SECRET is not set, the check is skipped (dev / local use only).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isPastReminderTime, clockedInBeforeReminder } from "@/lib/reminder-utils";

// ─── Supabase admin client ────────────────────────────────────────────────────
// Use service-role key so Row Level Security doesn't block the scan.

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
      "for the reminder API route."
    );
  }
  return createClient(url, key);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type OpenSession = {
  id: string;
  staff_id: string;
  clock_in_time: string;
  clock_out_reminder_sent_at: string | null;
};

type StaffRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {

  // ── 1. Authenticate the cron caller ─────────────────────────────────────────
  const secret = process.env.REMINDER_SECRET;
  if (secret) {
    const provided = req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const supabase = getSupabaseAdmin();

  // ── 2. Load reminder settings ────────────────────────────────────────────────
  const { data: settings, error: settingsError } = await supabase
    .from("payroll_settings")
    .select("reminder_enabled, reminder_time")
    .limit(1)
    .maybeSingle();

  if (settingsError) {
    return NextResponse.json(
      { error: "Failed to load settings", detail: settingsError.message },
      { status: 500 }
    );
  }

  if (!settings?.reminder_enabled || !settings.reminder_time) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Reminders disabled or reminder_time not configured.",
      timestamp: now.toISOString(),
    });
  }

  const reminderTime: string = settings.reminder_time; // "HH:MM:SS" from Postgres TIME column

  // ── 3. Guard: only run when we're actually past the reminder time ─────────────
  // Postgres TIME columns come back as "HH:MM:SS" — take first 5 chars for utils
  const reminderTime5 = reminderTime.slice(0, 5); // "16:30"
  if (!isPastReminderTime(reminderTime5)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `Current time is before reminder time (${reminderTime5}).`,
      timestamp: now.toISOString(),
    });
  }

  // ── 4. Find open sessions that haven't been reminded yet ─────────────────────
  const { data: openSessions, error: sessionError } = await supabase
    .from("clock_sessions")
    .select("id, staff_id, clock_in_time, clock_out_reminder_sent_at")
    .is("clock_out_time", null)
    .is("clock_out_reminder_sent_at", null);

  if (sessionError) {
    return NextResponse.json(
      { error: "Failed to query sessions", detail: sessionError.message },
      { status: 500 }
    );
  }

  const sessions = (openSessions ?? []) as OpenSession[];

  // Filter to sessions where the employee clocked in BEFORE the reminder time
  const sessionsToRemind = sessions.filter((s) =>
    clockedInBeforeReminder(s.clock_in_time, reminderTime5)
  );

  if (sessionsToRemind.length === 0) {
    return NextResponse.json({
      ok: true,
      reminded: 0,
      reason: "No open sessions eligible for reminder.",
      timestamp: now.toISOString(),
    });
  }

  // ── 5. Stamp the sessions with clock_out_reminder_sent_at ────────────────────
  const sessionIds = sessionsToRemind.map((s) => s.id);

  const { error: updateError } = await supabase
    .from("clock_sessions")
    .update({ clock_out_reminder_sent_at: now.toISOString() })
    .in("id", sessionIds);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to stamp sessions", detail: updateError.message },
      { status: 500 }
    );
  }

  // ── 6. Load staff details for the WhatsApp stub ───────────────────────────────
  const staffIds = [...new Set(sessionsToRemind.map((s) => s.staff_id))];

  const { data: staffRows } = await supabase
    .from("staff")
    .select("id, first_name, last_name, phone_number")
    .in("id", staffIds);

  const staffById = new Map<string, StaffRow>();
  for (const s of (staffRows ?? []) as StaffRow[]) {
    staffById.set(s.id, s);
  }

  // ── 7. WhatsApp send stub ─────────────────────────────────────────────────────
  //
  //  Replace this block with your actual WhatsApp API call when ready.
  //  Recommended providers:
  //    - Twilio WhatsApp API  (https://www.twilio.com/whatsapp)
  //    - Meta Cloud API       (https://developers.facebook.com/docs/whatsapp)
  //    - WATI / Vonage / etc.
  //
  //  Example payload shape:
  //    POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
  //    Body: {
  //      From: "whatsapp:+1415xxxxxxx",
  //      To:   `whatsapp:${staff.phone_number}`,
  //      Body: `Hi ${staff.first_name}, are you still working? Reply DONE to clock out.`,
  //    }
  //
  //  For now we log what would be sent so you can verify the logic is working.

  const whatsappPayloads = sessionsToRemind.map((session) => {
    const staff = staffById.get(session.staff_id);
    return {
      session_id:   session.id,
      staff_id:     session.staff_id,
      staff_name:   staff ? `${staff.first_name} ${staff.last_name}` : "Unknown",
      phone_number: staff?.phone_number ?? null,
      // Uncomment and adapt once you have a provider:
      // message: `Hi ${staff?.first_name}, it's past ${reminderTime5}. Are you still on shift? ...`,
      whatsapp_stub: "NOT_SENT — wire up provider in /app/api/reminders/check/route.ts",
    };
  });

  // ── 8. Return summary ─────────────────────────────────────────────────────────
  return NextResponse.json({
    ok:        true,
    reminded:  sessionsToRemind.length,
    reminder_time: reminderTime5,
    timestamp: now.toISOString(),
    sessions:  whatsappPayloads,
  });
}
