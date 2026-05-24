-- ═══════════════════════════════════════════════════════════════════════════
-- Session Approvals  ·  Migration
-- Adds payroll-run approval columns to clock_sessions so managers can mark
-- individual sessions (and whole pay runs) as approved.
-- Safe to run multiple times — all statements use IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. clock_sessions — approval columns ────────────────────────────────────

-- approved: true once a manager has approved this session for payroll
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS approved         BOOLEAN     NOT NULL DEFAULT FALSE;

-- approved_by: name / identifier of the manager who approved
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS approved_by      TEXT        DEFAULT NULL;

-- approved_at: exact moment approval was recorded
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ DEFAULT NULL;

-- approval_note: optional note the manager attached when approving
ALTER TABLE clock_sessions
  ADD COLUMN IF NOT EXISTS approval_note    TEXT        DEFAULT NULL;


-- ─── 2. Indexes ───────────────────────────────────────────────────────────────

-- Speeds up filtering to only sessions that are approved / pending
CREATE INDEX IF NOT EXISTS idx_clock_sessions_approved
  ON clock_sessions (approved)
  WHERE approved = TRUE;


-- ─── 3. Verification query ────────────────────────────────────────────────────
-- After running, paste this into the SQL editor to confirm all columns exist:
--
--  SELECT table_name, column_name, data_type, column_default, is_nullable
--  FROM information_schema.columns
--  WHERE table_name = 'clock_sessions'
--    AND column_name IN (
--      'approved', 'approved_by', 'approved_at', 'approval_note'
--    )
--  ORDER BY ordinal_position;
