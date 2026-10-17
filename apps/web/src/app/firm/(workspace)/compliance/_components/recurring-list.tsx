'use client';

import type { ComplianceRecurrence } from '@firmivra/types';
import { ActionMenu, Badge, type Column, Table, Toast } from '@firmivra/ui';
import { Archive, DotsThreeVertical, PencilSimple, Pause, Play, Stop } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  RECURRENCE_TONE,
  TYPE_LABEL,
  dayText,
  frequencyText,
} from './compliance-shared';

/** The recurring deadline definitions, with edit, pause, resume, end and archive. */
export function RecurringList({
  templates,
  testId = 'recurring-rows',
}: {
  /** true: only templates; false: only live definitions; undefined: all. */
  templates?: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const list = useApiQuery([...COMPLIANCE_KEY, 'recurrences', templates, page], () =>
    api.compliance.recurrences({
      ...(templates === undefined ? {} : { templates }),
      page,
      pageSize: 10,
    }),
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const options = { invalidate: [...COMPLIANCE_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' });
  const pause = useApiMutation((id: string) => api.compliance.pauseRecurrence(id), options);
  const resume = useApiMutation((id: string) => api.compliance.resumeRecurrence(id), options);
  const end = useApiMutation((id: string) => api.compliance.endRecurrence(id), options);
  const archive = useApiMutation((id: string) => api.compliance.archiveRecurrence(id), options);
  const rows = list.data?.items ?? [];

  const columns: Column<ComplianceRecurrence>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (r) => (
        <span className="font-medium text-heading">
          {r.name}
          {r.isTemplate ? <span className="ml-2 text-xs text-muted">Template</span> : null}
        </span>
      ),
    },
    { id: 'type', label: 'Type', cell: (r) => TYPE_LABEL[r.type] },
    { id: 'frequency', label: 'Repeats', cell: (r) => frequencyText(r) },
    { id: 'next', label: 'Next Due', cell: (r) => (r.nextDueOn ? dayText(r.nextDueOn) : '—') },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => (
        <Badge tone={RECURRENCE_TONE[r.status]}>
          {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
        </Badge>
      ),
    },
  ];
  const menu = (r: ComplianceRecurrence) => {
    const item = (label: string, icon: typeof Pause, onSelect: () => void, danger?: boolean) => ({
      label,
      icon,
      onSelect,
      ...(danger ? { danger } : {}),
    });
    return [
      {
        items: [
          ...(r.status === 'ACTIVE' || r.status === 'PAUSED'
            ? [
                {
                  label: 'Edit',
                  icon: PencilSimple,
                  onSelect: () => router.push(`/compliance/recurring/new?edit=${r.id}`),
                },
              ]
            : []),
          ...(r.status === 'ACTIVE'
            ? [
                item('Pause', Pause, () =>
                  pause.mutate(r.id, { onSuccess: done('Paused.'), onError: fail }),
                ),
              ]
            : []),
          ...(r.status === 'PAUSED'
            ? [
                item('Resume', Play, () =>
                  resume.mutate(r.id, { onSuccess: done('Resumed.'), onError: fail }),
                ),
              ]
            : []),
          ...(r.status === 'ACTIVE' || r.status === 'PAUSED'
            ? [
                item(
                  'End',
                  Stop,
                  () => end.mutate(r.id, { onSuccess: done('Ended.'), onError: fail }),
                  true,
                ),
              ]
            : []),
          ...(r.status !== 'ACTIVE' && r.status !== 'ARCHIVED'
            ? [
                item(
                  'Archive',
                  Archive,
                  () => archive.mutate(r.id, { onSuccess: done('Archived.'), onError: fail }),
                  true,
                ),
              ]
            : []),
        ],
      },
    ];
  };
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={testId}>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="relative">
        <Table
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Recurring deadlines"
          dense
          noun="recurring deadlines"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={
            list.isError ? 'Recurring deadlines are not available' : 'No recurring deadlines'
          }
          emptyText={
            list.isError
              ? 'We could not load them. Try again in a moment.'
              : 'Set up a recurring deadline to see it here.'
          }
          emptyAction={
            <Link
              href="/compliance/recurring/new"
              className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action"
            >
              Create Recurring
            </Link>
          }
          rowActions={(r) => (
            <ActionMenu
              label={`Actions for ${r.name}`}
              sections={menu(r)}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
            />
          )}
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (next: number) => setPage(next),
            onSort: () => undefined,
          }}
        />
      </div>
    </div>
  );
}
