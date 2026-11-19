'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isActive } from '../../../../../components/app-shell/types';
import { RecentActivity } from './_components/recent-activity';
import { QuickLinks, RightColumn } from './_components/side-cards';
import { PortalPageHeader } from '../_components/portal-page-header';
import { usePortalMenu, usePortalTabs } from '../_components/portal-tabs';
import { usePortal } from '../../layout';
import { Card } from '@firmivra/ui';

/**
 * "My Client Portal": the six folder tabs (links to their pages), Quick Links under the tab, and
 * the right column (docs/mockups/client-portal/My docs tab.png, N01).
 */
export default function TabsLayout({ children }: { children: ReactNode }) {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const pathname = usePathname();
  const { business } = usePortal();
  // A tab the firm turned off (Settings > Client Portal > Features) leaves the row, and its page
  // shows why instead of its content, also when opened by its address.
  const tabOn = usePortalTabs(firmSlug);
  // CP-5b, CP-5c: the firm's order and names for the six tabs.
  const menu = usePortalMenu(firmSlug);
  const shownTabs = menu.items.filter(([, path]) => tabOn(path));
  // Home (/home) is the My Client Portal view with its first tab, Intake Form, open.
  const onHome = isActive(pathname, `/${firmSlug}/home`);
  const tabActive = (path: string) =>
    isActive(pathname, `/${firmSlug}/${path}`) || (path === 'intake' && onHome);
  // A switch turned off, not the portal type: the Business page tells a Personal client itself.
  const hidden = menu.items.find(([, path]) => menu.firmOff(path) && tabActive(path));
  const intakeActive = tabActive('intake');
  const documentsPage = !hidden && isActive(pathname, `/${firmSlug}/documents`);
  const isMessagesPage = !hidden && isActive(pathname, `/${firmSlug}/messages`);
  const taxReturns = !hidden && isActive(pathname, `/${firmSlug}/taxes`);
  const invoicesPage = !hidden && isActive(pathname, `/${firmSlug}/invoices`);
  const isBusinessPage = isActive(pathname, `/${firmSlug}/business`);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <PortalPageHeader
          plain
          titleAs="p"
          title={
            <>
              My Client{' '}
              {/* "Portal" is the firm's accent on the Intake Form tab, its button blue on the others. */}
              <span className={intakeActive ? 'text-firm-accent' : 'text-action'}>Portal</span>
            </>
          }
          subtitle="Access your forms, documents, and resources anytime, anywhere."
        />
        <nav
          aria-label="Portal folders"
          className="grid grid-cols-2 gap-1 border-b border-folder-border md:grid-cols-3 xl:grid-cols-6"
        >
          {shownTabs.map(([label, path]) => {
            const href = `/${firmSlug}/${path}`;
            const active = tabActive(path);
            const activeBorder =
              path.startsWith('tab/') ||
              path === 'business' ||
              path === 'messages' ||
              path === 'taxes' ||
              path === 'documents' ||
              path === 'intake' ||
              path === 'invoices'
                ? 'border-firm-primary'
                : 'border-firm-accent';
            const tabClassName = active
              ? `border-t-4 ${activeBorder} bg-surface font-semibold text-firm-text`
              : 'bg-folder-surface text-firm-text hover:bg-folder-hover';
            return (
              <Link
                key={path}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`min-w-0 cursor-pointer rounded-t-card px-3 py-3 text-center text-sm ${tabClassName}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        {hidden ? (
          <Card role="status">
            <h1 className="font-display text-xl font-bold text-heading">
              {hidden[0]} isn&apos;t available
            </h1>
            <p className="mt-2 text-sm text-text">
              {business.name} has turned this part of the portal off. Nothing you shared with them
              is removed.
            </p>
          </Card>
        ) : (
          children
        )}
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <RecentActivity
            slug={firmSlug}
            blueAccents={invoicesPage || documentsPage || isMessagesPage || isBusinessPage}
          />
          <QuickLinks
            slug={firmSlug}
            blueAccents={invoicesPage || documentsPage || isMessagesPage || isBusinessPage}
            businessLayout={isBusinessPage}
          />
        </div>
      </div>
      <RightColumn
        slug={firmSlug}
        place={
          isMessagesPage
            ? 'messages'
            : documentsPage
              ? 'documents'
              : invoicesPage
                ? 'billing'
                : 'dashboard'
        }
        isMessagesPage={isMessagesPage}
        blueAccents={
          intakeActive ||
          documentsPage ||
          taxReturns ||
          isMessagesPage ||
          isBusinessPage ||
          invoicesPage
        }
        businessPage={isBusinessPage}
        showIntakeTip={intakeActive}
        showInvoiceInfo={invoicesPage}
        documentsPage={documentsPage}
        taxesPage={taxReturns}
      />
    </div>
  );
}
