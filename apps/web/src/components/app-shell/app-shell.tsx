'use client';

import { X } from 'lucide-react';
import { type ReactNode, useState, useSyncExternalStore } from 'react';
import { type AccountMenuItem, Header } from './header';
import { type FirmBrand, Sidebar } from './sidebar';
import type { NavSections } from './types';

// Overview guide 18: the firm menu collapses to icons and stays so for this browser. Only a
// per-viewer convenience lives in localStorage; when storage is unavailable the choice lasts the
// visit.
const COLLAPSED_KEY = 'firmivra.sidebar.collapsed';
const collapseListeners = new Set<() => void>();
let collapsedInMemory = false;
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return collapsedInMemory;
  }
}
function writeCollapsed(value: boolean) {
  collapsedInMemory = value;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // The visit keeps it in memory.
  }
  for (const listener of collapseListeners) listener();
}
function onCollapsedChange(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * Sidebar, header and page area for the Super Admin, firm and portal sites (inside <SignedIn>).
 * Below 768 px the sidebar becomes a drawer behind the header's menu button.
 * The look follows docs/mockups/super-admin/Dashboard Active .png; Tumit polishes it (F04a).
 */
export function AppShell({
  subtitle,
  sections,
  roleLabel,
  search,
  greeting,
  footer,
  bell,
  brand,
  headerStart,
  headerActions,
  accountMenu,
  clockZone,
  children,
}: {
  /** Under the logo, for example "Super Admin Portal". */
  subtitle: string;
  sections: NavSections;
  /** Shown under the user's name, for example "Super Admin" or "Owner". */
  roleLabel: string;
  /** Search box placeholder (Super Admin only). */
  search?: string;
  /** Header greeting instead of search (portal). */
  greeting?: ReactNode;
  /** Under the page area (portal: copyright and links). */
  footer?: ReactNode;
  /** Replaces the header's plain bell, for example the firm's `<NotificationBell />` (F07). */
  bell?: ReactNode;
  /** The firm workspace look: firm logo and motto in the sidebar, blue pill for the open page. */
  brand?: FirmBrand;
  /** Header content instead of search or greeting (the firm's search form). */
  headerStart?: ReactNode;
  /** Header controls before the bell (the firm's "+ New" menu). */
  headerActions?: ReactNode;
  /** Account menu entries above Sign out (the firm workspace). */
  accountMenu?: AccountMenuItem[];
  /** The header clock's time zone: the firm's in its workspace (U2); see Header. */
  clockZone?: string | null;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const sidebar = { subtitle, sections, roleLabel, brand };
  // Expanded on the first visit (and on the server); the firm workspace only.
  const collapsed =
    useSyncExternalStore(onCollapsedChange, readCollapsed, () => false) && Boolean(brand);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Above the page, so the slim menu's names show over it. */}
      <div className="fixed inset-y-0 left-0 z-30 hidden md:block">
        <Sidebar
          {...sidebar}
          collapsed={collapsed}
          {...(brand ? { onToggle: () => writeCollapsed(!collapsed) } : {})}
        />
      </div>

      {drawer ? (
        <div
          className="fixed inset-0 z-40 flex md:hidden"
          onKeyDown={(e) => e.key === 'Escape' && setDrawer(false)}
        >
          <Sidebar {...sidebar} onNavigate={() => setDrawer(false)} />
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
            className="flex flex-1 items-start justify-end bg-brand-900/50 p-4 text-white"
          >
            <X aria-hidden className="size-6" />
          </button>
        </div>
      ) : null}

      <div
        className={`flex min-h-screen flex-col md:[&>header]:pr-4 ${brand ? (collapsed ? 'md:pl-18' : 'md:pl-61.5') : 'md:pl-72'}`}
      >
        <Header
          clock
          clockZone={clockZone}
          search={search}
          greeting={greeting}
          bell={bell}
          start={headerStart}
          actions={headerActions}
          accountMenu={accountMenu}
          roleLabel={roleLabel}
          onOpenMenu={() => setDrawer(true)}
        />
        <main className="flex-1 p-4 md:pb-8 md:pl-6 md:pr-4 md:pt-4">{children}</main>
        {footer}
      </div>
    </div>
  );
}
