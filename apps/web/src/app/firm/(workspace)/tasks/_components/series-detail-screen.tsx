'use client';

import type { TaskOccurrence } from '@firmivra/types';
import { Badge, Button, Modal, Select, Toast } from '@firmivra/ui';
import { ArrowLeft, Pause, PencilSimple, Play, Stop } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useFirm } from '../../../../../components/firm-context';
import { OriginLink } from '../../../../../components/origin-link';
import { PRIORITY_LABEL, TASKS_KEY, TASK_ERRORS, dayText, shortName } from './task-shared';

const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
const TONE = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  ENDED: 'neutral',
  ARCHIVED: 'neutral',
} as const;
/**
 * T-C03: an occurrence's status in words: Upcoming, Skipped, Failed, or for a made one where its
 * task is now (Open, Completed, Cancelled).
 */
function occurrenceLabel(o: TaskOccurrence): string {
  if (o.state === 'GENERATED')
    return o.task?.status === 'DONE'
      ? 'Completed'
      : o.task?.status === 'CANCELLED'
        ? 'Cancelled'
        : 'Open';
  if (o.state === 'SCHEDULED') return 'Upcoming';
  return o.state === 'SKIPPED' ? 'Skipped' : 'Failed';
}

/** Why it was skipped or failed, and the tries while a failing one is retried. */
function occurrenceNote(o: TaskOccurrence): string | null {
  if (o.state === 'SKIPPED')
    return o.skipReason === 'REPLACED'
      ? 'Skipped: the repeat rule changed.'
      : o.skipReason
        ? `Skipped: ${o.skipReason}`
        : 'Skipped.';
  if (o.failureCode && (o.state === 'FAILED' || o.state === 'SCHEDULED'))
    return `${o.state === 'FAILED' ? 'Could not make the task' : 'Retrying'} after ${o.attempts} ${
      o.attempts === 1 ? 'try' : 'tries'
    } (${o.failureCode}).`;
  return null;
}

const OCC = {
  SCHEDULED: 'info',
  GENERATED: 'success',
  SKIPPED: 'neutral',
  FAILED: 'danger',
} as const;
function Card({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <h2 className="mb-3 font-display text-lg font-bold text-heading">{title}</h2>
      {children}
    </section>
  );
}
const btn =
  'inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';

