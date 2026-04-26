-- ═══════════════════════════════════════════════════════════════════════════
-- Clock-Out Reminder Feature  ·  Migration
-- Run this in your Supabase SQL editor (or psql).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. Reminder settings  (added to payroll_settings) ───────────────────────
--
--  reminder_enabled  bool   – turns the feature on / off globally
--  reminder_time     time   – e.g. '16:30:00'  (local time, 24-h)
--
--  These live in the single payroll_settings row that already exists.
--  If you want per-employee overrides later, mirror these columns to
--  the staff table and do a COALESCE(staff.reminder_time, settings.reminder_time).

ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS reminder_enabled  BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_time     TIME               DEFAULT NULL;


-- ─── 2. Reminder tracking  (added to clock_sessions) ─────────────────────────
--
--  clock_out_reminder_sent_at          – when the backend first flagged / sent
--                                        the reminder (null = not yet triggered)
--
--  clock_out_reminder_response         – employee's answer when prompted:
--                                          'still_working' | 'clocked_out' | null
--
--  clock_out_reminder_acknowledged_at  – wall-clock time of the response
--
--  These three form a complete audit trail for each reminder event.

ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS clock_out_reminder_sent_at         TIMESTAMPTZ  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS clock_out_reminder_response        TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS clock_out_reminder_acknowledged_at TIMESTAMPTZ  DEFAULT NULL;

-- Optional constraint — keeps responses to the two known values
ALTER TABLE clock_sessions
  DROP CONSTRAINT IF EXISTS chk_reminder_response;

ALTER TABLE clock_sessions
  ADD CONSTRAINT chk_reminder_response
    CHECK (
      clock_out_reminder_response IS NULL
      OR clock_out_reminder_response IN ('still_working', 'clocked_out')
    );


-- ─── 3. Index for the backend reminder scanner ────────────────────────────────
--
--  The API route at /api/reminders/check does:
--    SELECT * FROM clock_sessions
--    WHERE clock_out_time IS NULL
--      AND clock_out_reminder_sent_at IS NULL
--
--  This partial index makes that query fast even with many sessions.

CREATE INDEX IF NOT EXISTS idx_clock_sessions_open_unreminded
  ON clock_sessions (staff_id, clock_in_time)
  WHERE clock_out_time IS NULL
    AND clock_out_reminder_sent_at IS NULL;


-- ─── 4. Verification query ────────────────────────────────────────────────────
--
--  After running, confirm the columns exist:

SELECT
  column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'payroll_settings'
  AND column_name IN ('reminder_enabled', 'reminder_time')
UNION ALL
SELECT
  column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'clock_sessions'
  AND column_name IN (
    'clock_out_reminder_sent_at',
    'clock_out_reminder_response',
    'clock_out_reminder_acknowledged_at'
  )
ORDER BY column_name;
