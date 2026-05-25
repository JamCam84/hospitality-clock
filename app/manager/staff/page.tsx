"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import { formatEmployeeNumber } from "@/lib/time-calc";
import { PageHeader, SectionCard } from "@/components/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkArea = {
  id: string;
  name: string;
  description: string | null;
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
};

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
  // Location & work area (migration-added — may be null)
  home_latitude: number | null;
  home_longitude: number | null;
  expected_work_area_id: string | null;
};

// Blank form — shared reset shape for both Add and Edit forms.
// New location fields are empty strings; they're optional in both forms.
const emptyForm = {
  firstName:      "",
  lastName:       "",
  phone:          "",
  role:           "",
  branch:         "",
  employeeNumber: "",
  payFrequency:   "",
  // Location & work area
  homeLatitude:   "",
  homeLongitude:  "",
  workAreaId:     "",
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

// ─── Role / department options ─────────────────────────────────────────────────

const ROLE_OPTIONS = [
  "Waiter", "Waitress", "Bartender", "Barista", "Host", "Hostess",
  "Manager", "Chef", "Sous Chef", "Kitchen Staff", "Cashier",
  "Cleaner", "Security", "Driver", "General Worker",
];

const BRANCH_OPTIONS = [
  "The Nut Farm", "Main Venue", "Restaurant", "Events", "Kitchen",
];

// ─── Section divider inside the edit drawer ───────────────────────────────────

function DrawerSection({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
        {title}
      </p>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffPage() {

  // ── Work areas ───────────────────────────────────────────────────────────────
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([]);

  // ── Add-staff form ──────────────────────────────────────────────────────────
  const [addForm, setAddForm]       = useState(emptyForm);
  const [isAdding, setIsAdding]     = useState(false);
  const [addMessage, setAddMessage] = useState("");
  const [addIsError, setAddIsError] = useState(false);

  // ── Staff list ──────────────────────────────────────────────────────────────
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Edit drawer ─────────────────────────────────────────────────────────────
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [editForm, setEditForm]           = useState(emptyForm);
  const [isSaving, setIsSaving]           = useState(false);
  const [editMessage, setEditMessage]     = useState("");
  const [editIsError, setEditIsError]     = useState(false);

  // ─── Fetch staff + work areas on mount ────────────────────────────────────
  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setIsLoading(true);

    const [staffResult, areasResult] = await Promise.all([
      supabase
        .from("staff")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("work_areas")
        .select("id, name, description, center_latitude, center_longitude, radius_meters")
        .order("name", { ascending: true }),
    ]);

    if (staffResult.error) {
      setAddMessage("Could not load staff. Please refresh and try again.");
      setAddIsError(true);
    } else {
      setStaffList((staffResult.data ?? []) as unknown as StaffMember[]);
    }

    setWorkAreas((areasResult.data ?? []) as WorkArea[]);
    setIsLoading(false);
  }

  // ─── Build lookup maps ────────────────────────────────────────────────────
  const workAreaById: Record<string, WorkArea> = {};
  for (const wa of workAreas) workAreaById[wa.id] = wa;

  // ─── Add-form handlers ────────────────────────────────────────────────────

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
      setStaffList((prev) => [data as unknown as StaffMember, ...prev]);
      setAddMessage("Staff member added successfully!");
      setAddIsError(false);
      setAddForm(emptyForm);
    }

    setIsAdding(false);
  }

  // ─── Edit-drawer handlers ─────────────────────────────────────────────────

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
      // Location & work area — convert numbers to strings for the input
      homeLatitude:   staff.home_latitude  != null ? String(staff.home_latitude)  : "",
      homeLongitude:  staff.home_longitude != null ? String(staff.home_longitude) : "",
      workAreaId:     staff.expected_work_area_id ?? "",
    });
    setEditMessage("");
    setEditIsError(false);
  }

  function handleCancelEdit() {
    setSelectedStaff(null);
    setEditMessage("");
  }

  function handleEditChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStaff) return;

    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      setEditMessage("First name and last name are required.");
      setEditIsError(true);
      return;
    }

    setIsSaving(true);
    setEditMessage("");

    // Parse lat/lng — keep as null if blank or invalid
    const parsedLat = editForm.homeLatitude.trim()
      ? parseFloat(editForm.homeLatitude.trim())
      : null;
    const parsedLng = editForm.homeLongitude.trim()
      ? parseFloat(editForm.homeLongitude.trim())
      : null;

    const payload = {
      first_name:             editForm.firstName.trim(),
      last_name:              editForm.lastName.trim(),
      full_name:              `${editForm.firstName.trim()} ${editForm.lastName.trim()}`,
      phone_number:           editForm.phone.trim(),
      role:                   editForm.role,
      branch:                 editForm.branch,
      employee_number:        editForm.employeeNumber.trim(),
      pay_frequency:          editForm.payFrequency,
      // Location & work area
      home_latitude:          parsedLat != null && !isNaN(parsedLat)  ? parsedLat  : null,
      home_longitude:         parsedLng != null && !isNaN(parsedLng)  ? parsedLng  : null,
      expected_work_area_id:  editForm.workAreaId || null,
    };

    console.log("[StaffEdit] Saving staff id:", selectedStaff.id);

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
          "Check that the anon role has UPDATE permission on the staff table " +
          "in Supabase → Authentication → Policies.";
      } else {
        friendlyMsg = `Error saving: ${updateError.message} (code: ${updateError.code})`;
      }

      setEditMessage(friendlyMsg);
      setEditIsError(true);
      setIsSaving(false);
      return;
    }

    if (!savedRow) {
      setEditMessage(
        "Save completed but the database returned no data. " +
        "Refresh the page to verify your changes were stored."
      );
      setEditIsError(true);
      setIsSaving(false);
      return;
    }

    setStaffList((prev) =>
      prev.map((s) =>
        s.id === selectedStaff.id ? (savedRow as unknown as StaffMember) : s
      )
    );

    setEditMessage("Changes saved successfully!");
    setEditIsError(false);
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5"
                  htmlFor="add-firstName">
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5"
                  htmlFor="add-lastName">
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
              <label className="block text-sm font-medium text-gray-700 mb-1.5"
                htmlFor="add-phone">Phone Number</label>
              <input
                id="add-phone" name="phone" type="text" inputMode="tel"
                value={addForm.phone} onChange={handleAddChange}
                placeholder="e.g. 082 555 1234" disabled={isAdding}
                className={inputCls}
              />
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"
                htmlFor="add-role">Role</label>
              <select id="add-role" name="role" value={addForm.role}
                onChange={handleAddChange} disabled={isAdding} className={selectCls}>
                <option value="">— Select a role —</option>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"
                htmlFor="add-branch">Department</label>
              <select id="add-branch" name="branch" value={addForm.branch}
                onChange={handleAddChange} disabled={isAdding} className={selectCls}>
                <option value="">— Select a department —</option>
                {BRANCH_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            {/* Employee Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"
                htmlFor="add-employeeNumber">Employee Number</label>
              <input
                id="add-employeeNumber" name="employeeNumber" type="text"
                value={addForm.employeeNumber} onChange={handleAddChange}
                placeholder="e.g. EMP-001" disabled={isAdding}
                className={inputCls}
              />
            </div>

            {/* Pay Frequency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"
                htmlFor="add-payFrequency">Pay Frequency</label>
              <select id="add-payFrequency" name="payFrequency"
                value={addForm.payFrequency}
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
              <div key={n}
                className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-4">
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
              {staffList.map((staff) => {
                const assignedArea = staff.expected_work_area_id
                  ? workAreaById[staff.expected_work_area_id]
                  : null;

                return (
                  <li
                    key={staff.id}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4
                               flex items-start gap-3"
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700
                                    flex items-center justify-center text-base font-bold
                                    shrink-0 mt-0.5">
                      {staff.first_name.charAt(0).toUpperCase()}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <p className="font-semibold text-gray-800">
                          {staff.first_name} {staff.last_name}
                        </p>
                        {staff.employee_number && (
                          <span className="text-xs text-gray-400 font-mono">
                            #{formatEmployeeNumber(staff.employee_number)}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {staff.role && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                                           ${roleBadgeColor(staff.role)}`}>
                            {staff.role}
                          </span>
                        )}
                        {staff.branch && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full
                                           bg-gray-100 text-gray-600">
                            {staff.branch}
                          </span>
                        )}
                        {staff.pay_frequency && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full
                                           bg-gray-50 text-gray-500 capitalize">
                            {staff.pay_frequency}
                          </span>
                        )}
                        {/* Work area badge */}
                        {assignedArea ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium
                                           px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor"
                              strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827
                                   0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {assignedArea.name}
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full
                                           bg-stone-50 text-stone-400">
                            No area assigned
                          </span>
                        )}
                        {/* Home location indicator */}
                        {staff.home_latitude != null && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium
                                           px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor"
                              strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10
                                   a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4
                                   a1 1 0 001 1m-6 0h6" />
                            </svg>
                            Home set
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
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                          strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5
                               12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542
                               7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View
                      </Link>

                      <button
                        onClick={() => handleEditClick(staff)}
                        className="flex items-center justify-center gap-1 text-xs font-semibold
                                   text-gray-500 hover:text-green-700 hover:bg-green-50 active:scale-95
                                   border border-gray-200 hover:border-green-200
                                   rounded-xl px-3 py-1.5 transition-all duration-150"
                        aria-label={`Edit ${staff.first_name} ${staff.last_name}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                          strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                               m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                    </div>
                  </li>
                );
              })}
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

      {/* ══ Edit Drawer ══════════════════════════════════════════════════════
          Slides up from the bottom on mobile; centred modal on desktop.
          Includes the new Location & Work Area section.
      ═══════════════════════════════════════════════════════════════════════ */}
      {selectedStaff && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
            onClick={handleCancelEdit}
            aria-label="Close edit drawer"
          />

          {/* Drawer panel */}
          <div
            className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto
                       bg-white rounded-t-3xl shadow-2xl
                       sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                       sm:w-full sm:max-w-lg sm:rounded-2xl sm:max-h-[90vh]"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${selectedStaff.first_name} ${selectedStaff.last_name}`}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4
                            border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700
                                flex items-center justify-center text-sm font-bold shrink-0">
                  {selectedStaff.first_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800 leading-tight">
                    {selectedStaff.first_name} {selectedStaff.last_name}
                  </p>
                  <p className="text-xs text-gray-400">Edit details</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCancelEdit}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400
                           hover:bg-gray-100 hover:text-gray-700 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor"
                  strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Edit form */}
            <form onSubmit={handleSave} className="px-5 py-5 space-y-4">

              {/* ── Personal details ── */}
              <DrawerSection title="Personal details" />

              {/* First Name + Last Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="edit-firstName">
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <input id="edit-firstName" name="firstName" type="text"
                    value={editForm.firstName} onChange={handleEditChange}
                    required disabled={isSaving} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="edit-lastName">
                    Last Name <span className="text-red-400">*</span>
                  </label>
                  <input id="edit-lastName" name="lastName" type="text"
                    value={editForm.lastName} onChange={handleEditChange}
                    required disabled={isSaving} className={inputCls} />
                </div>
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"
                  htmlFor="edit-phone">Phone Number</label>
                <input id="edit-phone" name="phone" type="text" inputMode="tel"
                  value={editForm.phone} onChange={handleEditChange}
                  placeholder="e.g. 082 555 1234"
                  disabled={isSaving} className={inputCls} />
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"
                  htmlFor="edit-role">Role</label>
                <select id="edit-role" name="role" value={editForm.role}
                  onChange={handleEditChange} disabled={isSaving} className={selectCls}>
                  <option value="">— Select a role —</option>
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"
                  htmlFor="edit-branch">Department</label>
                <select id="edit-branch" name="branch" value={editForm.branch}
                  onChange={handleEditChange} disabled={isSaving} className={selectCls}>
                  <option value="">— Select a department —</option>
                  {BRANCH_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Employee Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"
                  htmlFor="edit-employeeNumber">Employee Number</label>
                <input id="edit-employeeNumber" name="employeeNumber" type="text"
                  value={editForm.employeeNumber} onChange={handleEditChange}
                  placeholder="e.g. EMP-001"
                  disabled={isSaving} className={inputCls} />
              </div>

              {/* Pay Frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"
                  htmlFor="edit-payFrequency">Pay Frequency</label>
                <select id="edit-payFrequency" name="payFrequency"
                  value={editForm.payFrequency}
                  onChange={handleEditChange} disabled={isSaving} className={selectCls}>
                  <option value="">— Select pay frequency —</option>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>

              {/* ── Work area ── */}
              <DrawerSection title="Work area" />

              {/* Expected work area */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"
                  htmlFor="edit-workAreaId">
                  Assigned Work Area / Geofence
                </label>
                <select
                  id="edit-workAreaId"
                  name="workAreaId"
                  value={editForm.workAreaId}
                  onChange={handleEditChange}
                  disabled={isSaving}
                  className={selectCls}
                >
                  <option value="">— No area assigned —</option>
                  {workAreas.map((wa) => (
                    <option key={wa.id} value={wa.id}>
                      {wa.name}
                      {wa.description ? ` — ${wa.description}` : ""}
                      {` (±${wa.radius_meters}m)`}
                    </option>
                  ))}
                </select>
                {workAreas.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    No work areas found. Run the SQL migration and add at least one
                    area in the <strong>work_areas</strong> table.
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                  When assigned, clock-in locations are compared against this area
                  and flagged on the Location View page.
                </p>
              </div>

              {/* ── Home location ── */}
              <DrawerSection title="Home location" />

              <p className="text-xs text-gray-400 -mt-1 leading-relaxed">
                Optional. Used for reference only — not compared against geofences.
                Paste coordinates from Google Maps (right-click → &ldquo;What&apos;s here?&rdquo;).
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="edit-homeLatitude">Latitude</label>
                  <input
                    id="edit-homeLatitude"
                    name="homeLatitude"
                    type="number"
                    step="any"
                    value={editForm.homeLatitude}
                    onChange={handleEditChange}
                    placeholder="-33.9756"
                    disabled={isSaving}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="edit-homeLongitude">Longitude</label>
                  <input
                    id="edit-homeLongitude"
                    name="homeLongitude"
                    type="number"
                    step="any"
                    value={editForm.homeLongitude}
                    onChange={handleEditChange}
                    placeholder="18.8257"
                    disabled={isSaving}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Show Google Maps link if home coords already saved */}
              {selectedStaff.home_latitude != null &&
               selectedStaff.home_longitude != null && (
                <a
                  href={`https://www.google.com/maps?q=${selectedStaff.home_latitude},${selectedStaff.home_longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold
                             text-sky-600 hover:text-sky-800 hover:underline"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                    strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4
                         M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View current home location in Google Maps
                </a>
              )}

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

              {/* Action buttons */}
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
