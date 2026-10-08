'use client';

import { Button, Card } from '@firmivra/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
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
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <p className="font-display text-4xl font-bold text-firm-primary">
            My Client <span className="text-firm-accent">Portal</span>
          </p>
          <p className="text-muted">
            Access your forms, documents, and resources anytime, anywhere.
          </p>
        </div>
        <nav
          aria-label="Portal folders"
          className="flex overflow-x-auto gap-1 border-b border-folder-border"
        >
          {tabs.map(([label, path]) => {
            const href = `/${firmSlug}/${path}`;
            const active = isActive(pathname, href);
            return (
              <Link
                key={path}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`min-w-32 flex-1 rounded-t-card px-3 py-4 text-center text-sm ${active ? 'border-t-4 border-firm-accent bg-surface font-semibold text-firm-primary' : 'bg-folder-surface text-firm-primary hover:bg-folder-hover'}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
      <aside className="flex w-full flex-col gap-4 lg:w-72">
        <Card title="Need Help?" className="bg-firm-primary! text-on-action [&_h2]:text-on-action">
          <p className="my-3 text-sm">Our team is here for you.</p>
          <Button className="w-full" onClick={() => router.push(`/${firmSlug}/messages`)}>
            Send a Message <ArrowRight aria-hidden className="size-5" />
          </Button>
        </Card>
        <Card title="Upcoming Appointment">
          <p className="my-3 text-sm text-muted">
            View your appointments and book a time with our team.
          </p>
          <Link
            href={`/${firmSlug}/appointments`}
            className="inline-flex items-center gap-2 text-firm-accent underline"
          >
            Schedule Now <ArrowRight aria-hidden className="size-5" />
          </Link>
        </Card>
      </aside>
    </div>
  );
}
