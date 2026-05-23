"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import { formatEmployeeNumber } from "@/lib/time-calc";
import { PageHeader, SectionCard } from "@/components/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  role: string;
  branch: string;
  employee_number: string;
  pay_frequency: string;
  created_at: string;
};

// Shared shape for both the Add form and the Edit form.
const emptyForm = {
  firstName:      "",
  lastName:       "",
  phone:          "",
  role:           "",
  branch:         "",
  employeeNumber: "",
  payFrequency:   "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roleBadgeColor(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("manager")) return "bg-amber-100 text-amber-800";
  if (r.includes("chef"))    return "bg-orange-100 text-orange-800";
  if (r.includes("bar"))     return "bg-purple-100 text-purple-800";
  if (r.includes("wait"))    return "bg-sky-100 text-sky-800";
  if (r.includes("host"))    return "bg-pink-100 text-pink-800";
  if (r.includes("kitchen")) return "bg-orange-50 text-orange-700";
  if (r.includes("clean"))   return "bg-teal-100 text-teal-800";
  return "bg-gray-100 text-gray-700";
}

// ─── Shared input / select styles ─────────────────────────────────────────────

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-800 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 " +
  "focus:border-transparent transition disabled:opacity-50";

const selectCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-800 " +
  "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent " +
  "transition disabled:opacity-50";

// ─── Reusable role / department options ───────────────────────────────────────
// Defined once and shared between the Add and Edit forms.

const ROLE_OPTIONS = [
  "Waiter", "Waitress", "Bartender", "Barista", "Host", "Hostess",
  "Manager", "Chef", "Sous Chef", "Kitchen Staff", "Cashier",
  "Cleaner", "Security", "Driver", "General Worker",
];

