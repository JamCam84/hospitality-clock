"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { APP_VERSION } from "@/lib/version";

// ─── Dimensions ───────────────────────────────────────────────────────────────

const EXPANDED_W  = 260; // px  — desktop expanded
const COLLAPSED_W = 72;  // px  — desktop icon-only
const LS_KEY      = "hc-sidebar-collapsed";

// ─── Nav groups ───────────────────────────────────────────────────────────────

type NavItem = { href: string; label: string; icon: React.ReactNode };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Main",
    items: [
      {
        href: "/manager/dashboard",
        label: "Dashboard",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10
                 a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4
                 a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        href: "/manager/staff",
        label: "Staff",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M17 20H7a4 4 0 014-4h2a4 4 0 014 4zM12 12a4 4 0 100-8 4 4 0 000 8z" />
          </svg>
        ),
      },
      {
        href: "/manager/users",
        label: "Users",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955
                 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29
                 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        ),
      },
      {
        href: "/manager/onboarding-links",
        label: "Onboarding",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0z
                 M3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Time",
    items: [
      {
        href: "/manager/clock-links",
        label: "Clock Links",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5
                 m4.5-4.5l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
          </svg>
        ),
      },
      {
        href: "/manager/attendance",
        label: "Attendance",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
                 M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        ),
      },
      {
        href: "/manager/calendar-times",
        label: "Timesheet",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5
                 a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        href: "/manager/approval",
        label: "Approval",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        href: "/manager/payroll-runs",
        label: "Pay Runs",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
                 M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l2 2 4-4" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Payroll",
    items: [
      {
        href: "/manager/payroll-report",
        label: "Payroll Report",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01
                 M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14
                 a2 2 0 002 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Location",
    items: [
      {
        href: "/manager/location-view",
        label: "Locations",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243
                 a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        href: "/manager/settings",
        label: "Settings",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
            strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0
                 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0
                 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0
                 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0
                 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0
                 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0
                 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0
                 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07
                 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
];

// ─── Shared nav link (used in both desktop and mobile) ────────────────────────

function NavLink({
  href,
  label,
  icon,
  isActive,
  collapsed,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 rounded-xl text-sm font-medium
                  transition-all duration-150 group relative
                  ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"}
                  ${isActive
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                  }`}
    >
      <span className={isActive ? "text-emerald-600" : "text-stone-400 group-hover:text-stone-600"}>
        {icon}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

// ─── Current user section ─────────────────────────────────────────────────────

function UserSection({ collapsed }: { collapsed: boolean }) {
  const { currentUser, isLoading } = useCurrentUser();
  if (isLoading) return null;

  const avatarBg = currentUser?.role === "Admin"   ? "bg-purple-100 text-purple-700"
                 : currentUser?.role === "Payroll" ? "bg-blue-100 text-blue-700"
                 : "bg-emerald-100 text-emerald-700";

  const initial = currentUser
    ? currentUser.full_name.charAt(0).toUpperCase()
    : "?";

  return (
    <Link
      href="/manager/users"
      title={collapsed ? (currentUser?.full_name ?? "Manage users") : undefined}
      className={`flex items-center rounded-xl transition-colors duration-150
                  hover:bg-stone-100 group
                  ${collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2.5"}`}
    >
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center
                       text-xs font-bold shrink-0 ${avatarBg}`}>
        {initial}
      </div>

      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-stone-700 truncate leading-tight">
            {currentUser?.full_name ?? "No user set"}
          </p>
          <p className="text-xs text-stone-400 truncate leading-tight">
            {currentUser?.role ?? "Click to select user"}
          </p>
        </div>
      )}
    </Link>
  );
}

// ─── Sidebar inner content (shared between desktop + mobile drawer) ───────────

function SidebarContent({
  collapsed,
  onNavClick,
}: {
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">

      {/* Scrollable nav area */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {/* Section label — hidden when collapsed */}
            {!collapsed && (
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest
                            px-3 pb-1.5">
                {group.label}
              </p>
            )}
            {/* Divider when collapsed (visual separator between groups) */}
            {collapsed && (
              <div className="border-t border-stone-100 mx-2 mb-2" />
            )}

            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  label={label}
                  icon={icon}
                  isActive={pathname.startsWith(href)}
                  collapsed={collapsed}
                  onClick={onNavClick}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: user + version */}
      <div className="border-t border-stone-100 px-3 py-3 space-y-1">
        <UserSection collapsed={collapsed} />
        {!collapsed && (
          <p className="text-[10px] text-stone-300 px-3 pt-1 select-none">
            v{APP_VERSION}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ManagerSidebar() {
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [mounted,     setMounted]     = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Read persisted collapsed state after mount (avoids SSR mismatch)
  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(LS_KEY) === "true") setCollapsed(true);
    } catch {
      // localStorage unavailable (SSR / private browsing) — use default
    }
  }, []);

  // Close mobile drawer when focus moves outside it
  useEffect(() => {
    if (!mobileOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(LS_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // ── Desktop sidebar ─────────────────────────────────────────────────────────
  const desktopWidth = !mounted ? EXPANDED_W : collapsed ? COLLAPSED_W : EXPANDED_W;

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════
          DESKTOP SIDEBAR
          Hidden on mobile (md:flex). Sticky so it stays on screen while
          the main content area scrolls.
         ════════════════════════════════════════════════════════════════════ */}
      <aside
        style={{ width: desktopWidth }}
        className="hidden md:flex flex-col h-screen sticky top-0 shrink-0
                   bg-white border-r border-stone-200
                   transition-[width] duration-200 ease-in-out overflow-hidden"
      >
        {/* ── Sidebar header ── */}
        <div className={`flex items-center border-b border-stone-100 px-3 py-4 shrink-0
                         ${collapsed ? "justify-center" : "justify-between gap-2"}`}>
          {/* Logo + app name */}
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? "" : "flex-1"}`}>
            {/* Clock icon mark */}
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center
                            justify-center shrink-0 shadow-sm">
              <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor"
                strokeWidth={2.25} viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
              </svg>
            </div>
            {!collapsed && (
              <span className="font-bold text-stone-800 text-sm leading-tight truncate">
                Hospitality Clock
              </span>
            )}
          </div>

          {/* Collapse toggle */}
          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              title="Collapse sidebar"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400
                         hover:bg-stone-100 hover:text-stone-600 transition-colors shrink-0"
            >
              {/* ChevronLeft */}
              <svg className="w-4 h-4" fill="none" stroke="currentColor"
                strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="flex justify-center px-2 pt-2 shrink-0">
            <button
              onClick={toggleCollapsed}
              title="Expand sidebar"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400
                         hover:bg-stone-100 hover:text-stone-600 transition-colors"
            >
              {/* ChevronRight */}
              <svg className="w-4 h-4" fill="none" stroke="currentColor"
                strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* Nav + user footer */}
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* ════════════════════════════════════════════════════════════════════
          MOBILE: Fixed top bar
          Visible only on small screens (md:hidden). Provides a hamburger
          button and app name so users can open the drawer.
         ════════════════════════════════════════════════════════════════════ */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30
                      bg-white border-b border-stone-200
                      flex items-center gap-3 px-4 py-3 shadow-sm">
        {/* Hamburger */}
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          className="w-9 h-9 flex items-center justify-center rounded-xl text-stone-500
                     hover:bg-stone-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor"
            strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* App name */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center">
            <svg className="text-white" fill="none" stroke="currentColor"
              strokeWidth={2.5} viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
            </svg>
          </div>
          <span className="font-bold text-stone-800 text-sm">Hospitality Clock</span>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          MOBILE: Slide-out drawer
          Covers the screen with a backdrop; the drawer slides in from left.
         ════════════════════════════════════════════════════════════════════ */}
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => setMobileOpen(false)}
        className={`md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm
                    transition-opacity duration-200
                    ${mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={`md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 bg-white shadow-2xl
                    flex flex-col transition-transform duration-250 ease-in-out
                    ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-sm">
              <svg className="text-white" fill="none" stroke="currentColor"
                strokeWidth={2.25} viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
              </svg>
            </div>
            <span className="font-bold text-stone-800 text-sm">Hospitality Clock</span>
          </div>
          {/* Close button */}
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="w-8 h-8 flex items-center justify-center rounded-xl text-stone-400
                       hover:bg-stone-100 hover:text-stone-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor"
              strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Drawer nav content */}
        <div className="flex-1 overflow-hidden">
          <SidebarContent collapsed={false} onNavClick={() => setMobileOpen(false)} />
        </div>
      </div>
    </>
  );
}
