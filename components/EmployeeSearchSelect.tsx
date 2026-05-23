"use client";

/**
 * components/EmployeeSearchSelect.tsx
 *
 * A searchable employee picker for manager forms.
 *
 * Usage:
 *   <EmployeeSearchSelect
 *     employees={staffList}
 *     selectedEmployeeId={manualStaffId}
 *     onSelect={setManualStaffId}
 *     label="Employee *"
 *     placeholder="Search by name, number, role…"
 *   />
 */

import { useState, useRef, useEffect } from "react";
import { formatEmployeeNumber } from "@/lib/time-calc";

// ─── Employee shape this component expects ────────────────────────────────────
// All string fields are nullable so the component handles incomplete records
// gracefully without crashing.
export type EmployeeOption = {
  id: string;
  employee_number: string | null;
  first_name: string | null;
  last_name: string | null;
  pay_frequency: string | null;
  role: string | null;
  branch: string | null;
};

// ─── Props ────────────────────────────────────────────────────────────────────
type Props = {
  employees: EmployeeOption[];
  selectedEmployeeId: string;
  onSelect: (id: string) => void;
  label?: string;
  placeholder?: string;
};

// ─── Shared input style ───────────────────────────────────────────────────────
const inputCls =
  "w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm text-stone-800 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent " +
  "transition placeholder:text-stone-400";

// ─── Component ────────────────────────────────────────────────────────────────
export default function EmployeeSearchSelect({
  employees,
  selectedEmployeeId,
  onSelect,
  label = "Employee",
  placeholder = "Search by name, number, role or department…",
}: Props) {
  const [query, setQuery]   = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef        = useRef<HTMLDivElement>(null);

  // ── Find the currently selected employee ────────────────────────────────────
  const selected = employees.find((e) => e.id === selectedEmployeeId) ?? null;

  // ── Filter employees based on the search query ───────────────────────────────
  // Matches against: first_name, last_name, employee_number, role, branch
  const filtered = query.trim()
    ? employees.filter((e) => {
        const q = query.toLowerCase();
        return [
          e.first_name    ?? "",
          e.last_name     ?? "",
          e.employee_number ?? "",
          e.role          ?? "",
          e.branch        ?? "",
        ].some((field) => field.toLowerCase().includes(q));
      })
    : employees; // show all when query is empty

  // ── Close dropdown when clicking outside the component ───────────────────────
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleSelect(employee: EmployeeOption) {
    onSelect(employee.id);
    setQuery("");
    setIsOpen(false);
  }

  function handleClear() {
    onSelect("");
    setQuery("");
    setIsOpen(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setIsOpen(true);
  }

  function handleInputFocus() {
    setIsOpen(true);
  }

  // ── Helper: display a single employee's name line ────────────────────────────
  function displayName(e: EmployeeOption) {
    const num  = e.employee_number ? `${formatEmployeeNumber(e.employee_number)} — ` : "";
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ") || "Unnamed";
    return `${num}${name}`;
  }

  // ── Helper: display role + branch sub-line ───────────────────────────────────
  function displayMeta(e: EmployeeOption) {
    return [e.role, e.branch].filter(Boolean).join(" · ") || "—";
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">

      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-stone-700 mb-1">
          {label}
        </label>
      )}

      {/* ── Selected state: show a summary chip instead of the text input ── */}
      {selected && !isOpen ? (
        <div
          className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50
                     px-3 py-2.5 cursor-pointer"
          onClick={() => setIsOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setIsOpen(true)}
          aria-label="Change selected employee"
        >
          {/* Avatar initials */}
          <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-200 flex items-center justify-center">
            <span className="text-xs font-bold text-emerald-800">
              {(selected.first_name?.[0] ?? "").toUpperCase()}
              {(selected.last_name?.[0]  ?? "").toUpperCase()}
            </span>
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-stone-800 truncate leading-tight">
              {displayName(selected)}
            </p>
            <p className="text-xs text-stone-500 truncate mt-0.5">
              {displayMeta(selected)}
            </p>
          </div>

          {/* Tap to change hint */}
          <span className="text-xs text-emerald-600 font-medium shrink-0 hidden sm:block">
            Change
          </span>

          {/* Clear ×  */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full
                       text-stone-400 hover:bg-red-100 hover:text-red-500 transition-colors"
            aria-label="Clear selection"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}
              viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

      ) : (

        /* ── Search input (shown when no selection, or when reopening) ── */
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          className={inputCls}
          autoComplete="off"
          aria-label={label}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          role="combobox"
        />
      )}

      {/* ── Dropdown list ── */}
      {isOpen && (
        <div
          className="absolute z-50 mt-1 w-full bg-white rounded-xl border border-stone-200
                     shadow-xl overflow-hidden"
          role="listbox"
        >
          {/* Search input inside dropdown (when reopening from selected state) */}
          {selected && isOpen && (
            <div className="px-3 pt-3 pb-2 border-b border-stone-100">
              <input
                type="text"
                value={query}
                onChange={handleInputChange}
                placeholder={placeholder}
                className={inputCls + " text-xs"}
                autoFocus
                aria-label="Search employees"
              />
            </div>
          )}

          {/* Result count hint */}
          {query.trim() && (
            <p className="px-4 pt-2 pb-1 text-xs text-stone-400">
              {filtered.length === 0
                ? "No results"
                : `${filtered.length} employee${filtered.length === 1 ? "" : "s"} found`}
            </p>
          )}

          {/* Employee list */}
          {filtered.length === 0 ? (
            <div className="px-4 py-4 text-sm text-stone-400 text-center">
              No employees match your search.
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-stone-50" role="group">
              {filtered.map((employee) => {
                const isSelected = employee.id === selectedEmployeeId;
                return (
                  <li key={employee.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => handleSelect(employee)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors
                        ${isSelected
                          ? "bg-emerald-50 hover:bg-emerald-100"
                          : "hover:bg-stone-50"}`}
                    >
                      {/* Avatar initials */}
                      <div
                        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                          ${isSelected ? "bg-emerald-200" : "bg-stone-100"}`}
                      >
                        <span className={`text-xs font-bold
                          ${isSelected ? "text-emerald-800" : "text-stone-500"}`}>
                          {(employee.first_name?.[0] ?? "").toUpperCase()}
                          {(employee.last_name?.[0]  ?? "").toUpperCase()}
                        </span>
                      </div>

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        {/* Primary line: employee_number — first last */}
                        <p className="text-sm font-semibold text-stone-800 truncate leading-tight">
                          {displayName(employee)}
                        </p>
                        {/* Secondary line: role · branch */}
                        <p className="text-xs text-stone-500 truncate mt-0.5">
                          {displayMeta(employee)}
                        </p>
                      </div>

                      {/* Checkmark for already-selected */}
                      {isSelected && (
                        <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none"
                          stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

    </div>
  );
}
