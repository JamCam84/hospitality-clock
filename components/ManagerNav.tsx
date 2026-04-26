"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ─── Nav items ────────────────────────────────────────────────────────────────
// Add or remove pages here — the nav updates automatically.

const NAV_ITEMS = [
  {
    href:  "/manager/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3
             m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href:  "/manager/staff",
    label: "Staff",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17 20H7a4 4 0 014-4h2a4 4 0 014 4zM12 12a4 4 0 100-8 4 4 0 000 8z" />
      </svg>
    ),
  },
  {
    href:  "/manager/clock-links",
    label: "Clock Links",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5
             m4.5-4.5l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
      </svg>
    ),
  },
  {
    href:  "/manager/attendance",
    label: "Attendance",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
             M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2
             m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    href:  "/manager/payroll-report",
    label: "Payroll",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01
             M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href:  "/manager/calendar-times",
    label: "Timesheet",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5
             a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href:  "/manager/approval",
    label: "Approval",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href:  "/manager/onboarding-links",
    label: "Onboarding",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
  },
  {
    href:  "/manager/settings",
    label: "Settings",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94
             3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724
             1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426
             1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724
             1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31
             2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManagerNav() {
  // usePathname() returns the current URL path, e.g. "/manager/staff"
  // We use it to highlight whichever nav item matches the current page.
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-stone-200">
      <div className="max-w-5xl mx-auto px-4">

        {/*
          Horizontally scrollable on mobile so all tabs are reachable
          without wrapping onto two lines.
        */}
        <ul className="flex overflow-x-auto scrollbar-none gap-1 py-1">
          {NAV_ITEMS.map(({ href, label, icon }) => {
            // A link is "active" when the current path starts with its href.
            // startsWith handles sub-routes like /manager/staff/[id].
            const isActive = pathname.startsWith(href);

            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  className={`
                    flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium
                    transition-colors duration-150 whitespace-nowrap
                    ${isActive
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                    }
                  `}
                >
                  <span className={isActive ? "text-emerald-600" : "text-stone-400"}>
                    {icon}
                  </span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

      </div>
    </nav>
  );
}
