"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  role: string | null;
  branch: string | null;
  employee_number: string | null;
  pay_frequency: string | null;
};

// ─── Options shared between selects ──────────────────────────────────────────

const ROLE_OPTIONS = [
  "Waiter", "Waitress", "Bartender", "Barista", "Host", "Hostess",
  "Manager", "Chef", "Sous Chef", "Kitchen Staff", "Cashier",
  "Cleaner", "Security", "Driver", "General Worker",
];

const BRANCH_OPTIONS = [
  "The Nut Farm", "Main Venue", "Restaurant", "Events", "Kitchen",
];

// ─── Shared input / select style ─────────────────────────────────────────────

const fieldCls =
  "w-full rounded-xl border border-stone-300 px-4 py-3 text-base text-stone-800 " +
  "placeholder:text-stone-400 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent " +
  "transition disabled:opacity-50";

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditStaffPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = use(params);

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    firstName:      "",
    lastName:       "",
    phone:          "",
    role:           "",
    branch:         "",
    employeeNumber: "",
    payFrequency:   "",
  });

  // ── UI state ──────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving,  setIsSaving]  = useState(false);
  const [message,   setMessage]   = useState("");
  const [isError,   setIsError]   = useState(false);
  const [notFound,  setNotFound]  = useState(false);

  // ─── Populate form from a database row ───────────────────────────────────
  // Used on first load AND after every successful save, so the form always
  // shows exactly what Supabase contains — never stale local state.
  function populateForm(s: StaffMember) {
    setForm({
      firstName:      s.first_name      ?? "",
      lastName:       s.last_name       ?? "",
      phone:          s.phone_number    ?? "",
      role:           s.role            ?? "",
      branch:         s.branch          ?? "",
      employeeNumber: s.employee_number ?? "",
      payFrequency:   s.pay_frequency   ?? "",
    });
  }

  // ─── Load employee on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!staffId || staffId.trim() === "") {
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    async function fetchStaff() {
      console.log("[EditStaff] Loading staff id:", staffId);

      const { data, error } = await supabase
        .from("staff")
        .select("*")
        .eq("id", staffId)
        .single();

      if (error) {
        console.error("[EditStaff] Load error:", error);
        setNotFound(true);
      } else if (!data) {
        console.warn("[EditStaff] No row found for id:", staffId);
        setNotFound(true);
      } else {
        populateForm(data as StaffMember);
      }

      setIsLoading(false);
    }

    fetchStaff();
  }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Input / select change handler ───────────────────────────────────────
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setMessage(""); // clear feedback as soon as the user edits
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setMessage("First name and last name are required.");
      setIsError(true);
      return;
    }

    setIsSaving(true);
    setMessage("");

    const payload = {
      first_name:      form.firstName.trim(),
      last_name:       form.lastName.trim(),
      full_name:       `${form.firstName.trim()} ${form.lastName.trim()}`,
      phone_number:    form.phone.trim(),
      role:            form.role,
      branch:          form.branch,
      employee_number: form.employeeNumber.trim(),
      pay_frequency:   form.payFrequency,
    };

    console.log("[EditStaff] Saving staff id:", staffId);
    console.log("[EditStaff] Update payload:", payload);

    // ── Single atomic call: update + immediately return the saved row ──────
    //
    // Why .select().single() matters:
    //   • Without it, Supabase returns no data and no error even when a Row
    //     Level Security (RLS) policy silently blocks the write.
    //   • With .select().single(), Supabase must return exactly 1 updated row.
    //     If 0 rows come back (RLS blocked the write, or the id didn't match),
    //     the Supabase client surfaces a real error (code PGRST116) instead of
    //     pretending everything is fine.
    //   • If the update succeeds, `data` contains the row as Supabase stored it
    //     — which we use to repopulate the form so it always reflects DB truth.

    const { data: savedRow, error: updateError } = await supabase
      .from("staff")
      .update(payload)
      .eq("id", staffId)
      .select("*")
      .single();

    if (updateError) {
      // Log the full Supabase error object — code, message, details, hint
      console.error("[EditStaff] Update failed:", updateError);

      // Give a plain-English message depending on the error code
      let friendlyMsg: string;

      if (updateError.code === "PGRST116") {
        // PGRST116 = "no rows returned" after the update
        // Most common cause: an RLS policy is blocking the write
        friendlyMsg =
          "Save was blocked — the database rejected the update. " +
          "This is usually caused by a Row Level Security (RLS) policy on the " +
          "staff table. Open your Supabase dashboard → Authentication → " +
          "Policies and make sure the anon role has UPDATE permission.";
      } else {
        friendlyMsg = `Error saving: ${updateError.message} (code: ${updateError.code})`;
      }

      setMessage(friendlyMsg);
      setIsError(true);
      setIsSaving(false);
      return;
    }

    if (!savedRow) {
      // Shouldn't normally reach here, but guard anyway
      console.warn("[EditStaff] Update returned no data and no error.");
      setMessage(
        "Save completed but the database returned no data. " +
        "Refresh the page to check whether your changes were stored."
      );
      setIsError(true);
      setIsSaving(false);
      return;
    }

    // ── Success: repopulate from what Supabase actually stored ───────────
    console.log("[EditStaff] Save successful. Saved row:", savedRow);
    populateForm(savedRow as StaffMember);
    setMessage("Changes saved successfully!");
    setIsError(false);
    setIsSaving(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 font-sans">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-stone-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">

          <Link
            href="/manager/staff"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500
                       hover:bg-stone-100 active:scale-95 transition-all duration-150 shrink-0"
            aria-label="Back to staff list"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-stone-800 tracking-tight leading-tight">
              Edit Employee
            </h1>
            <p className="text-xs text-stone-400">Update this team member's details</p>
          </div>

          <Link
            href={`/manager/employees/${staffId}`}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-sky-600
                       hover:bg-sky-50 border border-sky-200 rounded-lg px-3 py-1.5
                       transition-all duration-150"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5
                   c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477
                   0-8.268-2.943-9.542-7z" />
            </svg>
            Profile
          </Link>
        </div>
      </header>

      <ManagerNav />

      <main className="max-w-lg mx-auto px-4 py-6">

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="space-y-4 animate-pulse">
            <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div key={n} className="space-y-2">
                  <div className="h-3 bg-stone-200 rounded w-24" />
                  <div className="h-12 bg-stone-100 rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Not found ── */}
        {!isLoading && notFound && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94
                     a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <p className="text-stone-700 font-semibold mb-1">Employee not found</p>
            <p className="text-sm text-stone-400 mb-6">
              This link may be invalid or the employee may have been removed.
            </p>
            <Link
              href="/manager/staff"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white
                         font-semibold text-sm rounded-xl px-5 py-2.5 transition-colors"
            >
              ← Back to Staff
            </Link>
          </div>
        )}

        {/* ── Edit form ── */}
        {!isLoading && !notFound && (
          <section className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
            <form onSubmit={handleSave} className="space-y-5">

              {/* First Name + Last Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="firstName">
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="firstName" name="firstName" type="text"
                    value={form.firstName} onChange={handleChange}
                    required disabled={isSaving} className={fieldCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="lastName">
                    Last Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="lastName" name="lastName" type="text"
                    value={form.lastName} onChange={handleChange}
                    required disabled={isSaving} className={fieldCls}
                  />
                </div>
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="phone">
                  Phone Number
                </label>
                <input
                  id="phone" name="phone" type="text" inputMode="tel"
                  value={form.phone} onChange={handleChange}
                  placeholder="e.g. 082 555 1234"
                  disabled={isSaving} className={fieldCls}
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="role">
                  Role
                </label>
                <select
                  id="role" name="role"
                  value={form.role} onChange={handleChange}
                  disabled={isSaving} className={fieldCls}
                >
                  <option value="">— Select a role —</option>
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="branch">
                  Department
                </label>
                <select
                  id="branch" name="branch"
                  value={form.branch} onChange={handleChange}
                  disabled={isSaving} className={fieldCls}
                >
                  <option value="">— Select a department —</option>
                  {BRANCH_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Employee Number */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="employeeNumber">
                  Employee Number
                </label>
                <input
                  id="employeeNumber" name="employeeNumber" type="text"
                  value={form.employeeNumber} onChange={handleChange}
                  placeholder="e.g. EMP-001"
                  disabled={isSaving} className={fieldCls}
                />
              </div>

              {/* Pay Frequency */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="payFrequency">
                  Pay Frequency
                </label>
                <select
                  id="payFrequency" name="payFrequency"
                  value={form.payFrequency} onChange={handleChange}
                  disabled={isSaving} className={fieldCls}
                >
                  <option value="">— Select pay frequency —</option>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>

              {/* ── Feedback banner ── */}
              {message && (
                <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium ${
                  isError
                    ? "bg-red-50 text-red-700 border border-red-100"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                }`}>
                  {isError ? (
                    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span>{message}</span>
                </div>
              )}

              {/* Save button */}
              <button
                type="submit" disabled={isSaving}
                className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-95
                           disabled:opacity-60 disabled:cursor-not-allowed
                           text-white font-semibold text-base rounded-xl py-3.5
                           transition-all duration-150 shadow-sm"
              >
                {isSaving ? "Saving…" : "Save Changes"}
              </button>

              <Link
                href="/manager/staff"
                className="block text-center text-sm text-stone-400 hover:text-stone-600 transition-colors py-1"
              >
                ← Back to Staff List
              </Link>

            </form>
          </section>
        )}

      </main>
    </div>
  );
}
