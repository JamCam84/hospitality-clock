/**
 * components/ManagerNav.tsx
 *
 * The sidebar navigation has moved to components/ManagerSidebar.tsx and is
 * rendered once by app/manager/layout.tsx for every manager page.
 *
 * This file is kept so that existing page files that still call
 * <ManagerNav /> continue to compile without changes — the component
 * simply renders nothing.  Pages do not need to be updated; the layout
 * provides the sidebar automatically.
 */

export default function ManagerNav() {
  return null;
}
