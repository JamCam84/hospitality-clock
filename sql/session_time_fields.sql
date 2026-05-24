-- ═══════════════════════════════════════════════════════════════════════════
-- Session Time Fields  ·  Migration
-- Adds break tracking, hour overrides, and manager notes to clock_sessions.
-- Extends time_edit_log to record old/new values for these fields.
-- Safe to run multiple times — all statements use IF NOT EXISTS / DO blocks.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. clock_sessions — new time-correction columns ─────────────────────────

-- break_minutes: how many minutes of break the employee took during this shift.
-- When set, this is subtracted from (clock_out - clock_in) to get worked time.
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS break_minutes       INTEGER     DEFAULT NULL
    CHECK (break_minutes IS NULL OR break_minutes >= 0);

-- edited_total_hours: manager override for the final payroll hours on this session.
-- When set, this value is used directly — clock times and break_minutes are ignored.
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS edited_total_hours  NUMERIC(6,2) DEFAULT NULL
    CHECK (edited_total_hours IS NULL OR edited_total_hours >= 0);

-- manager_note: internal note the manager can attach to a session.
-- Not shown to employees — purely for payroll record-keeping.
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS manager_note        TEXT         DEFAULT NULL;


-- ─── 2. time_edit_log — record old/new values for the new fields ──────────────
-- These six columns capture what the values were before and after each edit,
-- so the full history of every change is preserved.

ALTER TABLE time_edit_log
  ADD COLUMN IF NOT EXISTS old_break_minutes        INTEGER      DEFAULT NULL;

ALTER TABLE time_edit_log
  ADD COLUMN IF NOT EXISTS new_break_minutes        INTEGER      DEFAULT NULL;

ALTER TABLE time_edit_log
  ADD COLUMN IF NOT EXISTS old_edited_total_hours   NUMERIC(6,2) DEFAULT NULL;

ALTER TABLE time_edit_log
  ADD COLUMN IF NOT EXISTS new_edited_total_hours   NUMERIC(6,2) DEFAULT NULL;

ALTER TABLE time_edit_log
  ADD COLUMN IF NOT EXISTS old_manager_note         TEXT         DEFAULT NULL;

ALTER TABLE time_edit_log
  ADD COLUMN IF NOT EXISTS new_manager_note         TEXT         DEFAULT NULL;


-- ─── 3. Verification query ────────────────────────────────────────────────────
-- After running, paste this into the SQL editor to confirm all columns exist:
--
--  SELECT table_name, column_name, data_type
--  FROM information_schema.columns
--  WHERE table_name IN ('clock_sessions', 'time_edit_log')
--    AND column_name IN (
--      'break_minutes', 'edited_total_hours', 'manager_note',
--      'old_break_minutes', 'new_break_minutes',
--      'old_edited_total_hours', 'new_edited_total_hours',
--      'old_manager_note', 'new_manager_note'
--    )
--  ORDER BY table_name, ordinal_position;
