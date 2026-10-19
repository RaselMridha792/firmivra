'use client';

import type { ComplianceDeadlineRow, ComplianceDeadlinesQuery } from '@firmivra/types';
import { ActionMenu, BulkBar, type Column, Table, Toast } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  Bell,
  CheckCircle,
  DotsThreeVertical,
  Eye,
  FileArrowUp,
  ListChecks,
  PencilSimple,
  Prohibit,
  Spinner,
  UserSwitch,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  StatusPill,
  TYPE_LABEL,
  dayText,
  shortName,
  timeText,
} from './compliance-shared';
import { type BulkKind, BulkDialog, DeadlineDialog, type SingleKind } from './deadline-dialogs';

type Dialog =
  | { kind: SingleKind; row: ComplianceDeadlineRow }
  | { kind: 'bulk'; bulk: BulkKind; ids: string[] };

const OPEN = ['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT'];

/** The deadlines table: sort, page, select, the three-dot menu and the bulk bar. */
export function DeadlineTable({
  query,
  onQuery,
  caption,
  emptyText,
  pageSize = 10,
  hideBulk,
  compact,
}: {
  query: ComplianceDeadlinesQuery;
  onQuery: (change: Partial<ComplianceDeadlinesQuery>) => void;
  caption: string;
  emptyText?: string;
  pageSize?: number;
  hideBulk?: boolean;
  /** The Overview's short list: no paging controls beyond the first page. */
  compact?: boolean;
}) {
  const router = useRouter();
  const list = useApiQuery([...COMPLIANCE_KEY, 'deadlines', query], () =>
    api.compliance.deadlines({ ...query, pageSize }),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const rows = list.data?.items ?? [];
  const options = { invalidate: [...COMPLIANCE_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' });
  const start = useApiMutation((id: string) => api.compliance.startDeadline(id), options);
  const reopen = useApiMutation((id: string) => api.compliance.reopenDeadline(id), options);
  const archive = useApiMutation((id: string) => api.compliance.archiveDeadline(id), options);
  const task = useApiMutation((id: string) => api.compliance.addTask(id), options);
  const page = Number(query.page ?? 1);
  const sort = { id: query.sort ?? 'dueOn', descending: query.direction === 'desc' };

  const columns: Column<ComplianceDeadlineRow>[] = [
    {
      id: 'dueOn',
      label: 'Date',
      sortable: true,
      cell: (d) => (
        <span
          data-overdue={d.displayStatus === 'OVERDUE' || undefined}
          aria-label={
            d.displayStatus === 'OVERDUE'
              ? `${dayText(d.extendedDueOn ?? d.dueOn)} (overdue)`
              : undefined
          }
          className="whitespace-nowrap"
        >
          {dayText(d.extendedDueOn ?? d.dueOn)}
          {d.dueTime ? (
            <span className="block text-xs text-muted">{timeText(d.dueTime)}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'name',
      label: 'Deadline / Task',
      sortable: true,
      cell: (d) => (
        <Link
          href={`/compliance/${d.id}`}
          data-testid="deadline-link"
          className="font-medium text-heading hover:underline"
        >
          {d.name}
        </Link>
      ),
    },
    {
      id: 'client',
      label: 'Client',
      sortable: true,
      cell: (d) => <span className="text-link">{d.client.displayName}</span>,
    },
    { id: 'type', label: 'Type', sortable: true, cell: (d) => TYPE_LABEL[d.type] },
    { id: 'agency', label: 'Agency', sortable: true, cell: (d) => d.agency ?? '—' },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      cell: (d) => <StatusPill status={d.displayStatus} />,
    },
    {
      id: 'assigned',
      label: 'Assigned To',
      cell: (d) => (d.assignedTo ? shortName(d.assignedTo.name) : '—'),
    },
  ];

  const menu = (d: ComplianceDeadlineRow) => {
    const open = OPEN.includes(d.status);
    const item = (label: string, icon: typeof Eye, onSelect: () => void, danger?: boolean) => ({
      label,
      icon,
      onSelect,
      ...(danger ? { danger } : {}),
    });
    return [
      {
        items: [
          item('View', Eye, () => router.push(`/compliance/${d.id}`)),
          item('Edit', PencilSimple, () => router.push(`/compliance/${d.id}/edit`)),
          ...(open
            ? [
                item('Mark In Progress', Spinner, () =>
                  start.mutate(d.id, { onSuccess: done('Marked in progress.'), onError: fail }),
                ),
                item('Complete', CheckCircle, () => setDialog({ kind: 'complete', row: d })),
                item('Reassign', UserSwitch, () => setDialog({ kind: 'reassign', row: d })),
                item('Reminder', Bell, () => setDialog({ kind: 'reminders', row: d })),
                item('Create Task', ListChecks, () =>
                  task.mutate(d.id, { onSuccess: done('Task created.'), onError: fail }),
                ),
                item('Add Document', FileArrowUp, () => router.push(`/compliance/${d.id}#related`)),
                item('Not Applicable', Prohibit, () =>
                  setDialog({ kind: 'notApplicable', row: d }),
                ),
              ]
            : d.archived
              ? []
              : [
                  item('Reopen', ArrowCounterClockwise, () =>
                    reopen.mutate(d.id, { onSuccess: done('Deadline reopened.'), onError: fail }),
                  ),
                ]),
          ...(d.archived
            ? []
            : [
                item(
                  'Archive',
                  Archive,
                  () =>
                    archive.mutate(d.id, {
                      onSuccess: done(`${d.name} archived.`),
                      onError: fail,
                    }),
                  true,
                ),
              ]),
        ],
      },
    ];
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {!hideBulk && selected.length > 0 ? (
        <BulkBar
          count={selected.length}
          noun="deadlines"
          actions={[
            {
              label: 'Reassign',
              icon: UserSwitch,
              onClick: () => setDialog({ kind: 'bulk', bulk: 'reassign', ids: selected }),
            },
            {
              label: 'Status',
              icon: CheckCircle,
              onClick: () => setDialog({ kind: 'bulk', bulk: 'status', ids: selected }),
            },
            {
              label: 'Archive',
              icon: Archive,
              danger: true,
              onClick: () => setDialog({ kind: 'bulk', bulk: 'archive', ids: selected }),
            },
          ]}
        />
      ) : null}
      <div data-testid="deadline-table" className="relative">
        <Table
          rows={rows}
          columns={columns}
          rowKey={(d) => d.id}
          caption={caption}
          dense
          noun="deadlines"
          pageSize={pageSize}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Deadlines are not available' : 'No deadlines'}
          emptyText={
            list.isError
              ? 'We could not load the deadlines. Try again in a moment.'
              : (emptyText ?? 'Deadlines that match will appear here.')
          }
          emptyAction={
            <Link
              href="/compliance/new"
              className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action"
            >
              Add Deadline
            </Link>
          }
          {...(hideBulk ? {} : { selection: { selected, onChange: setSelected } })}
          rowActions={(d) => (
            <ActionMenu
              label={`Actions for ${d.name}`}
              sections={menu(d)}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
            />
          )}
          {...(compact
            ? {}
            : {
                server: {
                  page: list.data?.page ?? 1,
                  total: list.data?.total ?? 0,
                  hasNext: (list.data?.page ?? 1) * pageSize < (list.data?.total ?? 0),
                  hasPrevious: (list.data?.page ?? 1) > 1,
                  onNext: () => onQuery({ page: page + 1 }),
                  onPrevious: () => onQuery({ page: Math.max(1, page - 1) }),
                  onPage: (next: number) => onQuery({ page: next }),
                  sort,
                  onSort: (next: { id: string; descending: boolean }) =>
                    onQuery({
                      sort: next.id as ComplianceDeadlinesQuery['sort'],
                      direction: next.descending ? 'desc' : 'asc',
                      page: 1,
                    }),
                },
              })}
        />
      </div>
      {dialog && dialog.kind !== 'bulk' ? (
        <DeadlineDialog
          kind={dialog.kind}
          deadline={dialog.row}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
      {dialog?.kind === 'bulk' ? (
        <BulkDialog
          kind={dialog.bulk}
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setSelected([]);
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}
