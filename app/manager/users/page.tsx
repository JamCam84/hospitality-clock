"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import { PageHeader } from "@/components/ui";
import {
  type DashboardUser,
  setActiveUserId,
  getActiveUserId,
} from "@/lib/useCurrentUser";

// ─── Role defaults ────────────────────────────────────────────────────────────
// When a manager picks a role, these permissions are pre-ticked automatically.
// They can still tick/untick individual boxes after.

type PermissionKey =
  | "can_view_dashboard"
  | "can_manage_staff"
  | "can_approve_time"
  | "can_edit_time"
  | "can_export_payroll"
  | "can_view_financials";

const ROLE_DEFAULTS: Record<string, Record<PermissionKey, boolean>> = {
  Admin: {
    can_view_dashboard:  true,
    can_manage_staff:    true,
    can_approve_time:    true,
    can_edit_time:       true,
    can_export_payroll:  true,
    can_view_financials: true,
  },
  Manager: {
    can_view_dashboard:  true,
    can_manage_staff:    true,
    can_approve_time:    true,
    can_edit_time:       true,
    can_export_payroll:  false,
    can_view_financials: false,
  },
  Payroll: {
    can_view_dashboard:  true,
    can_manage_staff:    false,
    can_approve_time:    false,
    can_edit_time:       false,
    can_export_payroll:  true,
    can_view_financials: true,
  },
};

// Human-readable labels and descriptions for each permission checkbox
const PERM_META: { key: PermissionKey; label: string; description: string }[] =
  [
    {
      key: "can_view_dashboard",
      label: "View Dashboard",
      description: "See the overview dashboard and reports",
    },
    {
      key: "can_manage_staff",
      label: "Manage Staff",
      description: "Add, edit, and deactivate staff members",
    },
    {
      key: "can_approve_time",
      label: "Approve Time",
      description: "Approve clock sessions for payroll",
    },
    {
      key: "can_edit_time",
      label: "Edit Time",
      description: "Correct clock-in / clock-out times and add manual sessions",
    },
    {
      key: "can_export_payroll",
      label: "Export Payroll",
      description: "Download the payroll spreadsheet",
    },
    {
      key: "can_view_financials",
      label: "View Financials",
      description: "Access financial summaries and pay run history",
    },
  ];

// ─── Blank form ───────────────────────────────────────────────────────────────

type FormData = {
  full_name: string;
  email: string;
  role: string;
} & Record<PermissionKey, boolean>;

