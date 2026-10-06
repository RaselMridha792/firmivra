'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { publicPath } from '../../../../../components/app-shell/types';

const tabs: [label: string, path: string][] = [
  ['Overview', ''],
  ['Documents', '/documents'],
  ['Messages', '/messages'],
  ['Invoices', '/invoices'],
];

/**
 * One client: header and tabs. The client's name comes from the clients API (R10) once it's on
 * main. Fahad builds the screens (F06, F07, F10).
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = publicPath(usePathname());
  const base = `/clients/${id}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        <Link href="/clients" className="hover:text-text">
          Clients
        </Link>{' '}
        / Client
      </p>
      <nav aria-label="Client" className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map(([label, tab]) => {
          const href = `${base}${tab}`;
          const active = path === href;
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`rounded-t-control px-3 py-2 text-sm ${active ? 'border border-b-0 border-border bg-surface font-semibold text-text' : 'text-muted hover:text-text'}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
