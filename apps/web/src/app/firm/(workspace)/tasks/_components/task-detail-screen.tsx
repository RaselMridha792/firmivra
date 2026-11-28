'use client';

import { DOCUMENT_ERRORS, type TaskDetail } from '@firmivra/types';
import { Badge, Button, Checkbox, Input, Modal, Select, Toast } from '@firmivra/ui';
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
import { requiredOpenText } from './task-table';
import { safeOrigin, withOrigin } from '../../../../../lib/origin';
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
  timeText,
} from './task-shared';
import { beforeText } from './task-form-parts';
import { ReminderHistory } from './task-reminder-history';
import { relatedLinks } from './new-task-href';
import { useFirm } from '../../../../../components/firm-context';
import { OriginLink } from '../../../../../components/origin-link';
import { useMe } from '../../../../../components/signed-in';
import { AcknowledgmentCard, DiscussionCard } from './task-collab';

const linkText = 'font-medium text-link hover:underline';

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

/**
 * T-C06: a task's file, from the task itself: its name opens the document (Back returns here),
 * Download (the document's own permission and scan checks apply), the client-visible switch and
 * Remove (the file stays in the client's Documents).
 */
function AttachmentRow({
  taskId,
  attachment: a,
  onDone,
  onFail,
}: {
  taskId: string;
  attachment: TaskDetail['attachments'][number];
  onDone: (text: string) => void;
  onFail: (e: unknown) => void;
}) {
  const options = { invalidate: [...TASKS_KEY] };
  const visible = useApiMutation(
    () => api.taskWork.updateAttachment(taskId, a.id, { clientVisible: !a.clientVisible }),
    options,
  );
  const remove = useApiMutation(() => api.taskWork.removeAttachment(taskId, a.id), options);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const link = await api.documents.download(a.documentId);
      window.location.assign(link.url);
    } catch (e) {
      onFail(e);
    } finally {
      setBusy(false);
    }
  };
  const action = 'text-sm font-medium text-link hover:underline disabled:text-muted';
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <OriginLink
        href={`/documents/${a.documentId}`}
        className="min-w-0 truncate font-medium text-link hover:underline"
      >
        {a.fileName}
      </OriginLink>
      <span className="flex flex-wrap items-center gap-3">
        <Badge tone={a.clientVisible ? 'info' : 'neutral'}>
          {a.clientVisible ? 'Visible to client' : 'Staff only'}
        </Badge>
        <button type="button" className={action} disabled={busy} onClick={() => void download()}>
          Download
        </button>
        <button
          type="button"
          className={action}
          disabled={visible.isPending}
          onClick={() =>
            visible.mutate(undefined, {
              onSuccess: () =>
                onDone(
                  a.clientVisible
                    ? `${a.fileName} is staff only now.`
                    : `${a.fileName} is visible to the client now.`,
                ),
              onError: onFail,
            })
          }
        >
          {a.clientVisible ? 'Make Staff Only' : 'Show to Client'}
        </button>
        <button
          type="button"
          className="text-sm font-medium text-danger hover:underline disabled:text-muted"
          disabled={remove.isPending}
          aria-label={`Remove ${a.fileName}`}
          onClick={() =>
            remove.mutate(undefined, {
              onSuccess: () =>
                onDone(`${a.fileName} removed from the task; it stays in the client's Documents.`),
              onError: onFail,
            })
          }
        >
          Remove
        </button>
      </span>
    </li>
  );
}