function blankForm(role = "Manager"): FormData {
  return {
    full_name: "",
    email: "",
    role,
    ...ROLE_DEFAULTS[role],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // Which user is currently "logged in" (stored in localStorage)
  const [activeUserId, setActiveUserIdState] = useState<string | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<DashboardUser | null>(null);
  const [form, setForm] = useState<FormData>(blankForm());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ── Load users ─────────────────────────────────────────────────────────────
  async function loadUsers() {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("dashboard_users")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMsg("Could not load users. Check your Supabase connection.");
    } else {
      setUsers((data ?? []) as DashboardUser[]);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    loadUsers();
    setActiveUserIdState(getActiveUserId());
  }, []);

  // ── Open drawer to add a new user ──────────────────────────────────────────
  function openAddDrawer() {
    setEditingUser(null);
    setForm(blankForm());
    setSaveError("");
    setDrawerOpen(true);
  }

  // ── Open drawer to edit an existing user ──────────────────────────────────
  function openEditDrawer(user: DashboardUser) {
    setEditingUser(user);
    setForm({
      full_name:           user.full_name,
      email:               user.email ?? "",
      role:                user.role,
      can_view_dashboard:  user.can_view_dashboard,
      can_manage_staff:    user.can_manage_staff,
      can_approve_time:    user.can_approve_time,
      can_edit_time:       user.can_edit_time,
      can_export_payroll:  user.can_export_payroll,
      can_view_financials: user.can_view_financials,
    });
    setSaveError("");
    setDrawerOpen(true);
  }

  // ── When the role dropdown changes, reset permissions to that role's defaults
  function handleRoleChange(newRole: string) {
    setForm((prev) => ({
      ...prev,
      role: newRole,
      ...ROLE_DEFAULTS[newRole],
    }));
  }

  // ── Toggle a single permission checkbox ───────────────────────────────────
  function togglePerm(key: PermissionKey) {
    setForm((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // ── Save (create or update) ────────────────────────────────────────────────
  async function handleSave() {
    if (!form.full_name.trim()) {
      setSaveError("Name is required.");
      return;
    }

    setIsSaving(true);
    setSaveError("");

    const payload = {
      full_name:           form.full_name.trim(),
      email:               form.email.trim() || null,
      role:                form.role,
      can_view_dashboard:  form.can_view_dashboard,
      can_manage_staff:    form.can_manage_staff,
      can_approve_time:    form.can_approve_time,
      can_edit_time:       form.can_edit_time,
      can_export_payroll:  form.can_export_payroll,
      can_view_financials: form.can_view_financials,
    };

    if (editingUser) {
      // Update existing
      const { error } = await supabase
        .from("dashboard_users")
        .update(payload)
        .eq("id", editingUser.id);

      if (error) {
        setSaveError("Could not save changes: " + error.message);
        setIsSaving(false);
        return;
      }
    } else {
      // Insert new
      const { error } = await supabase
        .from("dashboard_users")
        .insert([payload]);

      if (error) {
        setSaveError("Could not create user: " + error.message);
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    setDrawerOpen(false);
    loadUsers();
  }

  // ── Deactivate / reactivate a user ────────────────────────────────────────
  async function toggleActive(user: DashboardUser) {
    const { error } = await supabase
      .from("dashboard_users")
      .update({ active: !user.active })
      .eq("id", user.id);

    if (!error) {
      // If we just deactivated the currently logged-in user, log them out
      if (!user.active === false && activeUserId === user.id) {
        setActiveUserId(null);
        setActiveUserIdState(null);
      }
      loadUsers();
    }
  }

  // ── Switch the "current user" (persists to localStorage) ──────────────────
  function handleSwitchUser(userId: string) {
    setActiveUserId(userId);
    setActiveUserIdState(userId);
  }

  function handleSignOut() {
    setActiveUserId(null);
    setActiveUserIdState(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const activeUser = users.find((u) => u.id === activeUserId) ?? null;

  return (
    <div className="min-h-screen bg-stone-50">
      <ManagerNav />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <PageHeader
          title="Users & Permissions"
          subtitle="Manage who can access the dashboard and what they can do."
        />

        {/* ── Error ── */}
        {errorMsg && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4
                          text-red-700 text-sm font-medium">
            {errorMsg}
          </div>
        )}

        {/* ── Current user banner ── */}
        <div className="mb-6 bg-white border border-stone-200 rounded-2xl px-5 py-4
                        flex items-center justify-between gap-4 shadow-sm">
          <div>
            <p className="text-xs text-stone-400 font-medium uppercase tracking-wide mb-0.5">
              Currently logged in as
            </p>
            {activeUser ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">
                  {activeUser.full_name}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  activeUser.role === "Admin"
                    ? "bg-purple-100 text-purple-700"
                    : activeUser.role === "Payroll"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}>
                  {activeUser.role}
                </span>
              </div>
            ) : (
              <p className="text-sm text-stone-500 italic">
                No user selected — all permissions are enabled
              </p>
            )}
          </div>
          {activeUser && (
            <button
              onClick={handleSignOut}
              className="text-xs font-semibold text-stone-400 hover:text-red-500
                         border border-stone-200 hover:border-red-200 rounded-lg
                         px-3 py-1.5 transition-all duration-150"
            >
              Sign out
            </button>
          )}
        </div>

        {/* ── Header row with Add button ── */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-stone-700">All users</h2>
          <button
            onClick={openAddDrawer}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700
                       text-white text-sm font-semibold px-4 py-2 rounded-xl
                       transition-colors duration-150 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}
              viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add User
          </button>
        </div>

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="flex flex-col gap-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-stone-100 h-20" />
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && users.length === 0 && !errorMsg && (
          <div className="bg-white border border-stone-100 rounded-2xl px-6 py-12
                          text-center shadow-sm">
            <p className="text-3xl mb-3">👤</p>
            <p className="text-stone-700 font-semibold">No users yet</p>
            <p className="text-stone-400 text-sm mt-1">
              Add a user to get started with permissions.
            </p>
          </div>
        )}

        {/* ── User list ── */}
        {!isLoading && users.length > 0 && (
          <div className="flex flex-col gap-3">
            {users.map((user) => {
              const isActive = user.id === activeUserId;
              const permsOn = PERM_META.filter(
                (p) => user[p.key as keyof DashboardUser]
              );

              return (
                <div
                  key={user.id}
                  className={`bg-white rounded-2xl border shadow-sm overflow-hidden
                               transition-all duration-150 ${
                    isActive
                      ? "border-emerald-300 ring-1 ring-emerald-200"
                      : "border-stone-100"
                  } ${!user.active ? "opacity-60" : ""}`}
                >
                  <div className="px-5 py-4 flex items-start gap-4">
                    {/* Avatar circle */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center
                                     text-sm font-bold shrink-0 ${
                      user.role === "Admin"
                        ? "bg-purple-100 text-purple-700"
                        : user.role === "Payroll"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {user.full_name.charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-stone-800">
                          {user.full_name}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          user.role === "Admin"
                            ? "bg-purple-100 text-purple-700"
                            : user.role === "Payroll"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {user.role}
                        </span>
                        {!user.active && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium
                                           bg-stone-100 text-stone-500">
                            Inactive
                          </span>
                        )}
                        {isActive && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium
                                           bg-emerald-50 text-emerald-600 border border-emerald-200">
                            ● Active session
                          </span>
                        )}
                      </div>
                      {user.email && (
                        <p className="text-xs text-stone-400 mt-0.5 truncate">
                          {user.email}
                        </p>
                      )}

                      {/* Permission chips */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {permsOn.map((p) => (
                          <span key={p.key}
                            className="text-xs px-2 py-0.5 rounded-full bg-stone-100
                                       text-stone-600 font-medium">
                            {p.label}
                          </span>
                        ))}
                        {permsOn.length === 0 && (
                          <span className="text-xs text-stone-400 italic">
                            No permissions assigned
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Switch to this user */}
                      {user.active && !isActive && (
                        <button
                          onClick={() => handleSwitchUser(user.id)}
                          className="text-xs font-semibold text-emerald-600
                                     hover:bg-emerald-50 border border-emerald-200
                                     hover:border-emerald-400 rounded-lg px-3 py-1.5
                                     transition-all duration-150"
                        >
                          Switch to
                        </button>
                      )}

                      {/* Edit */}
                      <button
                        onClick={() => openEditDrawer(user)}
                        className="text-xs font-semibold text-stone-500
                                   hover:text-sky-700 hover:bg-sky-50 border
                                   border-stone-200 hover:border-sky-200 rounded-lg
                                   px-2.5 py-1.5 transition-all duration-150"
                      >
                        Edit
                      </button>

                      {/* Deactivate / Reactivate */}
                      <button
                        onClick={() => toggleActive(user)}
                        className={`text-xs font-semibold border rounded-lg px-2.5 py-1.5
                                    transition-all duration-150 ${
                          user.active
                            ? "text-red-500 hover:bg-red-50 border-stone-200 hover:border-red-200"
                            : "text-emerald-600 hover:bg-emerald-50 border-stone-200 hover:border-emerald-300"
                        }`}
                      >
                        {user.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Info note ── */}
        <p className="text-xs text-stone-400 text-center mt-8 leading-relaxed">
          This is a simplified user system — no passwords are required yet.
          Use the <strong>Switch to</strong> button to set the active session,
          which controls what the current browser can see and do.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Add / Edit drawer (slide in from the right)
         ══════════════════════════════════════════════════════════════════════ */}

      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50
                    flex flex-col transition-transform duration-300 ease-in-out ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-5
                        border-b border-stone-100">
          <h3 className="text-base font-bold text-stone-800">
            {editingUser ? "Edit User" : "Add New User"}
          </h3>
          <button
            onClick={() => setDrawerOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg
                       text-stone-400 hover:text-stone-600 hover:bg-stone-100
                       transition-colors duration-150"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor"
              strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Full name */}
          <div>
            <label className="block text-xs font-semibold text-stone-500 mb-1.5">
              Full name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, full_name: e.target.value }))
              }
              placeholder="e.g. Sarah Jones"
              className="w-full border border-stone-200 rounded-xl px-3.5 py-2.5
                         text-sm text-stone-800 focus:outline-none focus:ring-2
                         focus:ring-emerald-400 focus:border-transparent"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-stone-500 mb-1.5">
              Email <span className="text-stone-300 font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, email: e.target.value }))
              }
              placeholder="sarah@thenutfarm.co.za"
              className="w-full border border-stone-200 rounded-xl px-3.5 py-2.5
                         text-sm text-stone-800 focus:outline-none focus:ring-2
                         focus:ring-emerald-400 focus:border-transparent"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-stone-500 mb-1.5">
              Role
            </label>
            <select
              value={form.role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3.5 py-2.5
                         text-sm text-stone-800 bg-white focus:outline-none focus:ring-2
                         focus:ring-emerald-400 focus:border-transparent"
            >
              <option value="Admin">Admin — all permissions</option>
              <option value="Manager">Manager — staff, approve &amp; edit time</option>
              <option value="Payroll">Payroll — export &amp; financials only</option>
            </select>
            <p className="text-xs text-stone-400 mt-1.5">
              Choosing a role auto-fills the permissions below. You can still
              customise them individually.
            </p>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-xs font-semibold text-stone-500 mb-2">
              Permissions
            </label>
            <div className="flex flex-col gap-2">
              {PERM_META.map((p) => (
                <label
                  key={p.key}
                  className="flex items-start gap-3 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={!!form[p.key]}
                    onChange={() => togglePerm(p.key)}
                    className="mt-0.5 w-4 h-4 rounded text-emerald-600
                               border-stone-300 focus:ring-emerald-500 cursor-pointer"
                  />
                  <div>
                    <p className="text-sm font-medium text-stone-700 group-hover:text-stone-900">
                      {p.label}
                    </p>
                    <p className="text-xs text-stone-400">{p.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Save error */}
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3
                            text-red-700 text-sm">
              {saveError}
            </div>
          )}
        </div>

        {/* Drawer footer */}
        <div className="px-6 py-4 border-t border-stone-100 flex gap-3">
          <button
            onClick={() => setDrawerOpen(false)}
            className="flex-1 border border-stone-200 rounded-xl py-2.5 text-sm
                       font-semibold text-stone-500 hover:bg-stone-50
                       transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50
                       text-white text-sm font-semibold rounded-xl py-2.5
                       transition-colors duration-150"
          >
            {isSaving ? "Saving…" : editingUser ? "Save changes" : "Create user"}
          </button>
        </div>
      </div>
    </div>
  );
}
