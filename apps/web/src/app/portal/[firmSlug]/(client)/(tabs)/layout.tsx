'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isActive } from '../../../../../components/app-shell/types';
import { RecentActivity } from './_components/recent-activity';
import { QuickLinks, RightColumn } from './_components/side-cards';
import { PortalPageHeader } from '../_components/portal-page-header';

const tabs: [label: string, path: string][] = [
  ['Intake Form', 'intake'],
  ['Business Documents & Resources', 'business'],
  ['My Uploaded Documents', 'documents'],
  ['Tax Returns', 'taxes'],
  ['Receipts & Invoices', 'invoices'],
  ['Messages and Notes', 'messages'],
];

/**
 * "My Client Portal": the six folder tabs (links to their pages), Quick Links under the tab, and
 * the right column (docs/mockups/client-portal/My docs tab.png, N01).
 */
export default function TabsLayout({ children }: { children: ReactNode }) {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <PortalPageHeader
          titleAs="p"
          title={
            <>
              My Client <span className="text-firm-accent">Portal</span>
            </>
          }
          subtitle="Access your forms, documents, and resources anytime, anywhere."
        />
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
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <RecentActivity slug={firmSlug} />
          <QuickLinks slug={firmSlug} />
        </div>
      </div>
      <RightColumn slug={firmSlug} />
    </div>
  );
}