const BRANCH_OPTIONS = [
  "The Nut Farm", "Main Venue", "Restaurant", "Events", "Kitchen",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffPage() {

  // ── Add-staff form ──────────────────────────────────────────────────────────
  const [addForm, setAddForm]   = useState(emptyForm);
  const [isAdding, setIsAdding] = useState(false);
  const [addMessage, setAddMessage] = useState("");
  const [addIsError, setAddIsError] = useState(false);

  // ── Staff list ──────────────────────────────────────────────────────────────
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Edit drawer ─────────────────────────────────────────────────────────────
  // selectedStaff holds the staff member currently being edited.
  // null means the drawer is closed.
  const [selectedStaff, setSelectedStaff]   = useState<StaffMember | null>(null);
  const [editForm, setEditForm]             = useState(emptyForm);
  const [isSaving, setIsSaving]             = useState(false);
  const [editMessage, setEditMessage]       = useState("");
  const [editIsError, setEditIsError]       = useState(false);

  // ─── Fetch all staff on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetchStaff();
  }, []);

  async function fetchStaff() {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("staff")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setAddMessage("Could not load staff. Please refresh and try again.");
      setAddIsError(true);
    } else {
      setStaffList((data ?? []) as StaffMember[]);
    }
    setIsLoading(false);
  }

  // ─── Add-form handlers ─────────────────────────────────────────────────────

  function handleAddChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setAddForm({ ...addForm, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.firstName.trim() || !addForm.lastName.trim()) return;

    setIsAdding(true);
    setAddMessage("");

    const { data, error } = await supabase
      .from("staff")
      .insert([
        {
          first_name:      addForm.firstName.trim(),
          last_name:       addForm.lastName.trim(),
          full_name:       `${addForm.firstName.trim()} ${addForm.lastName.trim()}`,
          phone_number:    addForm.phone.trim(),
          role:            addForm.role,
          branch:          addForm.branch,
          employee_number: addForm.employeeNumber.trim(),
          pay_frequency:   addForm.payFrequency,
        },
      ])
      .select()
      .single();

    if (error) {
      setAddMessage("Error adding staff: " + error.message);
      setAddIsError(true);
    } else {
      // Prepend the new member to the list so they appear at the top
      setStaffList((prev) => [data as StaffMember, ...prev]);
      setAddMessage("Staff member added successfully!");
      setAddIsError(false);
      setAddForm(emptyForm);
    }

    setIsAdding(false);
  }

  // ─── Edit-drawer handlers ──────────────────────────────────────────────────

  // Opens the edit drawer and pre-fills the form with the selected staff's data.
  function handleEditClick(staff: StaffMember) {
    setSelectedStaff(staff);
    setEditForm({
      firstName:      staff.first_name      ?? "",
      lastName:       staff.last_name       ?? "",
      phone:          staff.phone_number    ?? "",
      role:           staff.role            ?? "",
      branch:         staff.branch          ?? "",
      employeeNumber: staff.employee_number ?? "",
      payFrequency:   staff.pay_frequency   ?? "",
    });
    setEditMessage("");
    setEditIsError(false);
  }

  // Closes the drawer without saving.
  function handleCancelEdit() {
    setSelectedStaff(null);
    setEditMessage("");
  }

  // Handles changes inside the edit form.
  function handleEditChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  }

  // Saves the edited staff member back to Supabase and updates local state.
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    // selectedStaff should always be set here, but guard just in case
    if (!selectedStaff) return;

    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      setEditMessage("First name and last name are required.");
      setEditIsError(true);
      return;
    }

    setIsSaving(true);
    setEditMessage("");

    const payload = {
      first_name:      editForm.firstName.trim(),
      last_name:       editForm.lastName.trim(),
      full_name:       `${editForm.firstName.trim()} ${editForm.lastName.trim()}`,
      phone_number:    editForm.phone.trim(),
      role:            editForm.role,
      branch:          editForm.branch,
      employee_number: editForm.employeeNumber.trim(),
      pay_frequency:   editForm.payFrequency,
    };

    console.log("[StaffEdit] Saving staff id:", selectedStaff.id);
    console.log("[StaffEdit] Update payload:", payload);

    // Atomic update: .select("*").single() forces Supabase to return the updated
    // row. If RLS silently blocks the write (0 rows affected), Supabase surfaces a
    // real PGRST116 error instead of returning { error: null, data: null }.
    const { data: savedRow, error: updateError } = await supabase
      .from("staff")
      .update(payload)
      .eq("id", selectedStaff.id)
      .select("*")
      .single();

    if (updateError) {
      console.error("[StaffEdit] Update failed:", updateError);

      let friendlyMsg: string;
      if (updateError.code === "PGRST116") {
        friendlyMsg =
          "Save was blocked — the database rejected the update. " +
          "This is usually an RLS (Row Level Security) policy on the staff table. " +
          "Open Supabase dashboard → Authentication → Policies and ensure the " +
          "anon role has UPDATE permission on the staff table.";
      } else {
        friendlyMsg = `Error saving: ${updateError.message} (code: ${updateError.code})`;
      }

      setEditMessage(friendlyMsg);
      setEditIsError(true);
      setIsSaving(false);
      return;
    }

    if (!savedRow) {
      console.warn("[StaffEdit] Update returned no data and no error.");
      setEditMessage(
        "Save completed but the database returned no data. " +
        "Refresh the page to check whether your changes were stored."
      );
      setEditIsError(true);
      setIsSaving(false);
      return;
    }

    // ── Success: update the list from what Supabase actually stored ─────────
    console.log("[StaffEdit] Save successful. Saved row:", savedRow);

    setStaffList((prev) =>
      prev.map((s) => (s.id === selectedStaff.id ? (savedRow as StaffMember) : s))
    );

    setEditMessage("Changes saved successfully!");
    setEditIsError(false);

    // Auto-close the drawer after 1.5 s so the manager sees the success message
    setTimeout(() => setSelectedStaff(null), 1500);

    setIsSaving(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      <PageHeader title="Staff" subtitle="Add and manage your team" />
      <ManagerNav />

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* ══ Add Staff form ══════════════════════════════════════════════════ */}
        <SectionCard
          header={
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Add New Team Member</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Fill in the details below to register a new team member.
              </p>
            </div>
          }
        >
          <form onSubmit={handleSubmit} className="p-5 space-y-4">

            {/* First Name + Last Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="add-firstName">
                  First Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="add-firstName" name="firstName" type="text"
                  value={addForm.firstName} onChange={handleAddChange}
                  placeholder="e.g. Sipho" required disabled={isAdding}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="add-lastName">
                  Last Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="add-lastName" name="lastName" type="text"
                  value={addForm.lastName} onChange={handleAddChange}
                  placeholder="e.g. Nkosi" required disabled={isAdding}
                  className={inputCls}
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="add-phone">
                Phone Number
              </label>
              <input
                id="add-phone" name="phone" type="text" inputMode="tel"
                value={addForm.phone} onChange={handleAddChange}
                placeholder="e.g. 082 555 1234" disabled={isAdding}
                className={inputCls}
              />
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="add-role">
                Role
              </label>
              <select id="add-role" name="role" value={addForm.role}
                onChange={handleAddChange} disabled={isAdding} className={selectCls}>
                <option value="">— Select a role —</option>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="add-branch">
                Department
              </label>
              <select id="add-branch" name="branch" value={addForm.branch}
                onChange={handleAddChange} disabled={isAdding} className={selectCls}>
                <option value="">— Select a department —</option>
                {BRANCH_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            {/* Employee Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="add-employeeNumber">
                Employee Number
              </label>
              <input
                id="add-employeeNumber" name="employeeNumber" type="text"
                value={addForm.employeeNumber} onChange={handleAddChange}
                placeholder="e.g. EMP-001" disabled={isAdding}
                className={inputCls}
              />
            </div>

            {/* Pay Frequency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="add-payFrequency">
                Pay Frequency
              </label>
              <select id="add-payFrequency" name="payFrequency" value={addForm.payFrequency}
                onChange={handleAddChange} disabled={isAdding} className={selectCls}>
                <option value="">— Select pay frequency —</option>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>

            {/* Feedback */}
            {addMessage && (
              <p className={`text-sm font-medium rounded-xl px-4 py-3 ${
                addIsError ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
              }`}>
                {addMessage}
              </p>
            )}

            <button
              type="submit" disabled={isAdding}
              className="w-full bg-green-500 hover:bg-green-600 active:scale-95
                         disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold
                         text-base rounded-xl py-3.5 mt-2 transition-all duration-150 shadow-sm"
            >
              {isAdding ? "Saving…" : "Add Staff Member"}
            </button>

          </form>
        </SectionCard>

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-32" />
                  <div className="h-3 bg-gray-100 rounded w-48" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ Staff list ══════════════════════════════════════════════════════ */}
        {!isLoading && staffList.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
              Team Members — {staffList.length}
            </h2>

            <ul className="space-y-3">
              {staffList.map((staff) => (
                <li
                  key={staff.id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4
                             flex items-start gap-3"
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center
                                  justify-center text-base font-bold shrink-0 mt-0.5">
                    {staff.first_name.charAt(0).toUpperCase()}
                  </div>

                  {/* Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="font-semibold text-gray-800">
                        {staff.first_name} {staff.last_name}
                      </p>
                      {staff.employee_number && (
                        <span className="text-xs text-gray-400 font-mono">#{formatEmployeeNumber(staff.employee_number)}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {staff.role && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleBadgeColor(staff.role)}`}>
                          {staff.role}
                        </span>
                      )}
                      {staff.branch && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {staff.branch}
                        </span>
                      )}
                      {staff.pay_frequency && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 capitalize">
                          {staff.pay_frequency}
                        </span>
                      )}
                    </div>
                    {staff.phone_number && (
                      <p className="text-xs text-gray-400 mt-1">{staff.phone_number}</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="shrink-0 flex flex-col gap-1.5 items-stretch">
                    <Link
                      href={`/manager/employees/${staff.id}`}
                      className="flex items-center justify-center gap-1 text-xs font-semibold
                                 text-sky-600 hover:text-sky-700 hover:bg-sky-50 active:scale-95
                                 border border-sky-200 hover:border-sky-300
                                 rounded-xl px-3 py-1.5 transition-all duration-150"
                      aria-label={`View ${staff.first_name} ${staff.last_name}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5
                             12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542
                             7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      View
                    </Link>

                    {/* Edit button — opens the inline edit drawer */}
                    <button
                      onClick={() => handleEditClick(staff)}
                      className="flex items-center justify-center gap-1 text-xs font-semibold
                                 text-gray-500 hover:text-green-700 hover:bg-green-50 active:scale-95
                                 border border-gray-200 hover:border-green-200
                                 rounded-xl px-3 py-1.5 transition-all duration-150"
                      aria-label={`Edit ${staff.first_name} ${staff.last_name}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                             m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </button>
                  </div>

                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Empty state ── */}
        {!isLoading && staffList.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-6">
            No staff added yet. Fill in the form above to get started.
          </p>
        )}

      </main>

      {/* ══ Edit Drawer (modal overlay) ══════════════════════════════════════
          Appears when the manager clicks "Edit" on a staff card.
          selectedStaff controls whether the drawer is visible.
      ═══════════════════════════════════════════════════════════════════════ */}
      {selectedStaff && (
        <>
          {/* ── Backdrop — clicking it closes the drawer ── */}
          <div
            className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
            onClick={handleCancelEdit}
            aria-label="Close edit drawer"
          />

          {/* ── Drawer panel ── */}
          <div
            className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto
                       bg-white rounded-t-3xl shadow-2xl
                       sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                       sm:w-full sm:max-w-lg sm:rounded-2xl sm:max-h-[90vh]"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${selectedStaff.first_name} ${selectedStaff.last_name}`}
          >
            {/* ── Drawer header ── */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center
                                justify-center text-sm font-bold shrink-0">
                  {selectedStaff.first_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800 leading-tight">
                    {selectedStaff.first_name} {selectedStaff.last_name}
                  </p>
                  <p className="text-xs text-gray-400">Edit details</p>
                </div>
              </div>

              {/* Close × */}
              <button
                type="button"
                onClick={handleCancelEdit}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400
                           hover:bg-gray-100 hover:text-gray-700 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ── Edit form ── */}
            <form onSubmit={handleSave} className="px-5 py-5 space-y-4">

              {/* First Name + Last Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-firstName">
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="edit-firstName"
                    name="firstName"
                    type="text"
                    value={editForm.firstName}
                    onChange={handleEditChange}
                    required
                    disabled={isSaving}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-lastName">
                    Last Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="edit-lastName"
                    name="lastName"
                    type="text"
                    value={editForm.lastName}
                    onChange={handleEditChange}
                    required
                    disabled={isSaving}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-phone">
                  Phone Number
                </label>
                <input
                  id="edit-phone"
                  name="phone"
                  type="text"
                  inputMode="tel"
                  value={editForm.phone}
                  onChange={handleEditChange}
                  placeholder="e.g. 082 555 1234"
                  disabled={isSaving}
                  className={inputCls}
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-role">
                  Role
                </label>
                <select
                  id="edit-role"
                  name="role"
                  value={editForm.role}
                  onChange={handleEditChange}
                  disabled={isSaving}
                  className={selectCls}
                >
                  <option value="">— Select a role —</option>
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-branch">
                  Department
                </label>
                <select
                  id="edit-branch"
                  name="branch"
                  value={editForm.branch}
                  onChange={handleEditChange}
                  disabled={isSaving}
                  className={selectCls}
                >
                  <option value="">— Select a department —</option>
                  {BRANCH_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Employee Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-employeeNumber">
                  Employee Number
                </label>
                <input
                  id="edit-employeeNumber"
                  name="employeeNumber"
                  type="text"
                  value={editForm.employeeNumber}
                  onChange={handleEditChange}
                  placeholder="e.g. EMP-001"
                  disabled={isSaving}
                  className={inputCls}
                />
              </div>

              {/* Pay Frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-payFrequency">
                  Pay Frequency
                </label>
                <select
                  id="edit-payFrequency"
                  name="payFrequency"
                  value={editForm.payFrequency}
                  onChange={handleEditChange}
                  disabled={isSaving}
                  className={selectCls}
                >
                  <option value="">— Select pay frequency —</option>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>

              {/* Feedback message */}
              {editMessage && (
                <p className={`text-sm font-medium rounded-xl px-4 py-3 ${
                  editIsError
                    ? "bg-red-50 text-red-600"
                    : "bg-emerald-50 text-emerald-700"
                }`}>
                  {editMessage}
                </p>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-1 pb-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95
                             disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold
                             text-sm rounded-xl py-3 transition-all duration-150 shadow-sm"
                >
                  {isSaving ? "Saving…" : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="px-5 rounded-xl border border-gray-200 text-sm font-semibold
                             text-gray-500 hover:bg-gray-50 active:scale-95 disabled:opacity-50
                             transition-all duration-150"
                >
                  Cancel
                </button>
              </div>

            </form>
          </div>
        </>
      )}

    </div>
  );
}
