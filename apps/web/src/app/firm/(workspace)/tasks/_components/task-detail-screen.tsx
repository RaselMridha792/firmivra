'use client';

import type { TaskDetail } from '@firmivra/types';
import { Badge, Button, Input, Modal, Select, Toast } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  ArrowLeft,
  CheckCircle,
  Copy,
  FloppyDisk,
  PencilSimple,
  Repeat,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  PriorityPill,
  StatusPill,
  TASKS_KEY,
  TASK_ERRORS,
  dueText,
  shortName,
  stamp,
} from './task-shared';

const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
function Card({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <h2 className="mb-3 font-display text-lg font-bold text-heading">{title}</h2>
      {children}
    </section>
  );
}
const btn =
  'inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';

/** /tasks/[id]: one task with its actions, checklist, reminders, dependency, attachments and notes. */
export function TaskDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const query = useApiQuery([...TASKS_KEY, 'task', id], () => api.taskWork.task(id));
  const t: TaskDetail | undefined = query.data;
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<'template' | 'recurring' | null>(null);
  const options = { invalidate: [...TASKS_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) => setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' });
  const complete = useApiMutation(() => api.taskWork.complete(id), options);
  const reopen = useApiMutation(() => api.taskWork.reopen(id), options);
  const duplicate = useApiMutation(() => api.taskWork.duplicate(id), options);
  const archive = useApiMutation(() => api.taskWork.archive(id), options);
  const item = useApiMutation(
    (v: { itemId: string; done: boolean }) =>
      v.done ? api.taskWork.reopenItem(id, v.itemId) : api.taskWork.completeItem(id, v.itemId),
    options,
  );
  const note = query.isPending ? 'Loading…' : 'This task is not available right now.';
  const total = t?.checklistItems.length ?? 0;
  const doneCount = t?.checklistItems.filter((c) => c.completedAt).length ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="task-detail">
      <Link href="/tasks" className="flex w-fit items-center gap-2 text-sm font-medium text-link">
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Tasks
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-heading" data-testid="task-title">
            {t?.title ?? 'Task details'}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base text-muted">
            {t ? (
              <>
                <StatusPill task={t} />
                <PriorityPill priority={t.priority} />
                {t.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                {t.archivedAt ? <Badge tone="neutral">Archived</Badge> : null}
                {t.type ? <span>{t.type.name}</span> : null}
              </>
            ) : (
              note
            )}
          </p>
        </div>
        {t ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Task actions">
            <Link
              href={`/tasks/${id}/edit`}
              className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
            >
              <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
            </Link>
            {t.status === 'OPEN' ? (
              <button
                type="button"
                className={btn}
                disabled={complete.isPending}
                onClick={() =>
                  complete.mutate(undefined, { onSuccess: done('Task completed.'), onError: fail })
                }
              >
                <CheckCircle aria-hidden weight="fill" className="size-4" /> Complete
              </button>
            ) : (
              <button
                type="button"
                className={btn}
                onClick={() =>
                  reopen.mutate(undefined, { onSuccess: done('Task reopened.'), onError: fail })
                }
              >
                <ArrowCounterClockwise aria-hidden weight="fill" className="size-4" /> Reopen
              </button>
            )}
            <button
              type="button"
              className={btn}
              onClick={() =>
                duplicate.mutate(undefined, {
                  onSuccess: (copy) => router.push(`/tasks/${copy.id}/edit`),
                  onError: fail,
                })
              }
            >
              <Copy aria-hidden weight="fill" className="size-4" /> Duplicate
            </button>
            <button type="button" className={btn} onClick={() => setDialog('template')}>
              <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save as Template
            </button>
            {t.series ? null : (
              <button type="button" className={btn} onClick={() => setDialog('recurring')}>
                <Repeat aria-hidden weight="fill" className="size-4" /> Convert to Recurring
              </button>
            )}
            <button
              type="button"
              className={`${btn} text-danger`}
              onClick={() =>
                archive.mutate(undefined, { onSuccess: () => router.push('/tasks'), onError: fail })
              }
            >
              <Archive aria-hidden weight="fill" className="size-4" /> Archive
            </button>
          </div>
        ) : null}
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Details" testId="detail-info">
          {t ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              {(
                [
                  ['Client', t.client.displayName],
                  ['Related To', t.engagement?.title ?? '—'],
                  ['Service', t.service?.name ?? '—'],
                  ['Assigned To', t.assignedTo ? shortName(t.assignedTo.name) : '—'],
                  ['Also assigned', t.additionalAssignees.map((a) => a.name).join(', ') || '—'],
                  ['Start Date', t.startOn ?? '—'],
                  ['Due', dueText(t)],
                  ['Client Visible', t.clientVisible ? 'Yes' : 'No'],
                  [
                    'Created',
                    `${stamp(t.createdAt)}${t.createdBy ? ` by ${t.createdBy.name}` : ''}`,
                  ],
                  ...(t.completedAt
                    ? [
                        [
                          'Completed',
                          `${stamp(t.completedAt)}${t.completedBy ? ` by ${t.completedBy.name}` : ''}`,
                        ],
                      ]
                    : []),
                  ...(t.series ? [['Series', t.series.title]] : []),
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text">{k}</dt>
                  <dd className="text-heading">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={quiet}>{note}</p>
          )}
          {t?.details ? (
            <p className="mt-3 whitespace-pre-line text-sm text-text">{t.details}</p>
          ) : null}
        </Card>
        <Card title="Checklist / Subtasks" testId="detail-checklist">
          {!t || total === 0 ? (
            <p className={quiet}>{t ? 'No checklist items.' : note}</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-text" data-testid="checklist-progress">
                {doneCount} of {total} done
              </p>
              <ul className="flex flex-col gap-1">
                {t.checklistItems.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5"
                      aria-label={c.label}
                      checked={!!c.completedAt}
                      disabled={t.status !== 'OPEN' || item.isPending}
                      onChange={() =>
                        item.mutate({ itemId: c.id, done: !!c.completedAt }, { onError: fail })
                      }
                    />
                    <span className={c.completedAt ? 'text-muted line-through' : 'text-heading'}>
                      {c.label}
                    </span>
                    {c.required ? <Badge tone="warning">Required</Badge> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="Reminders & Dependencies" testId="detail-reminders">
          {t ? (
            <div className="flex flex-col gap-3 text-sm">
              {t.reminders.length === 0 ? (
                <p className={quiet}>No reminders.</p>
              ) : (
                <ul className="text-heading">
                  {t.reminders.map((r) => (
                    <li key={`${r.daysBefore}-${r.timeOfDay}`}>
                      {r.daysBefore === 0
                        ? 'Same day'
                        : `${r.daysBefore} day${r.daysBefore === 1 ? '' : 's'} before`}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-text">
                Depends on:{' '}
                {t.dependsOn ? (
                  <Link href={`/tasks/${t.dependsOn.id}`} className="text-link">
                    {t.dependsOn.title}
                  </Link>
                ) : (
                  'No prerequisite'
                )}
                {t.blocked ? <Badge tone="danger">Blocked</Badge> : null}
              </p>
              {t.blockedReason ? <p className="text-text">Blocked: {t.blockedReason}</p> : null}
            </div>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Card>
        <Card title="Attachments" testId="detail-attachments">
          {!t || t.attachments.length === 0 ? (
            <p className={quiet}>{t ? 'No attachments.' : note}</p>
          ) : (
            <ul className="divide-y divide-divider text-sm">
              {t.attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-heading">{a.fileName}</span>
                  <Badge tone={a.clientVisible ? 'info' : 'neutral'}>
                    {a.clientVisible ? 'Visible to client' : 'Staff only'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Internal Notes (Not Visible to Clients)" testId="detail-notes">
          <p className="whitespace-pre-line text-sm text-text">
            {t?.internalNotes || <span className="text-muted">No internal notes.</span>}
          </p>
        </Card>
      </div>
      {dialog === 'template' && t ? (
        <TemplateDialog
          task={t}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            done(text)();
          }}
        />
      ) : null}
      {dialog === 'recurring' && t ? (
        <ConvertDialog
          task={t}
          onClose={() => setDialog(null)}
          onDone={(sid) => router.push(`/tasks/recurring/${sid}`)}
        />
      ) : null}
    </div>
  );
}

function TemplateDialog({
  task,
  onClose,
  onDone,
}: {
  task: TaskDetail;
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

function ConvertDialog({
  task,
  onClose,
  onDone,
}: {
  task: TaskDetail;
  onClose: () => void;
  onDone: (seriesId: string) => void;
}) {
  const [interval, setInterval] = useState('1');
  const [unit, setUnit] = useState<'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR'>('MONTH');
  const convert = useApiMutation(
    () =>
      api.taskWork.convertToRecurring(task.id, {
        recurrence: {
          interval: Math.max(1, Number(interval) || 1),
          unit,
          pattern: {},
          endMode: 'NEVER',
          endAfterCount: null,
          endOn: null,
          holidayRule: 'NEXT_BUSINESS_DAY',
        },
      }),
    { invalidate: [...TASKS_KEY] },
  );
  return (
    <Modal
      open
      title="Convert to Recurring"
      subtitle="This task becomes the first one of a new series."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={convert.isPending}
            onClick={() => convert.mutate(undefined, { onSuccess: (s) => onDone(s.id) })}
          >
            Convert
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Repeat every"
          type="number"
          min={1}
          max={365}
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
        />
        <Select
          label="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as typeof unit)}
          options={[
            { value: 'DAY', label: 'Day(s)' },
            { value: 'WEEK', label: 'Week(s)' },
            { value: 'MONTH', label: 'Month(s)' },
            { value: 'QUARTER', label: 'Quarter(s)' },
            { value: 'YEAR', label: 'Year(s)' },
          ]}
        />
      </div>
      {convert.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(convert.error, TASK_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
