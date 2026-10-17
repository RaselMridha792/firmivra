'use client';

import type { TaskSeriesRow, TaskTemplate } from '@firmivra/types';
import { Badge, Toast } from '@firmivra/ui';
import { Archive, ArrowCounterClockwise, Copy, Pause, Play, Stop } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { PRIORITY_LABEL, TASKS_KEY, TASK_ERRORS, dayText, shortName } from './task-shared';

const btn =
  'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-divider px-3 text-sm font-medium text-heading hover:bg-canvas disabled:opacity-50';
const quiet = 'rounded-lg bg-canvas p-8 text-center text-sm text-muted';
const SERIES_TONE = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  ENDED: 'neutral',
  ARCHIVED: 'neutral',
} as const;

/** Recurring Tasks: the series, what repeats, when the next one is due, and pause, resume or stop. */
export function RecurringTab() {
  const list = useApiQuery([...TASKS_KEY, 'series'], () =>
    api.taskWork.seriesList({ pageSize: 50 }),
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const rows = list.data?.items ?? [];
  const options = { invalidate: [...TASKS_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) => setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' });
  const pause = useApiMutation((id: string) => api.taskWork.pauseSeries(id), options);
  const resume = useApiMutation((id: string) => api.taskWork.resumeSeries(id), options);
  const stop = useApiMutation((id: string) => api.taskWork.stopSeries(id), options);
  const state = list.isPending
    ? 'Loading…'
    : list.isError
      ? 'Recurring tasks are not available right now.'
      : 'No recurring tasks yet. Set one up to repeat work for a client.';
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="recurring-tab">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {rows.length === 0 ? (
        <p className={quiet}>{state}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-divider">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recurring tasks</caption>
            <thead className="bg-table-head text-heading">
              <tr>
                <th className="px-3 py-2 font-semibold">Task</th>
                <th className="px-3 py-2 font-semibold">Client</th>
                <th className="px-3 py-2 font-semibold">Repeats</th>
                <th className="px-3 py-2 font-semibold">Next Due</th>
                <th className="px-3 py-2 font-semibold">Made</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Assigned To</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="series-rows">
              {rows.map((s: TaskSeriesRow) => (
                <tr key={s.id} className="border-t border-divider">
                  <td className="px-3 py-2">
                    <Link
                      href={`/tasks/recurring/${s.id}`}
                      data-testid="series-link"
                      className="font-medium text-heading hover:underline"
                    >
                      {s.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-link">{s.client.displayName}</td>
                  <td className="px-3 py-2 text-text">{s.summary}</td>
                  <td className="px-3 py-2 text-text">
                    {s.nextDueOn ? dayText(s.nextDueOn) : '—'}
                  </td>
                  <td className="px-3 py-2 text-text">{s.generatedCount}</td>
                  <td className="px-3 py-2">
                    <Badge tone={SERIES_TONE[s.status]}>
                      {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-text">
                    {s.assignedTo ? shortName(s.assignedTo.name) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {s.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          className={btn}
                          onClick={() =>
                            pause.mutate(s.id, {
                              onSuccess: done(`${s.title} paused.`),
                              onError: fail,
                            })
                          }
                        >
                          <Pause aria-hidden weight="fill" className="size-4" /> Pause
                          <span className="sr-only"> {s.title}</span>
                        </button>
                      ) : null}
                      {s.status === 'PAUSED' ? (
                        <button
                          type="button"
                          className={btn}
                          onClick={() =>
                            resume.mutate(s.id, {
                              onSuccess: done(`${s.title} resumed.`),
                              onError: fail,
                            })
                          }
                        >
                          <Play aria-hidden weight="fill" className="size-4" /> Resume
                          <span className="sr-only"> {s.title}</span>
                        </button>
                      ) : null}
                      {s.status === 'ACTIVE' || s.status === 'PAUSED' ? (
                        <button
                          type="button"
                          className={`${btn} text-danger`}
                          onClick={() =>
                            stop.mutate(s.id, {
                              onSuccess: done(`${s.title} stopped.`),
                              onError: fail,
                            })
                          }
                        >
                          <Stop aria-hidden weight="fill" className="size-4" /> Stop
                          <span className="sr-only"> {s.title}</span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Task Templates: reusable tasks; Use starts a new task from one. */
export function TemplatesTab() {
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const list = useApiQuery([...TASKS_KEY, 'templates', status], () =>
    api.taskWork.templates({ status }),
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const rows = list.data ?? [];
  const options = { invalidate: [...TASKS_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) => setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' });
  const duplicate = useApiMutation((id: string) => api.taskWork.duplicateTemplate(id), options);
  const archive = useApiMutation((id: string) => api.taskWork.archiveTemplate(id), options);
  const restore = useApiMutation((id: string) => api.taskWork.restoreTemplate(id), options);
  const state = list.isPending
    ? 'Loading…'
    : list.isError
      ? 'Templates are not available right now.'
      : status === 'active'
        ? 'No templates yet. Use "Save as Template" on a task to make one.'
        : 'No archived templates.';
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="templates-tab">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div role="group" aria-label="Template status" className="flex gap-2">
        {(['active', 'archived'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-9 rounded-pill px-4 text-sm font-medium ${status === s ? 'bg-navigation text-on-action' : 'bg-table-head text-text hover:bg-folder-surface'}`}
          >
            {s === 'active' ? 'Active' : 'Archived'}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className={quiet}>{state}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-divider">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Task templates</caption>
            <thead className="bg-table-head text-heading">
              <tr>
                <th className="px-3 py-2 font-semibold">Template</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Priority</th>
                <th className="px-3 py-2 font-semibold">Checklist</th>
                <th className="px-3 py-2 font-semibold">Due</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="template-rows">
              {rows.map((t: TaskTemplate) => (
                <tr key={t.id} className="border-t border-divider">
                  <td className="px-3 py-2 font-medium text-heading" data-testid="template-name">
                    {t.name}
                  </td>
                  <td className="px-3 py-2 text-text">{t.type?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-text">{PRIORITY_LABEL[t.priority]}</td>
                  <td className="px-3 py-2 text-text">{t.checklist.length} items</td>
                  <td className="px-3 py-2 text-text">
                    {t.dueOffsetDays === null ? '—' : `${t.dueOffsetDays} days after`}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {t.archivedAt === null ? (
                        <>
                          <Link
                            href={`/tasks/new?template=${t.id}`}
                            className="inline-flex min-h-9 items-center rounded-lg bg-info-soft px-3 text-sm font-semibold text-action"
                          >
                            Use<span className="sr-only"> {t.name}</span>
                          </Link>
                          <button
                            type="button"
                            className={btn}
                            onClick={() =>
                              duplicate.mutate(t.id, {
                                onSuccess: done('Template duplicated.'),
                                onError: fail,
                              })
                            }
                          >
                            <Copy aria-hidden weight="fill" className="size-4" /> Duplicate
                            <span className="sr-only"> {t.name}</span>
                          </button>
                          <button
                            type="button"
                            className={`${btn} text-danger`}
                            onClick={() =>
                              archive.mutate(t.id, {
                                onSuccess: done(`${t.name} archived.`),
                                onError: fail,
                              })
                            }
                          >
                            <Archive aria-hidden weight="fill" className="size-4" /> Archive
                            <span className="sr-only"> {t.name}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={btn}
                          onClick={() =>
                            restore.mutate(t.id, {
                              onSuccess: done(`${t.name} restored.`),
                              onError: fail,
                            })
                          }
                        >
                          <ArrowCounterClockwise aria-hidden weight="fill" className="size-4" />{' '}
                          Restore<span className="sr-only"> {t.name}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
