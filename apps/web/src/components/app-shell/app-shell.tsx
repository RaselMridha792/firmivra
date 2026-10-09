'use client';

import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Header } from './header';
import { Sidebar } from './sidebar';
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
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const sidebar = { subtitle, sections, roleLabel };

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

      <div className="flex min-h-screen flex-col md:pl-72 md:[&>header]:pr-4">
        <Header
          search={search}
          greeting={greeting}
          roleLabel={roleLabel}
          onOpenMenu={() => setDrawer(true)}
        />
        <main className="flex-1 p-4 md:pb-8 md:pl-6 md:pr-4 md:pt-4">{children}</main>
        {footer}
      </div>
    </div>
  );
}
