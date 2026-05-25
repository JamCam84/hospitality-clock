/**
 * lib/useCurrentUser.ts
 *
 * MVP "current user" hook.  No real auth — the active user ID is stored in
 * localStorage so it persists between page refreshes.  A user is selected
 * on the /manager/users page via a "Switch to this user" button.
 *
 * Permission defaults (all permissions default to TRUE when no user is set,
 * so the app keeps working exactly as before for anyone who hasn't set up users).
 */

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DashboardUser = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  can_view_dashboard: boolean;
  can_manage_staff: boolean;
  can_approve_time: boolean;
  can_edit_time: boolean;
  can_export_payroll: boolean;
  can_view_financials: boolean;
  active: boolean;
  created_at: string;
};

// localStorage key where we store the active user's UUID
const LS_KEY = "dashboard_active_user_id";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCurrentUser() {
  const [currentUser, setCurrentUserState] = useState<DashboardUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: read the stored user ID from localStorage, then fetch the user
  useEffect(() => {
    const storedId =
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;

    if (!storedId) {
      setIsLoading(false);
      return;
    }

    supabase
      .from("dashboard_users")
      .select("*")
      .eq("id", storedId)
      .eq("active", true)
      .single()
      .then(({ data }) => {
        setCurrentUserState((data as DashboardUser | null) ?? null);
        setIsLoading(false);
      });
  }, []);

  // Persist a new user selection to localStorage and component state
  function setCurrentUser(user: DashboardUser | null) {
    if (typeof window !== "undefined") {
      if (user) {
        localStorage.setItem(LS_KEY, user.id);
      } else {
        localStorage.removeItem(LS_KEY);
      }
    }
    setCurrentUserState(user);
  }

  // ── Computed permission flags ──────────────────────────────────────────────
  // When no user is set, all permissions default to TRUE so existing workflows
  // are unaffected (backwards-compatible).

  const canViewDashboard  = !currentUser || currentUser.can_view_dashboard;
  const canManageStaff    = !currentUser || currentUser.can_manage_staff;
  const canApproveTime    = !currentUser || currentUser.can_approve_time;
  const canEditTime       = !currentUser || currentUser.can_edit_time;
  const canExportPayroll  = !currentUser || currentUser.can_export_payroll;
  const canViewFinancials = !currentUser || currentUser.can_view_financials;

  return {
    currentUser,
    setCurrentUser,
    isLoading,
    // Permission flags
    canViewDashboard,
    canManageStaff,
    canApproveTime,
    canEditTime,
    canExportPayroll,
    canViewFinancials,
  };
}

// ─── Standalone helpers ───────────────────────────────────────────────────────

/** Read the active user ID directly from localStorage (no React state). */
export function getActiveUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LS_KEY);
}

/** Write the active user ID directly to localStorage. */
export function setActiveUserId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(LS_KEY, id);
  } else {
    localStorage.removeItem(LS_KEY);
  }
}
