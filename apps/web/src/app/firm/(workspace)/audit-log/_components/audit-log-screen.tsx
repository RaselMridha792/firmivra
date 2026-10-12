'use client';

import type { AuditEntry } from '@firmivra/types';
import { Button, Card, EmptyState, Table, type Column } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { RequireRole } from '../../../../../components/require-role';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { AuditLogFilters, type AuditFilters } from './audit-filters';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "System" for the system and signed-out requests; Firmivra Support as it is, never a person. */
function who(entry: AuditEntry) {
  if (!entry.actor) return 'System';
  return entry.actor.kind === 'CLIENT' ? `${entry.actor.name} (client)` : entry.actor.name;
}

/** Metadata holds ids and flags only (the API never records secrets or document content). */
const shown = (value: unknown) =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));

function Details({ entry }: { entry: AuditEntry }) {
  const metadata = Object.entries(entry.metadata);
  return (
    <details className="min-w-0 max-w-full" data-testid="audit-details">
      <summary className="cursor-pointer text-link">Details</summary>
      <dl className="mt-2 grid min-w-0 gap-2 text-xs md:gap-1">
        {metadata.length ? (
          metadata.map(([key, value]) => (
            <div key={key} className="grid min-w-0 gap-1 sm:flex sm:flex-wrap">
              <dt className="wrap-anywhere text-muted">{key}:</dt>
              <dd className="min-w-0 wrap-anywhere">{shown(value)}</dd>
            </div>
          ))
        ) : (
          <p className="text-muted">No details recorded.</p>
        )}
        <div className="grid min-w-0 gap-1 sm:flex sm:flex-wrap">
          <dt className="text-muted">Request:</dt>
          <dd className="min-w-0 wrap-anywhere">{entry.requestId ?? '—'}</dd>
        </div>
      </dl>
    </details>
  );
}

const columns: Column<AuditEntry>[] = [
  {
    id: 'at',
    label: 'When',
    cell: (entry) => (
      <time dateTime={entry.at} className="whitespace-nowrap">
        {when(entry.at)}
      </time>
    ),
  },
  { id: 'who', label: 'Who', cell: who },
  {
    id: 'action',
    label: 'Action',
    cell: (entry) => <span className="font-mono text-xs">{entry.action}</span>,
  },
  {
    id: 'record',
    label: 'Record',
    cell: (entry) => (
      <>
        {entry.entity.type}
        {entry.entity.id ? (
          <span className="block break-all text-xs text-muted">{entry.entity.id}</span>
        ) : null}
      </>
    ),
  },
  { id: 'ip', label: 'IP', cell: (entry) => entry.ip ?? '—' },
  { id: 'details', label: 'Details', cell: (entry) => <Details entry={entry} /> },
];

/**
 * The firm's audit log, newest first, 50 rows a page, for the Owner and Admins. Staff get 403
 * from the API and see the no-permission state. Read-only: nothing here changes the log.
 */
export function AuditLogScreen() {
  const [filters, setFilters] = useState<AuditFilters>({});
  // The cursors of the pages after the first, so Previous can step back.
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const query = { ...filters, ...(cursor ? { cursor } : {}) };
  const log = useApiQuery(['audit-log', query], () => api.auditLog.list(query));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Audit log
        </h1>
        <p className="text-sm text-muted">
          Who did what in your firm, newest first. Entries can&apos;t be changed or removed.
        </p>
      </div>
      {/* Outside the page state, so the typed filters stay while a page loads. */}
      <RequireRole roles={['OWNER', 'ADMIN']}>
        <Card>
          <AuditLogFilters
            onApply={(next) => {
              setFilters(next);
              setCursors([]);
            }}
          />
        </Card>
      </RequireRole>
      <PageState query={log}>
        {(page) => {
          const controls = {
            page: cursors.length + 1,
            hasPrevious: cursors.length > 0,
            hasNext: page.nextCursor !== null,
            onPrevious: () => setCursors(cursors.slice(0, -1)),
            onNext: () => page.nextCursor && setCursors([...cursors, page.nextCursor]),
            onSort: () => undefined,
          };
          if (!page.items.length)
            return <EmptyState title="No entries" description="Nothing matches these filters." />;
          return (
            <>
              <section
                className="space-y-4 md:hidden"
                aria-label="Audit log entries"
                data-testid="audit-mobile-cards"
              >
                {page.items.map((entry) => (
                  <Card
                    key={entry.id}
                    className="min-w-0 space-y-4"
                    data-testid="audit-mobile-entry"
                  >
                    <dl className="min-w-0 space-y-3">
                      {columns
                        .filter((column) => column.id !== 'details')
                        .map((column) => (
                          <div key={column.id} className="min-w-0 space-y-1">
                            <dt className="text-sm text-muted">{column.label}</dt>
                            <dd className="min-w-0 wrap-anywhere [&_time]:whitespace-normal">
                              {column.cell(entry)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                    <Details entry={entry} />
                  </Card>
                ))}
                <nav aria-label="Audit log pages" className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    disabled={!controls.hasPrevious}
                    onClick={controls.onPrevious}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!controls.hasNext}
                    onClick={controls.onNext}
                  >
                    Next
                  </Button>
                </nav>
              </section>
              <div className="hidden min-w-0 md:block">
                <Table
                  caption="Audit log"
                  rows={page.items}
                  columns={columns}
                  rowKey={(entry) => entry.id}
                  emptyTitle="No entries"
                  emptyText="Nothing matches these filters."
                  server={controls}
                />
              </div>
            </>
          );
        }}
      </PageState>
    </div>
  );
}
