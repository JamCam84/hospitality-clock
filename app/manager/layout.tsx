/**
 * app/manager/layout.tsx
 *
 * Shared layout for every page under /manager/.
 * Renders the sidebar on desktop and a slide-out drawer on mobile,
 * then lets each page's content fill the remaining space.
 *
 * This is a Server Component — it imports the client-side ManagerSidebar
 * which handles all interactive state (collapse/expand, mobile drawer).
 */

import ManagerSidebar from "@/components/ManagerSidebar";

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /*
     * Outer shell:
     *   - h-screen + overflow-hidden: the sidebar and content both sit within
     *     the viewport height; only the content column scrolls.
     *   - bg-stone-100: subtle backdrop that peeks around the white content cards.
     */
    <div className="flex h-screen bg-stone-100 overflow-hidden">

      {/* Left sidebar (desktop) + mobile top-bar + mobile drawer */}
      <ManagerSidebar />

      {/*
       * Main content column.
       *   - flex-1 min-w-0: fills remaining space and respects sidebar width.
       *   - overflow-y-auto: the only scroll container — pages don't need their
       *     own scroll.
       *   - pt-14 md:pt-0: compensates for the fixed mobile top bar (56px tall).
       *     Collapsed to zero on md+ screens where the sidebar is sticky.
       */}
      <main className="flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>

    </div>
  );
}
