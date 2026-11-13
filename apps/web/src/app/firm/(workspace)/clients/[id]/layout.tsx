'use client';

import { ActionMenu, Badge } from '@firmivra/ui';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { initials, publicPath } from '../../../../../components/app-shell/types';
import { OriginLink, useOriginNavigate } from '../../../../../components/origin-link';
import { PageState } from '../../../../../components/page-state';
import { RequireRole } from '../../../../../components/require-role';
import { LAST_CLIENTS_LIST } from '../../../../../lib/clients-place';
import { ACCOUNT_TYPES, formatPhone, PortalBadge } from '../_components/client-parts';
import { RETURNING, session } from '../_components/list-place';
import { ArchiveAction } from './_components/archive-action';
import { serviceTabs, useClientServices } from './_components/client-services';
import { EditClient } from './_components/edit-client';
import { useClientRecord } from './_components/use-client-record';

// Octavia's E4: the profile's sections, in the order of her 360° workspace. The service tabs (Tax
// Returns, Bookkeeping, Payroll, Tax Planning, Advisory) come by enrollment and the member's grid,
// between Intake Forms and Invoices, and open the module's record with Back here. Past the first
// eleven, the rest go under More.
const BEFORE: [label: string, path: string][] = [
  ['Overview', ''],
  ['Services', '/services'],
  ['Documents', '/documents'],
  ['Intake Forms', '/intake-forms'],
];
const AFTER: [label: string, path: string][] = [
  ['Invoices', '/invoices'],
  ['Messages', '/messages'],
  ['Tasks', '/tasks'],
  ['Notes', '/notes'],
  // MSG-F16: the client's own timeline.
  ['Activity', '/activity'],
  ['Signatures', '/signatures'],
];
const INLINE = 11;
type Tab = { label: string; href: string; service?: true };

/**
 * One client: the header (name, type, portal status, contact, archive) and the tabs. A client
 * the signed-in person can't see is 404 from the API (another firm's, or Staff's unassigned one).
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = publicPath(usePathname());
  const base = `/clients/${encodeURIComponent(id)}`;
  const record = useClientRecord(id);
  const router = useRouter();
  const search = useSearchParams();
  const openService = useOriginNavigate();
  const services = useClientServices(id);
  const tabs: Tab[] = [
    ...BEFORE.map(([label, tab]) => ({ label, href: `${base}${tab}` })),
    ...serviceTabs(services.data).map((t) => ({ ...t, service: true as const })),
    ...AFTER.map(([label, tab]) => ({ label, href: `${base}${tab}` })),
  ];
  const more = tabs.slice(INLINE);
  const inMore = more.find((t) => t.href === path);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        <Link
          href="/clients"
          onClick={(event) => {
            // Return to Clients opens the list as it was left (Octavia's E7).
            const last = session.get(LAST_CLIENTS_LIST);
            session.set(RETURNING, '1');
            if (last && last !== '/clients') {
              event.preventDefault();
              router.push(last);
            }
          }}
          className="text-link hover:underline"
        >
          Clients
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text">{record.data?.displayName ?? 'Client'}</span>
      </p>
      <PageState query={record}>
        {(client) => (
          <>
            <header className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <span
                  aria-hidden
                  className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-600"
                >
                  {initials(client.displayName)}
                </span>
                <div className="min-w-0">
                  <h1
                    data-testid="page-title"
                    className="text-2xl font-semibold wrap-anywhere text-text"
                  >
                    {client.displayName}
                  </h1>
                  <p className="mt-1 text-sm wrap-anywhere text-muted">
                    {client.email}
                    {client.email && client.phone ? ' · ' : null}
                    {client.phone ? (
                      <span className="whitespace-nowrap">{formatPhone(client.phone)}</span>
                    ) : null}
                    {client.email || client.phone ? null : 'No contact details yet'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone="info">{ACCOUNT_TYPES[client.accountType]}</Badge>
                    <PortalBadge status={client.portalStatus} />
                    {client.archivedAt ? <Badge tone="warning">Archived</Badge> : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {client.archivedAt ? null : (
                  <EditClient client={client} initiallyOpen={search.get('edit') === '1'} />
                )}
                <RequireRole roles={['OWNER', 'ADMIN']}>
                  <ArchiveAction client={client} />
                </RequireRole>
              </div>
            </header>
            <nav
              aria-label="Client"
              className="flex items-center gap-1 overflow-x-auto border-b border-border"
            >
              {tabs.slice(0, INLINE).map((t) => {
                const active = path === t.href;
                const className = `-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${active ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-text'}`;
                return t.service ? (
                  <OriginLink
                    key={t.label}
                    href={t.href}
                    className={className}
                    data-testid="service-tab"
                  >
                    {t.label}
                  </OriginLink>
                ) : (
                  <Link
                    key={t.label}
                    href={t.href}
                    aria-current={active ? 'page' : undefined}
                    className={className}
                  >
                    {t.label}
                  </Link>
                );
              })}
              {more.length ? (
                <ActionMenu
                  className="ml-auto shrink-0"
                  label="More client sections"
                  trigger={inMore ? `More: ${inMore.label}` : 'More'}
                  sections={[
                    {
                      items: more.map((t) => ({
                        label: t.label,
                        onSelect: () => (t.service ? openService(t.href) : router.push(t.href)),
                      })),
                    },
                  ]}
                />
              ) : null}
            </nav>
            {children}
          </>
        )}
      </PageState>
    </div>
  );
}
