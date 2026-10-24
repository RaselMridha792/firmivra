'use client';

import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type AccountMenuItem, Header } from './header';
import { type FirmBrand, Sidebar } from './sidebar';
import type { NavSections } from './types';

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
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const sidebar = { subtitle, sections, roleLabel, brand };

  return (
    <div className="min-h-screen bg-canvas">
      <div className="fixed inset-y-0 left-0 hidden md:block">
        <Sidebar {...sidebar} />
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
        className={`flex min-h-screen flex-col md:[&>header]:pr-4 ${brand ? 'md:pl-61.5' : 'md:pl-72'}`}
      >
        <Header
          clock
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
