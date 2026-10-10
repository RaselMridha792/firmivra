'use client';

import { Badge } from '@firmivra/ui';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { initials, publicPath } from '../../../../../components/app-shell/types';
import { PageState } from '../../../../../components/page-state';
import { RequireRole } from '../../../../../components/require-role';
import { ACCOUNT_TYPES, formatPhone, PortalBadge } from '../_components/client-parts';
import { ArchiveAction } from './_components/archive-action';
import { useClientRecord } from './_components/use-client-record';

const tabs: [label: string, path: string][] = [
  ['Overview', ''],
  ['Documents', '/documents'],
  ['Messages', '/messages'],
  ['Invoices', '/invoices'],
  ['Signatures', '/signatures'],
];

/**
 * One client: the header (name, type, portal status, contact, archive) and the tabs. A client
 * the signed-in person can't see is 404 from the API (another firm's, or Staff's unassigned one).
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = publicPath(usePathname());
  const base = `/clients/${encodeURIComponent(id)}`;
  const record = useClientRecord(id);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        <Link href="/clients" className="text-link hover:underline">
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
              <RequireRole roles={['OWNER', 'ADMIN']}>
                <ArchiveAction client={client} />
              </RequireRole>
            </header>
            <nav aria-label="Client" className="flex gap-1 overflow-x-auto border-b border-border">
              {tabs.map(([label, tab]) => {
                const href = `${base}${tab}`;
                const active = path === href;
                return (
                  <Link
                    key={label}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${active ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-text'}`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
            {children}
          </>
        )}
      </PageState>
    </div>
  );
}