/** /tasks/recurring/[id]: one series, its settings, its occurrences, and pause, resume, stop, skip. */
export function SeriesDetailScreen({ id }: { id: string }) {
  const series = useApiQuery([...TASKS_KEY, 'series', id], () => api.taskWork.series(id));
  // T-D16: Owner and Admin edit a series (the API refuses others).
  const { role } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  // T-C03: upcoming, made, skipped or failed occurrences, one state at a time or all.
  const [state, setState] = useState<TaskOccurrence['state'] | ''>('');
  const occ = useApiQuery([...TASKS_KEY, 'series', id, 'occurrences', state], () =>
    api.taskWork.occurrences(id, { pageSize: 50, ...(state ? { state } : {}) }),
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [skipAll, setSkipAll] = useState(false);
  const s = series.data;
  const options = { invalidate: [...TASKS_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) => setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' });
  const pause = useApiMutation(() => api.taskWork.pauseSeries(id), options);
  const resume = useApiMutation(() => api.taskWork.resumeSeries(id), options);
  const stop = useApiMutation(() => api.taskWork.stopSeries(id), options);
  const skip = useApiMutation((oid: string) => api.taskWork.skipOccurrence(id, oid), options);
  const skipFuture = useApiMutation(() => api.taskWork.skipFuture(id, { confirm: true }), options);
  const note = series.isPending ? 'Loading…' : 'This series is not available right now.';
  const rows = occ.data?.items ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="series-detail">
      <Link href="/tasks" className="flex w-fit items-center gap-2 text-sm font-medium text-link">
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Tasks
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-heading" data-testid="series-title">
            {s?.title ?? 'Recurring task'}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base text-muted">
            {s ? (
              <>
                <Badge tone={TONE[s.status]}>
                  {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                </Badge>
                {s.summary} · {/* Review 2 (N05): the client opens its record. */}
                <OriginLink
                  href={`/clients/${s.client.id}`}
                  className="font-medium text-link hover:underline"
                >
                  {s.client.displayName}
                </OriginLink>
              </>
            ) : (
              note
            )}
          </p>
        </div>
        {s ? (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Series actions"
          >
            {/* T-D16: Edit Series, for this and future occurrences (while it still runs). */}
            {manages && (s.status === 'ACTIVE' || s.status === 'PAUSED') ? (
              <Link
                href={`/tasks/recurring/${id}/edit`}
                className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
              >
                <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit Series
              </Link>
            ) : null}
            {s.status === 'ACTIVE' ? (
              <button
                type="button"
                className={btn}
                onClick={() =>
                  pause.mutate(undefined, { onSuccess: done('Series paused.'), onError: fail })
                }
              >
                <Pause aria-hidden weight="fill" className="size-4" /> Pause
              </button>
            ) : null}
            {s.status === 'PAUSED' ? (
              <button
                type="button"
                className={btn}
                onClick={() =>
                  resume.mutate(undefined, { onSuccess: done('Series resumed.'), onError: fail })
                }
              >
                <Play aria-hidden weight="fill" className="size-4" /> Resume
              </button>
            ) : null}
            {s.status === 'ACTIVE' || s.status === 'PAUSED' ? (
              <>
                <button type="button" className={btn} onClick={() => setSkipAll(true)}>
                  Skip All Future
                </button>
                <button
                  type="button"
                  className={`${btn} text-danger`}
                  onClick={() =>
                    stop.mutate(undefined, { onSuccess: done('Series stopped.'), onError: fail })
                  }
                >
                  <Stop aria-hidden weight="fill" className="size-4" /> Stop
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Settings" testId="series-settings">
          {s ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              {(
                [
                  ['Type', s.type?.name ?? '—'],
                  ['Priority', PRIORITY_LABEL[s.priority]],
                  [
                    'Assigned To',
                    s.assignedTo ? shortName(s.assignedTo.name) : "The client's team",
                  ],
                  ['Also assigned', s.extraAssignees.map((a) => a.name).join(', ') || '—'],
                  ['Starts', dayText(s.recurrence.startOn)],
                  [
                    'Ends',
                    s.recurrence.endMode === 'NEVER'
                      ? 'Never'
                      : s.recurrence.endMode === 'AFTER_COUNT'
                        ? `After ${s.recurrence.endAfterCount} occurrences`
                        : s.recurrence.endOn
                          ? dayText(s.recurrence.endOn)
                          : '—',
                  ],
                  [
                    'Holidays',
                    s.recurrence.holidayRule === 'NONE'
                      ? 'Not adjusted'
                      : s.recurrence.holidayRule === 'NEXT_BUSINESS_DAY'
                        ? 'Next business day'
                        : 'Previous business day',
                  ],
                  ['Made so far', String(s.generatedCount)],
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
        </Card>
        {/* T-C11: the checklist each occurrence gets its own copy of. */}
        <Card title="Checklist for Each Occurrence" testId="series-checklist">
          {!s || s.checklist.length === 0 ? (
            <p className={quiet}>{s ? 'Occurrences start without a checklist.' : note}</p>
          ) : (
            <>
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-heading">
                {s.checklist.map((c, i) => (
                  <li key={`${i}-${c.label}`}>
                    {c.label}
                    {c.required ? <span className="text-xs text-muted"> (required)</span> : null}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-muted">
                Each occurrence gets its own copy: ticking a step on one task does not tick it on
                the others.
              </p>
            </>
          )}
        </Card>
        <Card title="Next Occurrences" testId="series-upcoming">
          {!s || s.upcoming.length === 0 ? (
            <p className={quiet}>{s ? 'No more occurrences are scheduled.' : note}</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm text-heading">
              {s.upcoming.map((d, i) => (
                <li key={d.scheduledOn} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-6 items-center justify-center rounded-full border border-action text-xs font-semibold text-action"
                  >
                    {i + 1}
                  </span>
                  {dayText(d.dueOn)}
                </li>
              ))}
            </ol>
          )}
        </Card>
        <div className="lg:col-span-2">
          <Card title="Occurrences" testId="series-occurrences">
            <div className="mb-3 flex justify-end">
              <Select
                label="Occurrence status"
                hideLabel
                value={state}
                onChange={(e) => setState(e.target.value as TaskOccurrence['state'] | '')}
                options={[
                  { value: '', label: 'All occurrences' },
                  { value: 'SCHEDULED', label: 'Upcoming' },
                  { value: 'GENERATED', label: 'Made' },
                  { value: 'SKIPPED', label: 'Skipped' },
                  { value: 'FAILED', label: 'Failed' },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <p className={quiet}>
                {occ.isPending
                  ? 'Loading…'
                  : occ.isError
                    ? 'Occurrences are not available right now.'
                    : 'No occurrences yet.'}
              </p>
            ) : (
              <div className="relative overflow-x-auto rounded-lg border border-divider">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Occurrences</caption>
                  <thead className="bg-table-head text-heading">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Due</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody data-testid="occurrence-rows">
                    {rows.map((o) => (
                      <tr key={o.id} className="border-t border-divider">
                        <td className="px-3 py-2 text-heading">{dayText(o.dueOn)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={OCC[o.state]}>{occurrenceLabel(o)}</Badge>
                          {occurrenceNote(o) ? (
                            <p className="mt-1 text-xs text-muted" data-testid="occurrence-note">
                              {occurrenceNote(o)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {o.state === 'GENERATED' && o.taskId ? (
                            <Link href={`/tasks/${o.taskId}`} className="text-link underline">
                              Open task
                            </Link>
                          ) : o.state === 'SCHEDULED' ? (
                            <button
                              type="button"
                              className={btn}
                              onClick={() =>
                                skip.mutate(o.id, {
                                  onSuccess: done('Occurrence skipped.'),
                                  onError: fail,
                                })
                              }
                            >
                              Skip<span className="sr-only"> {o.dueOn}</span>
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
      {skipAll ? (
        <Modal
          open
          title="Skip all future occurrences?"
          subtitle="Tasks already made stay. Nothing more is made."
          onClose={() => setSkipAll(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSkipAll(false)}>
                Keep
              </Button>
              <Button
                disabled={skipFuture.isPending}
                onClick={() =>
                  skipFuture.mutate(undefined, {
                    onSuccess: () => {
                      setSkipAll(false);
                      done('Future occurrences skipped.')();
                    },
                    onError: fail,
                  })
                }
              >
                Skip All Future
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">This cannot be undone.</p>
        </Modal>
      ) : null}
    </div>
  );
}
