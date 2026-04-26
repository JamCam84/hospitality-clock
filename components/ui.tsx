/**
 * components/ui.tsx
 *
 * Shared UI primitives used across the manager portal.
 *
 * ── Exports ──────────────────────────────────────────────────────────────────
 *   PageHeader      – Gradient top banner with title, subtitle, right action
 *   SummaryCard     – Metric card: label + big number + sub-label
 *   StatusBadge     – Pill badge for clock / approval status
 *   EmptyState      – Centred icon + message when a list is empty
 *   SectionCard     – White rounded card with optional header row
 */

import React from "react";

// ─── PageHeader ──────────────────────────────────────────────────────────────

type PageHeaderProps = {
  /** Main heading – white, bold */
  title: string;
  /** Smaller line below the title */
  subtitle?: string;
  /** Optional element rendered on the right (e.g. a Refresh button) */
  right?: React.ReactNode;
};

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <div className="bg-gradient-to-r from-green-500 to-emerald-400 rounded-b-3xl px-5 pt-10 pb-8">
      <div className="max-w-5xl mx-auto flex items-start justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-white/75 text-sm mt-1">{subtitle}</p>
          )}
        </div>
        {right && <div className="shrink-0 mt-1">{right}</div>}
      </div>
    </div>
  );
}

// ─── SummaryCard ─────────────────────────────────────────────────────────────

type SummaryCardProps = {
  label: string;
  value: React.ReactNode;
  sub?: string;
  /** Tailwind colour class for the value text, e.g. "text-emerald-600" */
  valueColor?: string;
  loading?: boolean;
};

export function SummaryCard({
  label,
  value,
  sub,
  valueColor = "text-gray-800",
  loading = false,
}: SummaryCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p
        className={`text-3xl font-bold ${
          loading ? "text-gray-200 animate-pulse" : valueColor
        }`}
      >
        {loading ? "—" : value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

type BadgeVariant =
  | "clocked-in"
  | "clocked-out"
  | "suspicious"
  | "approved"
  | "unapproved"
  | "edited"
  | "manual"
  | "neutral";

const BADGE_STYLES: Record<BadgeVariant, string> = {
  "clocked-in":  "bg-emerald-100 text-emerald-700",
  "clocked-out": "bg-gray-100   text-gray-500",
  suspicious:    "bg-amber-100  text-amber-700",
  approved:      "bg-green-100  text-green-700",
  unapproved:    "bg-gray-100   text-gray-500",
  edited:        "bg-sky-100    text-sky-700",
  manual:        "bg-violet-100 text-violet-700",
  neutral:       "bg-gray-100   text-gray-600",
};

type StatusBadgeProps = {
  variant: BadgeVariant;
  label: string;
  pulse?: boolean;
};

export function StatusBadge({ variant, label, pulse = false }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full ${BADGE_STYLES[variant]}`}
    >
      {pulse && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      )}
      {label}
    </span>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

type EmptyStateProps = {
  message: string;
  icon?: React.ReactNode;
};

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <div className="px-5 py-12 flex flex-col items-center gap-3 text-center">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-300">
          {icon}
        </div>
      )}
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

type SectionCardProps = {
  /** Optional header row content */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function SectionCard({ header, children, className = "" }: SectionCardProps) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${className}`}>
      {header && (
        <div className="px-5 py-4 border-b border-gray-50">{header}</div>
      )}
      {children}
    </div>
  );
}

// ─── RefreshButton ───────────────────────────────────────────────────────────

type RefreshButtonProps = {
  onClick: () => void;
  loading?: boolean;
};

export function RefreshButton({ onClick, loading = false }: RefreshButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs font-semibold text-white/80
                 hover:text-white hover:bg-white/20 border border-white/30
                 rounded-xl px-3 py-2 transition-all duration-150 disabled:opacity-50"
    >
      <svg
        className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0
             0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Refresh
    </button>
  );
}
