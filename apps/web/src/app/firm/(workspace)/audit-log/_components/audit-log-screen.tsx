'use client';

import type { AuditEntry } from '@firmivra/types';
import { Avatar, Badge, Button, Card, EmptyState, Table, type Column } from '@firmivra/ui';
import { DownloadSimple, ShieldCheck } from '@phosphor-icons/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { RequireRole } from '../../../../../components/require-role';
import { api } from '../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useFirmTimeZone } from '../../intake-forms/_components/expiry';
import { exportFailure, saveFile } from '../../../../../lib/save-file';
import { AuditLogFilters, addressFilters, type AuditFilters } from './audit-filters';
import { detailLines, outcomeOf } from './audit-details';
import { recordHref } from './audit-links';
import { when } from './audit-time';

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
  { prefix: 'staff.', label: 'Staff access' },
  { prefix: 'role.', label: 'Roles & permissions' },
  // Audit Log Review 2, M02b: refused exports, permission and settings changes.
  { prefix: 'access.', label: 'Denied access' },
] as const;

/** "client_account.approved" → "Client account approved": the code stays beside it. */
const actionText = (action: string) => {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Metadata holds ids, flags and changed values (the API never records secrets or document
 * content); a change reads "old → new" (R03c).
 */
function Details({ entry }: { entry: AuditEntry }) {
  const metadata = detailLines(entry.metadata);
  return (
    <details className="min-w-0 max-w-full" data-testid="audit-details">
      <summary className="cursor-pointer text-link">Details</summary>
      <dl className="mt-2 grid min-w-0 gap-2 text-xs md:gap-1">
        {metadata.length ? (
          metadata.map(({ key, value }, i) => (
            <div key={`${key}-${i}`} className="grid min-w-0 gap-1 sm:flex sm:flex-wrap">
              <dt className="wrap-anywhere text-muted">{key}:</dt>
              <dd className="min-w-0 wrap-anywhere">{value}</dd>
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

function RecordLink({ entity }: { entity: AuditEntry['entity'] }) {
  const href = recordHref(entity);
  if (!href) return null;
  return (
    <Link href={href} data-testid="audit-record-link" className="block text-sm text-link">
      Open {entity.type.replace(/_/g, ' ')}
    </Link>
  );
}

const columnsIn = (timeZone: string | undefined): Column<AuditEntry>[] => [
  {
    id: 'at',
    label: 'When',
    cell: (entry) => (
      <time dateTime={entry.at} className="whitespace-nowrap">
        {when(entry.at, timeZone)}
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
        <span className="flex flex-wrap items-center gap-2 font-medium text-heading">
          {actionText(entry.action)}
          {/* M02b: a refused request or a recorded failure says so. */}
          {outcomeOf(entry.action) ? <Badge tone="danger">{outcomeOf(entry.action)}</Badge> : null}
        </span>
        <span className="block font-mono text-xs text-muted">{entry.action}</span>
      </span>
    ),
  },
  {
    id: 'record',
    label: 'Record',
    cell: (entry) => (
      <>
        {/* M01a: the record's current name, or "Deleted <type>" when it is gone. */}
        {entry.entity.name ? (
          <span
            data-testid="audit-record-name"
            className={`block wrap-anywhere ${entry.entity.deleted ? 'text-muted italic' : 'font-medium text-heading'}`}
          >
            {entry.entity.name}
          </span>
        ) : null}
        {/* M01b: the record's own page, which checks the viewer's access. */}
        <RecordLink entity={entry.entity} />
        <span className="block">{entry.entity.type}</span>
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
  // A link can open the log already filtered: action, record type and record id (CD-F15).
  const params = useSearchParams();
  const [opened] = useState(() => addressFilters(params));
  const [filters, setFilters] = useState<AuditFilters>(opened);
  // The cursors of the pages after the first, so Previous can step back.
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const query = { ...filters, ...(cursor ? { cursor } : {}) };
  const log = useApiQuery(['audit-log', query], () => api.auditLog.list(query));
  const area = filters.action ?? '';
  const timeZone = useFirmTimeZone();
  const columns = columnsIn(timeZone);
  // R02a: the export downloads through the session (an expired access cookie is refreshed, not
  // shown as raw JSON); it says how many entries it saved, or why it failed.
  const exporter = useApiMutation((f: AuditFilters) => api.auditLog.export(f));
  const [exported, setExported] = useState<number | null>(null);
  const runExport = () => {
    setExported(null);
    exporter.mutate(filters, {
      onSuccess: (file) => {
        saveFile(file);
        setExported(file.entries);
      },
    });
  };

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
        <RequireRole roles={['OWNER', 'ADMIN']}>
          {/* The filters shown, every page of them, as CSV (the export itself is logged). */}
          <button
            type="button"
            onClick={runExport}
            disabled={exporter.isPending}
            data-testid="audit-export"
            className="ml-auto inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-action px-4 text-sm font-semibold text-action hover:bg-folder-surface disabled:opacity-60"
          >
            <DownloadSimple aria-hidden weight="bold" className="size-5" />
            {exporter.isPending ? 'Exporting…' : 'Export'}
          </button>
        </RequireRole>
      </header>
      <RequireRole roles={['OWNER', 'ADMIN']}>
        {exporter.error ? (
          <p role="alert" data-testid="audit-export-result" className="text-sm text-danger">
            {exportFailure(exporter.error)}
          </p>
        ) : exported !== null ? (
          <p role="status" data-testid="audit-export-result" className="text-sm text-success">
            Downloaded {exported} {exported === 1 ? 'entry' : 'entries'}.
          </p>
        ) : null}
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
            initial={opened}
            timeZone={timeZone}
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
