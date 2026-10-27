'use client';

import type { TaskOverviewQuery, TaskProgress, TaskRow } from '@firmivra/types';
import {
  ActionMenu,
  BulkBar,
  Button,
  type Column,
  Input,
  Modal,
  Select,
  Table,
  Toast,
} from '@firmivra/ui';
import {
  Archive,
  ArrowsClockwise,
  CalendarBlank,
  CheckCircle,
  Copy,
  DotsThreeVertical,
  Eye,
  Flag,
  PencilSimple,
  Prohibit,
  Repeat,
  Spinner,
  UserSwitch,
  FloppyDisk,
  ArrowCounterClockwise,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useMembers } from './task-data';
import {
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  PriorityPill,
  StatusPill,
  TASKS_KEY,
  TASK_ERRORS,
  dueText,
  shortName,
} from './task-shared';
import { OriginLink, useOriginNavigate } from '../../../../../components/origin-link';

type Dialog =
  | { kind: 'reassign' | 'due' | 'priority' | 'progress'; ids: string[] }
  | { kind: 'confirm'; action: 'CANCEL' | 'ARCHIVE'; ids: string[] }
  | { kind: 'template'; task: TaskRow };

interface MenuItem {
  label: string;
  icon: Icon;
  onSelect: () => void;
  danger?: boolean;
}

