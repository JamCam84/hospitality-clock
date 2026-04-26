-- ═══════════════════════════════════════════════════════════════════════════
-- Manager Approval + Payroll Settings  ·  Migration
-- Run this entire file in your Supabase SQL editor (or psql).
-- Safe to run multiple times — all statements use IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. payroll_settings ──────────────────────────────────────────────────────
--
--  Stores the one active row of payroll cycle configuration.
--  The settings page reads and upserts this row.

CREATE TABLE IF NOT EXISTS payroll_settings (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_cutoff_day    INTEGER     NOT NULL DEFAULT 25
                          CHECK (monthly_cutoff_day BETWEEN 1 AND 31),
  weekly_processing_day TEXT        NOT NULL DEFAULT 'Friday'
                          CHECK (weekly_processing_day IN (
                            'Monday','Tuesday','Wednesday','Thursday',
                            'Friday','Saturday','Sunday'
                          )),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (open policy — lock down further if you add auth)
ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_payroll_settings" ON payroll_settings;
CREATE POLICY "allow_all_payroll_settings"
  ON payroll_settings FOR ALL USING (true) WITH CHECK (true);

-- Seed one default row so the app always finds a settings row
INSERT INTO payroll_settings (monthly_cutoff_day, weekly_processing_day)
SELECT 25, 'Friday'
WHERE NOT EXISTS (SELECT 1 FROM payroll_settings LIMIT 1);


-- ─── 2. clock_sessions — extra columns for approval workflow ─────────────────
--
--  These columns are added safely with IF NOT EXISTS so existing data is
--  never touched.

-- edited: true once a manager has corrected the times on this session
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS edited         BOOLEAN     NOT NULL DEFAULT FALSE;

-- edited_by: free-text name / identifier of the manager who made the change
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS edited_by      TEXT        DEFAULT NULL;

-- edited_at: exact moment the edit was saved
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS edited_at      TIMESTAMPTZ DEFAULT NULL;

-- edit_reason: mandatory reason the manager supplied when editing
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS edit_reason    TEXT        DEFAULT NULL;

-- manually_added: true when a manager created this row via the Manual Add form
-- (i.e. it was never a real clock-in event)
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS manually_added BOOLEAN     NOT NULL DEFAULT FALSE;

-- manual_add_reason: mandatory reason the manager supplied when adding manually
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS manual_add_reason TEXT     DEFAULT NULL;


-- ─── 3. time_edit_log ─────────────────────────────────────────────────────────
--
--  Full audit trail of every manager edit and every manually-added session.
--  One row per action; never updated after insert.

CREATE TABLE IF NOT EXISTS time_edit_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link back to the affected clock_sessions row
  clock_session_id    UUID        NOT NULL
                        REFERENCES clock_sessions (id) ON DELETE CASCADE,

  -- The employee the session belongs to
  staff_id            UUID        NOT NULL
                        REFERENCES staff (id) ON DELETE CASCADE,

  -- Previous values (NULL for manual_add actions — nothing to overwrite)
  old_clock_in_time   TIMESTAMPTZ DEFAULT NULL,
  old_clock_out_time  TIMESTAMPTZ DEFAULT NULL,

  -- New values written by the manager
  new_clock_in_time   TIMESTAMPTZ DEFAULT NULL,
  new_clock_out_time  TIMESTAMPTZ DEFAULT NULL,

  -- 'edit' | 'manual_add'
  action_type         TEXT        NOT NULL
                        CHECK (action_type IN ('edit', 'manual_add')),

  -- Who made the change (manager name / email — free text for now)
  changed_by          TEXT        NOT NULL DEFAULT 'Manager',

  -- The reason the manager provided (always required in the UI)
  reason              TEXT        NOT NULL,

  -- When this log row was created
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (open policy — lock down further if you add auth)
ALTER TABLE time_edit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_time_edit_log" ON time_edit_log;
CREATE POLICY "allow_all_time_edit_log"
  ON time_edit_log FOR ALL USING (true) WITH CHECK (true);

-- Index to quickly look up all log rows for a given session
CREATE INDEX IF NOT EXISTS idx_time_edit_log_session_id
  ON time_edit_log (clock_session_id);

-- Index to quickly look up all changes made to a given employee
CREATE INDEX IF NOT EXISTS idx_time_edit_log_staff_id
  ON time_edit_log (staff_id, created_at DESC);


-- ─── 4. Helpful indexes on clock_sessions ────────────────────────────────────

-- Speeds up the Approval page query that filters sessions by date range
CREATE INDEX IF NOT EXISTS idx_clock_sessions_work_date
  ON clock_sessions (work_date);

-- Speeds up filtering to only sessions that were edited or manually added
CREATE INDEX IF NOT EXISTS idx_clock_sessions_edited
  ON clock_sessions (edited)
  WHERE edited = TRUE;

CREATE INDEX IF NOT EXISTS idx_clock_sessions_manually_added
  ON clock_sessions (manually_added)
  WHERE manually_added = TRUE;


-- ─── 5. Verification query ────────────────────────────────────────────────────
--
--  After running, paste this into the SQL editor to confirm everything exists:
--
--  SELECT table_name, column_name, data_type, column_default, is_nullable
--  FROM information_schema.columns
--  WHERE table_name IN ('payroll_settings', 'clock_sessions', 'time_edit_log')
--    AND column_name IN (
--      'id', 'monthly_cutoff_day', 'weekly_processing_day',
--      'edited', 'edited_by', 'edited_at', 'edit_reason',
--      'manually_added', 'manual_add_reason',
--      'clock_session_id', 'action_type', 'changed_by', 'reason'
--    )
--  ORDER BY table_name, ordinal_position;
