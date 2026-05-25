-- work_areas_and_home_location.sql
-- Run this in your Supabase SQL editor.
--
-- Creates the work_areas table and adds home location + work area
-- assignment columns to the staff table.

-- ─── 1. Create work_areas table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_areas (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  center_latitude  double precision not null,
  center_longitude double precision not null,
  radius_meters    integer not null default 100,
  created_at       timestamptz not null default now()
);

ALTER TABLE work_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_areas open access"
  ON work_areas FOR ALL USING (true);

-- ─── 2. Add columns to staff table ───────────────────────────────────────────

-- Home / base location (where the employee lives — for reference only)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS home_latitude  double precision,
  ADD COLUMN IF NOT EXISTS home_longitude double precision;

-- Link to their expected work area / geofence
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS expected_work_area_id uuid
    REFERENCES work_areas(id) ON DELETE SET NULL;

-- ─── 3. Seed a default work area ──────────────────────────────────────────────
-- Update the coordinates and radius to match your actual venue.
-- These are placeholder values — replace with your real GPS location.
-- Tip: open Google Maps, right-click your venue → "What's here?" to get lat/lng.

INSERT INTO work_areas (name, description, center_latitude, center_longitude, radius_meters)
VALUES (
  'The Nut Farm',
  'Main venue — all on-site staff clock in here',
  -33.9756,   -- ← replace with your actual latitude
  18.8257,    -- ← replace with your actual longitude
  150         -- radius in metres (150 m = comfortable margin for outdoor venue)
)
ON CONFLICT DO NOTHING;
