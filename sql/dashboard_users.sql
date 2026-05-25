-- dashboard_users.sql
-- Run this in your Supabase SQL editor to create the dashboard users table.
-- This table manages who can log into the manager dashboard and what they can do.

CREATE TABLE IF NOT EXISTS dashboard_users (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  email               text unique,
  role                text not null default 'Manager',
  -- Permission flags
  can_view_dashboard  boolean not null default true,
  can_manage_staff    boolean not null default false,
  can_approve_time    boolean not null default false,
  can_edit_time       boolean not null default false,
  can_export_payroll  boolean not null default false,
  can_view_financials boolean not null default false,
  -- Status
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Enable Row Level Security (open policy for MVP — no real auth yet)
ALTER TABLE dashboard_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_users open access"
  ON dashboard_users FOR ALL USING (true);

-- Seed a default Admin user so there's always someone to log in as
INSERT INTO dashboard_users (
  full_name, email, role,
  can_view_dashboard, can_manage_staff, can_approve_time,
  can_edit_time, can_export_payroll, can_view_financials
)
VALUES (
  'Admin User', 'admin@thenutfarm.co.za', 'Admin',
  true, true, true, true, true, true
)
ON CONFLICT (email) DO NOTHING;