/** What a table of tasks offers: sort, page, select, row menu and the bulk bar. */
export function TaskTable({
  query,
  onQuery,
  caption,
  emptyText,
  hideBulk,
  compact,
  inlineStatus,
  newTaskHref = '/tasks/new',
}: {
  query: TaskOverviewQuery;
  onQuery: (change: Partial<TaskOverviewQuery>) => void;
  caption: string;
  emptyText?: string;
  hideBulk?: boolean;
  /** A service workspace's short list (SH4): title, due date, status and the same menu. */
  compact?: boolean;
  /** The status as a dropdown on each open or completed task (SH4). */
  inlineStatus?: boolean;
  /** Where Add Task goes: a service workspace passes its client, service and period. */
  newTaskHref?: string;
}) {
  const router = useRouter();
  const toOrigin = useOriginNavigate();
  // From a service workspace, a task's own pages get Back to the workspace (SH1).
  const go = (href: string) => (compact ? toOrigin(href) : router.push(href));
  const list = useApiQuery([...TASKS_KEY, 'overview', query], () => api.taskWork.overview(query));
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const rows = list.data?.items ?? [];
  const options = { invalidate: [...TASKS_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) => setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' });
  const complete = useApiMutation((id: string) => api.taskWork.complete(id), options);
  const reopen = useApiMutation((id: string) => api.taskWork.reopen(id), options);
  const progress = useApiMutation(
    (v: { id: string; progress: TaskProgress }) =>
      api.taskWork.setProgress(v.id, { progress: v.progress }),
    options,
  );
  /** The inline status: a stage of an open task, Completed, or a completed task reopened. */
  const setStatus = (t: TaskRow, value: string) => {
    if (value === 'DONE') {
      complete.mutate(t.id, { onSuccess: done(`${t.title} completed.`), onError: fail });
    } else if (value === 'REOPEN') {
      reopen.mutate(t.id, { onSuccess: done(`${t.title} reopened.`), onError: fail });
    } else {
      progress.mutate(
        { id: t.id, progress: value as TaskProgress },
        {
          onSuccess: done(`${t.title}: ${PROGRESS_LABEL[value as TaskProgress]}.`),
          onError: fail,
        },
      );
    }
  };
  const statusCell = (t: TaskRow) =>
    inlineStatus && t.status !== 'CANCELLED' ? (
      <select
        aria-label={`Status of ${t.title}`}
        value={t.status === 'DONE' ? 'DONE' : t.progress}
        disabled={complete.isPending || reopen.isPending || progress.isPending}
        onChange={(e) => setStatus(t, e.target.value)}
        className="min-h-8 rounded-control border border-border bg-surface px-2 text-xs text-text"
      >
        {t.status === 'DONE' ? (
          <>
            <option value="DONE">Completed</option>
            <option value="REOPEN">Reopen</option>
          </>
        ) : (
          <>
            {Object.entries(PROGRESS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="DONE">Completed</option>
          </>
        )}
      </select>
    ) : (
      <StatusPill task={t} />
    );
  const duplicate = useApiMutation((id: string) => api.taskWork.duplicate(id), options);
  const bulk = useApiMutation(
    (body: Parameters<typeof api.taskWork.bulk>[0]) => api.taskWork.bulk(body),
    options,
  );
  const page = Number(query.page ?? 1);
  const size = Number(query.pageSize ?? 10);
  const sort = { id: query.sort ?? 'due', descending: query.direction === 'desc' };

  const columns: Column<TaskRow>[] = [
    {
      id: 'title',
      label: 'Task Name',
      sortable: true,
      cell: (t) => (
        <Link
          href={`/tasks/${t.id}`}
          data-testid="task-link"
          title={t.title}
          className="block max-w-56 truncate font-medium text-heading hover:underline"
        >
          {t.title}
        </Link>
      ),
    },
    {
      id: 'client',
      label: 'Client',
      sortable: true,
      cell: (t) => <span className="text-link">{t.client.displayName}</span>,
    },
    {
      id: 'related',
      label: 'Related To',
      cell: (t) => t.engagement?.title ?? t.service?.name ?? '—',
    },
    {
      id: 'due',
      label: 'Due Date',
      sortable: true,
      cell: (t) => (
        <span
          data-overdue={t.overdue || undefined}
          aria-label={t.overdue ? `${dueText(t)} (overdue)` : undefined}
          className={t.overdue ? 'font-semibold text-danger' : ''}
        >
          {dueText(t)}
        </span>
      ),
    },
    {
      id: 'priority',
      label: 'Priority',
      sortable: true,
      cell: (t) => <PriorityPill priority={t.priority} />,
    },
    { id: 'status', label: 'Status', sortable: true, cell: statusCell },
    {
      id: 'assigned',
      label: 'Assigned To',
      cell: (t) =>
        t.assignedTo ? (
          <span className="whitespace-nowrap">
            {shortName(t.assignedTo.name)}
            {t.additionalAssigneeCount > 0 ? (
              <span className="text-muted"> +{t.additionalAssigneeCount}</span>
            ) : null}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  const menu = (t: TaskRow): MenuItem[] => {
    const open = t.status === 'OPEN';
    return [
      { label: 'View', icon: Eye, onSelect: () => go(`/tasks/${t.id}`) },
      { label: 'Edit', icon: PencilSimple, onSelect: () => go(`/tasks/${t.id}/edit`) },
      ...(open
        ? [
            {
              label: 'Mark as In Progress',
              icon: Spinner,
              onSelect: () =>
                progress.mutate(
                  { id: t.id, progress: 'IN_PROGRESS' },
                  { onSuccess: done('Marked in progress.'), onError: fail },
                ),
            },
            {
              label: 'Mark Complete',
              icon: CheckCircle,
              onSelect: () =>
                complete.mutate(t.id, { onSuccess: done(`${t.title} completed.`), onError: fail }),
            },
            {
              label: 'Reassign',
              icon: UserSwitch,
              onSelect: () => setDialog({ kind: 'reassign', ids: [t.id] }),
            },
            {
              label: 'Change Due Date',
              icon: CalendarBlank,
              onSelect: () => setDialog({ kind: 'due', ids: [t.id] }),
            },
            {
              label: 'Change Priority',
              icon: Flag,
              onSelect: () => setDialog({ kind: 'priority', ids: [t.id] }),
            },
          ]
        : [
            {
              label: 'Reopen',
              icon: ArrowCounterClockwise,
              onSelect: () =>
                reopen.mutate(t.id, { onSuccess: done(`${t.title} reopened.`), onError: fail }),
            },
          ]),
      {
        label: 'Duplicate',
        icon: Copy,
        onSelect: () =>
          duplicate.mutate(t.id, {
            onSuccess: (copy) => go(`/tasks/${copy.id}/edit`),
            onError: fail,
          }),
      },
      {
        label: 'Convert to Recurring',
        icon: Repeat,
        onSelect: () => go(`/tasks/${t.id}`),
      },
      {
        label: 'Save as Template',
        icon: FloppyDisk,
        onSelect: () => setDialog({ kind: 'template', task: t }),
      },
      ...(open
        ? [
            {
              label: 'Cancel Task',
              icon: Prohibit,
              danger: true,
              onSelect: () => setDialog({ kind: 'confirm', action: 'CANCEL', ids: [t.id] }),
            },
          ]
        : []),
      {
        label: 'Archive Task',
        icon: Archive,
        danger: true,
        onSelect: () => setDialog({ kind: 'confirm', action: 'ARCHIVE', ids: [t.id] }),
      },
    ];
  };

  const rowMenu = (t: TaskRow) => (
    <ActionMenu
      label={`Actions for ${t.title}`}
      trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
      sections={[{ items: menu(t) }]}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {!hideBulk && selected.length > 0 ? (
        <BulkBar
          count={selected.length}
          noun="tasks"
          actions={[
            {
              label: 'Reassign',
              icon: UserSwitch,
              onClick: () => setDialog({ kind: 'reassign', ids: selected }),
            },
            {
              label: 'Status',
              icon: ArrowsClockwise,
              onClick: () => setDialog({ kind: 'progress', ids: selected }),
            },
            {
              label: 'Due Date',
              icon: CalendarBlank,
              onClick: () => setDialog({ kind: 'due', ids: selected }),
            },
            {
              label: 'Priority',
              icon: Flag,
              onClick: () => setDialog({ kind: 'priority', ids: selected }),
            },
            {
              label: 'Complete',
              icon: CheckCircle,
              onClick: () =>
                bulk.mutate(
                  { action: 'COMPLETE', ids: selected },
                  {
                    onSuccess: (r) => {
                      setSelected([]);
                      setMessage({
                        text: `${r.updated} completed${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`,
                        tone: 'success',
                      });
                    },
                    onError: fail,
                  },
                ),
            },
            {
              label: 'Cancel',
              icon: Prohibit,
              danger: true,
              onClick: () => setDialog({ kind: 'confirm', action: 'CANCEL', ids: selected }),
            },
            {
              label: 'Archive',
              icon: Archive,
              danger: true,
              onClick: () => setDialog({ kind: 'confirm', action: 'ARCHIVE', ids: selected }),
            },
          ]}
        />
      ) : null}
      {compact ? (
        <div data-testid="task-list">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">
              {list.isError
                ? 'Tasks are not available right now.'
                : list.isPending
                  ? 'Loading…'
                  : (emptyText ?? 'No tasks yet.')}
            </p>
          ) : (
            <ul className="flex flex-col" aria-label={caption}>
              {rows.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 border-t border-divider py-2 text-sm first:border-t-0"
                >
                  <OriginLink
                    href={`/tasks/${t.id}`}
                    className="min-w-0 flex-1 truncate text-link hover:underline"
                  >
                    {t.title}
                  </OriginLink>
                  <span
                    className={`shrink-0 text-xs ${t.overdue ? 'font-semibold text-danger' : 'text-muted'}`}
                  >
                    {dueText(t)}
                  </span>
                  {statusCell(t)}
                  {rowMenu(t)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div data-testid="task-table" className="relative">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(t) => t.id}
            caption={caption}
            dense
            // One line per task in 12 px, as task/source/task.jpg draws the table (R1 firm audit).
            tableClassName="[&_th]:!text-xs [&_td]:!text-xs [&_td]:whitespace-nowrap"
            noun="tasks"
            pageSize={size}
            loading={list.isPending}
            emptyTitle={list.isError ? 'Tasks are not available' : 'No tasks'}
            emptyText={
              list.isError
                ? 'We could not load the tasks. Try again in a moment.'
                : (emptyText ?? 'Tasks that match will appear here.')
            }
            emptyAction={
              <Link
                href={newTaskHref}
                className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action"
              >
                Add Task
              </Link>
            }
            {...(hideBulk ? {} : { selection: { selected, onChange: setSelected } })}
            rowActions={rowMenu}
            server={{
              page: list.data?.page ?? 1,
              total: list.data?.total ?? 0,
              hasNext: (list.data?.page ?? 1) * size < (list.data?.total ?? 0),
              hasPrevious: (list.data?.page ?? 1) > 1,
              onNext: () => onQuery({ page: page + 1 }),
              onPrevious: () => onQuery({ page: Math.max(1, page - 1) }),
              onPage: (page) => onQuery({ page }),
              sort,
              onSort: (next) =>
                onQuery({
                  sort: next.id as TaskOverviewQuery['sort'],
                  direction: next.descending ? 'desc' : 'asc',
                  page: 1,
                }),
            }}
          />
        </div>
      )}
      {dialog && dialog.kind !== 'template' && dialog.kind !== 'confirm' ? (
        <ChangeDialog
          kind={dialog.kind}
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setSelected([]);
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
      {dialog?.kind === 'confirm' ? (
        <Modal
          open
          title={dialog.action === 'CANCEL' ? 'Cancel these tasks?' : 'Archive these tasks?'}
          subtitle={
            dialog.action === 'CANCEL'
              ? 'A cancelled task stays in the history.'
              : 'Archived tasks leave the lists and can be restored.'
          }
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Keep
              </Button>
              <Button
                disabled={bulk.isPending}
                onClick={() =>
                  bulk.mutate(
                    { action: dialog.action, ids: dialog.ids, confirm: true },
                    {
                      onSuccess: (r) => {
                        setDialog(null);
                        setSelected([]);
                        setMessage({ text: `${r.updated} updated.`, tone: 'success' });
                      },
                      onError: fail,
                    },
                  )
                }
              >
                {dialog.action === 'CANCEL' ? 'Cancel Tasks' : 'Archive Tasks'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">{dialog.ids.length} task(s).</p>
        </Modal>
      ) : null}
      {dialog?.kind === 'template' ? (
        <TemplateDialog
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}

/** Reassign, due date, priority and status for one task or the selected ones (the bulk call). */
function ChangeDialog({
  kind,
  ids,
  onClose,
  onDone,
}: {
  kind: 'reassign' | 'due' | 'priority' | 'progress';
  ids: string[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { members } = useMembers();
  const [who, setWho] = useState('');
  const [date, setDate] = useState('');
  const [priority, setPriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [stage, setStage] = useState<keyof typeof PROGRESS_LABEL>('IN_PROGRESS');
  const bulk = useApiMutation(
    () => {
      if (kind === 'reassign')
        return api.taskWork.bulk({ action: 'REASSIGN', ids, assignedUserId: who || null });
      if (kind === 'due') return api.taskWork.bulk({ action: 'SET_DUE_DATE', ids, dueOn: date });
      if (kind === 'priority') return api.taskWork.bulk({ action: 'SET_PRIORITY', ids, priority });
      return api.taskWork.bulk({ action: 'SET_PROGRESS', ids, progress: stage });
    },
    { invalidate: [...TASKS_KEY] },
  );
  const title = {
    reassign: 'Reassign',
    due: 'Change Due Date',
    priority: 'Change Priority',
    progress: 'Change Status',
  }[kind];
  return (
    <Modal
      open
      title={title}
      subtitle={`${ids.length} task(s)`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={bulk.isPending || (kind === 'due' && !date)}
            onClick={() =>
              bulk.mutate(undefined, {
                onSuccess: (r) =>
                  onDone(
                    `${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`,
                  ),
              })
            }
          >
            Apply
          </Button>
        </>
      }
    >
      {kind === 'reassign' ? (
        <Select
          label="Assign to"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          options={[
            { value: '', label: 'Unassigned' },
            ...members.map((m) => ({ value: m.userId, label: m.name })),
          ]}
        />
      ) : null}
      {kind === 'due' ? (
        <Input
          label="New due date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      ) : null}
      {kind === 'priority' ? (
        <Select
          label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
          options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
        />
      ) : null}
      {kind === 'progress' ? (
        <Select
          label="Status"
          value={stage}
          onChange={(e) => setStage(e.target.value as typeof stage)}
          options={Object.entries(PROGRESS_LABEL).map(([value, label]) => ({ value, label }))}
        />
      ) : null}
      {bulk.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(bulk.error, TASK_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

function TemplateDialog({
  task,
  onClose,
  onDone,
}: {
  task: TaskRow;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState(task.title);
  const save = useApiMutation(() => api.taskWork.saveAsTemplate(task.id, { name: name.trim() }), {
    invalidate: [...TASKS_KEY],
  });
  return (
    <Modal
      open
      title="Save as Template"
      subtitle="A template keeps the type, priority, checklist and reminders, not the client."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => onDone('Template saved.') })}
          >
            Save Template
          </Button>
        </>
      }
    >
      <Input
        label="Template name"
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
      />
      {save.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(save.error, TASK_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
