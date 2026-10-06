'use client';

import { Card } from '@firmivra/ui';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isActive } from '../../../../../components/app-shell/types';

const tabs: [label: string, path: string][] = [
  ['Intake Form', 'intake'],
  ['Business Documents & Resources', 'business'],
  ['My Uploaded Documents', 'documents'],
  ['Tax Returns', 'taxes'],
  ['Receipts & Invoices', 'invoices'],
  ['Messages and Notes', 'messages'],
];

/**
 * "My Client Portal": the six folder tabs (links to their pages) and the right column.
 * Nahid builds the look from docs/mockups/client-portal/My docs tab.png (N01).
 */
export default function TabsLayout({ children }: { children: ReactNode }) {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <p className="text-2xl font-semibold text-text">My Client Portal</p>
          <p className="text-muted">
            Access your forms, documents, and resources anytime, anywhere.
          </p>
        </div>
        <nav aria-label="Portal folders" className="flex flex-wrap gap-1 border-b border-border">
          {tabs.map(([label, path]) => {
            const href = `/${firmSlug}/${path}`;
            const active = isActive(pathname, href);
            return (
              <Link
                key={path}
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
      <aside className="flex w-full flex-col gap-4 lg:w-72">
        <Card title="Need Help?">
          <p className="text-sm text-muted">
            Our team is here for you. Send a Message comes in N09.
          </p>
        </Card>
        <Card title="Upcoming Appointment">
          <p className="text-sm text-muted">No upcoming appointments. Booking comes in N08.</p>
        </Card>
      </aside>
    </div>
  );
}
