'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isActive } from '../../../../components/app-shell/types';

const menu: [label: string, href: string][] = [
  ['Profile', '/settings/profile'],
  ['Branding', '/settings/branding'],
  ['Client portal', '/settings/portal'],
  ['Terms & Privacy', '/settings/legal'],
  ['Availability', '/settings/availability'],
  ['Tax statuses', '/settings/tax-statuses'],
];

/** Settings: its own menu next to the page. `/settings` opens Profile (settings/page.tsx). */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav aria-label="Settings" className="flex flex-col gap-1 md:w-56">
        {menu.map(([label, href]) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`rounded-control px-3 py-2 text-sm ${active ? 'bg-surface font-semibold text-text' : 'text-muted hover:text-text'}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
