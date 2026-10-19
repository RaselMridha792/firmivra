'use client';

import type { AuditEntry } from '@firmivra/types';
import { Avatar, Button, Card, EmptyState, Table, type Column } from '@firmivra/ui';
import { ShieldCheck } from '@phosphor-icons/react';
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

/** The quick views above the log: each is an action prefix the API filters by. */
const AREAS = [
  { prefix: '', label: 'All activity' },
  { prefix: 'auth.', label: 'Sign-ins' },
  { prefix: 'client.', label: 'Clients' },
  { prefix: 'client_account.', label: 'Portal accounts' },
  { prefix: 'document.', label: 'Documents' },
  { prefix: 'appointment.', label: 'Appointments' },
  { prefix: 'invoice.', label: 'Invoices' },
  { prefix: 'membership.', label: 'Team' },
] as const;

/** "client_account.approved" → "Client account approved": the code stays beside it. */
const actionText = (action: string) => {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

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
  {
    id: 'who',
    label: 'Who',
    cell: (entry) => (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={entry.actor?.name ?? 'System'} size="sm" />
        <span className="min-w-0 wrap-anywhere">{who(entry)}</span>
      </span>
    ),
  },
  {
    id: 'action',
    label: 'Action',
    cell: (entry) => (
      <span className="block min-w-0">
        <span className="block font-medium text-heading">{actionText(entry.action)}</span>
        <span className="block font-mono text-xs text-muted">{entry.action}</span>
      </span>
    ),
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
  const area = filters.action ?? '';

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
        >
          <ShieldCheck weight="fill" className="size-10" />
        </span>
        <div className="min-w-0">
          <h1
            data-testid="page-title"
            className="font-display text-3xl font-bold text-heading sm:text-4xl"
          >
            Audit log
          </h1>
          <p className="text-base text-muted">
            Who did what in your firm, newest first. Entries can&apos;t be changed or removed.
          </p>
        </div>
      </header>
      <RequireRole roles={['OWNER', 'ADMIN']}>
        <nav aria-label="Audit log areas" className="flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <button
              key={a.label}
              type="button"
              aria-pressed={area === a.prefix}
              onClick={() => {
                const { action: _drop, ...rest } = filters;
                setFilters(a.prefix ? { ...rest, action: a.prefix } : rest);
                setCursors([]);
              }}
              className={`min-h-9 rounded-full border px-4 text-sm font-medium ${area === a.prefix ? 'border-action bg-action text-on-action' : 'border-border bg-surface text-text hover:bg-canvas'}`}
            >
              {a.label}
            </button>
          ))}
        </nav>
        {/* Outside the page state, so the typed filters stay while a page loads. */}
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
                className="space-y-4 xl:hidden"
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
              <div className="hidden min-w-0 rounded-xl bg-surface p-2 shadow-md xl:block">
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