/** /tasks/[id]: one task with its actions, checklist, reminders, dependency, attachments and notes. */
export function TaskDetailScreen({
  id,
  convertToRecurring = false,
}: {
  id: string;
  /** Opened from a list's Convert to Recurring: the setup is open on arrival. */
  convertToRecurring?: boolean;
}) {
  const router = useRouter();
  const query = useApiQuery([...TASKS_KEY, 'task', id], () => api.taskWork.task(id));
  const t: TaskDetail | undefined = query.data;
  // T-D16: Owner and Admin may change the series a task came from.
  const { role } = useFirm();
  // Q36: who is signed in, so the discussion knows which comments are theirs to change.
  const { me } = useMe();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<'template' | 'recurring' | 'archive' | 'scope' | null>(
    convertToRecurring ? 'recurring' : null,
  );
  const options = { invalidate: [...TASKS_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) => setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' });
  const complete = useApiMutation(() => api.taskWork.complete(id), options);
  const reopen = useApiMutation(() => api.taskWork.reopen(id), options);
  const duplicate = useApiMutation(() => api.taskWork.duplicate(id), options);
  const archive = useApiMutation(() => api.taskWork.archive(id), options);
  const restore = useApiMutation(() => api.taskWork.restore(id), options);
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
            {/* T-D16: a task a series made asks which to change: it, or the series from now on. */}
            {t.series ? (
              <button
                type="button"
                className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
                onClick={() => setDialog('scope')}
              >
                <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
              </button>
            ) : (
              <Link
                href={`/tasks/${id}/edit`}
                className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
              >
                <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
              </Link>
            )}
            {t.status === 'OPEN' ? (
              <>
                <button
                  type="button"
                  className={btn}
                  disabled={complete.isPending || !!requiredOpenText(t.checklist.requiredOpen)}
                  aria-describedby={t.checklist.requiredOpen ? 'complete-blocked' : undefined}
                  onClick={() =>
                    complete.mutate(undefined, {
                      onSuccess: done('Task completed.'),
                      onError: fail,
                    })
                  }
                >
                  <CheckCircle aria-hidden weight="fill" className="size-4" /> Complete
                </button>
                {/* T-C12: why Complete is off, before anyone clicks it. */}
                {requiredOpenText(t.checklist.requiredOpen) ? (
                  <span id="complete-blocked" className="text-xs text-muted" role="note">
                    {requiredOpenText(t.checklist.requiredOpen)}
                  </span>
                ) : null}
              </>
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
            {/* T-C13: an archived task is restored here; Archive asks first. */}
            {t.archivedAt ? (
              <button
                type="button"
                className={btn}
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(undefined, { onSuccess: done('Task restored.'), onError: fail })
                }
              >
                <ArrowCounterClockwise aria-hidden weight="fill" className="size-4" /> Restore
              </button>
            ) : (
              <button
                type="button"
                className={`${btn} text-danger`}
                onClick={() => setDialog('archive')}
              >
                <Archive aria-hidden weight="fill" className="size-4" /> Archive
              </button>
            )}
          </div>
        ) : null}
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {t ? <AcknowledgmentCard taskId={t.id} /> : null}
        <Card title="Details" testId="detail-info">
          {t ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              {(
                [
                  // Review 2 (N05): the client and the related engagement open their records.
                  [
                    'Client',
                    <OriginLink key="client" href={`/clients/${t.client.id}`} className={linkText}>
                      {t.client.displayName}
                    </OriginLink>,
                  ],
                  ...(t.deadline
                    ? [
                        [
                          'Compliance Deadline',
                          <OriginLink
                            key="deadline"
                            href={`/compliance/${t.deadline.id}`}
                            className={linkText}
                            data-testid="deadline-backlink"
                          >
                            {t.deadline.name}
                          </OriginLink>,
                        ] as [string, ReactNode],
                      ]
                    : []),
                  [
                    'Related To',
                    // T-C10: each record opens its page; a custom note is labelled, never a link.
                    relatedLinks(t).length ? (
                      <span key="related" className="flex flex-col gap-1" data-testid="related-to">
                        {relatedLinks(t).map((l) =>
                          l.href ? (
                            <OriginLink key={l.key} href={l.href} className={linkText}>
                              {l.label}
                            </OriginLink>
                          ) : (
                            <span key={l.key}>{l.label}</span>
                          ),
                        )}
                      </span>
                    ) : (
                      '—'
                    ),
                  ],
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
                  // T-C03: the series it was made by opens its overview.
                  ...(t.series
                    ? [
                        [
                          'Series',
                          <OriginLink
                            key="series"
                            href={`/tasks/recurring/${t.series.id}`}
                            className={linkText}
                          >
                            {t.series.title}
                          </OriginLink>,
                        ],
                      ]
                    : []),
                ] as [string, ReactNode][]
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
                    <li key={`${r.daysBefore}-${r.timeOfDay}-${r.amount}-${r.unit}`}>
                      {r.unit && r.amount
                        ? beforeText(r.amount, r.unit)
                        : r.daysBefore === 0
                          ? 'Same day'
                          : `${r.daysBefore} day${r.daysBefore === 1 ? '' : 's'} before`}
                      {r.timeOfDay ? `, at ${timeText(r.timeOfDay)}` : ''}
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
              <ReminderHistory taskId={id} />
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
                <AttachmentRow
                  key={a.id}
                  taskId={id}
                  attachment={a}
                  onDone={(text) => done(text)()}
                  onFail={(e) =>
                    setMessage({
                      text: errorMessage(e, { ...DOCUMENT_ERRORS, ...TASK_ERRORS }),
                      tone: 'error',
                    })
                  }
                />
              ))}
            </ul>
          )}
        </Card>
        <Card title="Internal Notes (Not Visible to Clients)" testId="detail-notes">
          <p className="whitespace-pre-line text-sm text-text">
            {t?.internalNotes || <span className="text-muted">No internal notes.</span>}
          </p>
        </Card>
        {t ? <DiscussionCard taskId={t.id} meId={me.user.id} /> : null}
      </div>
      {dialog === 'scope' && t?.series ? (
        <Modal
          open
          title="Edit a recurring task"
          subtitle={`This task was made by the series ${t.series.title}.`}
          onClose={() => setDialog(null)}
        >
          <div className="flex flex-col gap-2" data-testid="edit-scope">
            <Link
              href={`/tasks/${id}/edit`}
              className="rounded-control border border-border p-3 hover:bg-canvas"
            >
              <span className="block font-medium text-heading">This occurrence</span>
              <span className="block text-sm text-muted">
                Change only this task. The series and its other tasks stay as they are.
              </span>
            </Link>
            {manages ? (
              <Link
                href={`/tasks/recurring/${t.series.id}/edit`}
                className="rounded-control border border-border p-3 hover:bg-canvas"
              >
                <span className="block font-medium text-heading">This and future occurrences</span>
                <span className="block text-sm text-muted">
                  Change the series: tasks it makes from now on follow it. Tasks already made, this
                  one included, keep what they have.
                </span>
              </Link>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {dialog === 'archive' && t ? (
        <Modal
          open
          title="Archive this task?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={archive.isPending}
                onClick={() =>
                  archive.mutate(undefined, {
                    onSuccess: () => router.push('/tasks?view=archived'),
                    onError: (e) => {
                      setDialog(null);
                      fail(e);
                    },
                  })
                }
              >
                Archive Task
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            {t.title} leaves the task lists. It stays under Archived, where Restore brings it back.
          </p>
        </Modal>
      ) : null}
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
      {dialog === 'recurring' && t && !t.series ? (
        <ConvertDialog
          task={t}
          onClose={() => setDialog(null)}
          // The series keeps this page's way back (a tax return's Overview, say).
          onDone={(sid) => {
            const from = safeOrigin(new URLSearchParams(window.location.search).get('from'));
            router.push(
              from ? withOrigin(`/tasks/recurring/${sid}`, from) : `/tasks/recurring/${sid}`,
            );
          }}
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
  const [applyChecklist, setApplyChecklist] = useState(true);
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
        applyChecklist: applyChecklist && task.checklistItems.length > 0,
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
      {/* T-C11: the checklist for every occurrence, each its own copy. */}
      <div className="mt-3" data-testid="convert-apply-checklist">
        <Checkbox
          label="Apply the same checklist to all occurrences"
          checked={applyChecklist && task.checklistItems.length > 0}
          disabled={task.checklistItems.length === 0}
          onChange={(e) => setApplyChecklist(e.target.checked)}
        />
        <p className="ml-8 text-xs text-muted">
          {task.checklistItems.length === 0
            ? 'This task has no checklist.'
            : `Each occurrence gets its own copy of the ${task.checklistItems.length} step${task.checklistItems.length === 1 ? '' : 's'}.`}
        </p>
      </div>
      {convert.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(convert.error, TASK_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
