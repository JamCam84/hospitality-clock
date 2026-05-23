@AGENTS.md

# The Nut Farm — Hospitality Clock App

## Project overview
Next.js App Router + Supabase + Tailwind CSS + TypeScript clock-in/clock-out system for hospitality staff. Deployed on Vercel.

## Stack
- **Framework:** Next.js App Router (v15+) — read `node_modules/next/dist/docs/` before touching routing or params
- **Database:** Supabase (Postgres) with Row Level Security enabled
- **Styling:** Tailwind CSS utility classes only
- **Language:** TypeScript strict mode
- **WhatsApp:** Twilio WhatsApp API (`lib/twilio.ts`)

## Key environment variables (all required)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # used by reminder API route only
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_FROM=whatsapp:+27720929004   # production SA number
NEXT_PUBLIC_APP_URL              # full Vercel URL — needed for clickable WA links
REMINDER_SECRET                  # optional, secures /api/reminders/check cron
```

## Database tables
All migrations have been run. Tables in use:

| Table | Purpose |
|---|---|
| `staff` | Employee records — id (UUID), first_name, last_name, phone_number, role, branch, employee_number, pay_frequency |
| `clock_sessions` | Clock in/out events — includes edited/manually_added audit columns |
| `payroll_settings` | Single-row config: monthly_cutoff_day, weekly_processing_day, reminder_enabled, reminder_time |
| `time_edit_log` | Audit trail for every manager edit and manual time add |

### clock_sessions extra columns (added by migration)
`edited`, `edited_by`, `edited_at`, `edit_reason`, `manually_added`, `manual_add_reason`,
`clock_out_reminder_sent_at`, `clock_out_reminder_response`, `clock_out_reminder_acknowledged_at`

## Supabase typing gotcha — IMPORTANT
Supabase's generated types don't know about migration-added columns, so direct casts like
`(data ?? []) as ClockSession[]` cause a **`GenericStringError[]`** build error on Vercel.

**Always use the `toSession()` mapper pattern:**
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ClockSession {
  return row as unknown as ClockSession;
}

// Usage:
setSessions((sessionResult.data ?? []).map(toSession));
```
This pattern is already in place in:
- `app/manager/approval/page.tsx`
- `app/manager/calendar-times/page.tsx`

Apply it to any new page that queries `clock_sessions`.

## RLS (Row Level Security) — IMPORTANT
The Supabase client uses the `anon` key. All tables have open RLS policies for now (`USING (true)`).

**Silent RLS failure pattern:** `supabase.update()` without `.select().single()` returns
`{ error: null, data: null }` even when RLS blocks the write. Always chain:
```typescript
const { data: savedRow, error } = await supabase
  .from("staff")
  .update(payload)
  .eq("id", id)
  .select("*")
  .single();
// PGRST116 error code = RLS blocked (0 rows returned)
```

## Key files

### API routes
- `app/api/send-whatsapp/route.ts` — POST, sends WhatsApp via Twilio, returns `{ success, step, sid }` or `{ error, twilioCode, twilioMoreInfo }`
- `app/api/reminders/check/route.ts` — GET cron endpoint, scans for open sessions past reminder time

### Lib
- `lib/twilio.ts` — `sendWhatsAppMessage(to, message)` + `normalisePhone(raw)` + `TwilioSendError` class. Handles SA number format (`0xx` → `+27xx`).
- `lib/supabase.ts` — single shared client using anon key
- `lib/time-calc.ts` — `calcWorkedMinutes`, `calcBreakMinutes`, `formatHours`, `calcPayPeriod`, `isoToDatetimeLocal`, `localToday`, `PayrollSettings` type

### Manager pages
- `app/manager/staff/page.tsx` — staff list + inline edit drawer (uses `toSession`-style update pattern)
- `app/manager/staff/[staffId]/page.tsx` — individual edit page with atomic `.update().select().single()`
- `app/manager/clock-links/page.tsx` — send WhatsApp clock links to staff, debug box included
- `app/manager/approval/page.tsx` — payroll review, session edit, manual time add, audit log
- `app/manager/calendar-times/page.tsx` — calendar grid view, cell click → side panel edit

### SQL migrations (already run in production)
- `sql/manager_approval.sql` — payroll_settings, time_edit_log, clock_sessions audit columns
- `sql/clock_out_reminders.sql` — reminder columns on payroll_settings and clock_sessions

## WhatsApp flow
1. Manager opens `/manager/clock-links`
2. Clicks "Send WhatsApp" → calls `POST /api/send-whatsapp`
3. API normalises phone → calls Twilio → returns SID or structured error
4. UI shows debug box with phone sent, message sent, full API response

Clock link format: `${NEXT_PUBLIC_APP_URL}/clock/${staffId}`

## Common issues & fixes
- **WA links not clickable:** `NEXT_PUBLIC_APP_URL` must be set to the real Vercel domain, not localhost
- **Edits not persisting:** RLS policy missing UPDATE permission on `staff` table, or not using `.select().single()` after update
- **GenericStringError[] build error:** Use `toSession()` mapper — never cast Supabase data directly to a type that includes migration-added columns
- **Comment block breaking TS:** Never put `*/` inside `/** ... */` comments (e.g. cron expressions like `*/5 * * * *`) — use `//` line comments instead
