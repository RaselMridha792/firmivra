'use client';

import { Badge, Toast } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowLeft,
  Archive,
  Bell,
  CalendarPlus,
  CheckCircle,
  Hourglass,
  ListChecks,
  PencilSimple,
  Prohibit,
  Spinner,
  UserSwitch,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  PRIORITY_LABEL,
  PriorityPill,
  SOURCE_LABEL,
  StatusPill,
  TYPE_LABEL,
  dayText,
  quiet,
  shortName,
  stamp,
  subtle,
  timeText,
} from './compliance-shared';
import { DeadlineDialog, MODE_LABEL, remindersToDrafts, type SingleKind } from './deadline-dialogs';

function Card({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <h2 className="mb-3 font-display text-lg font-bold text-heading">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-text">{k}</dt>
          <dd className="min-w-0 break-words text-heading">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** /compliance/[id]: one deadline: facts, the calendar rule behind it, reminders, tasks, documents. */
export function DeadlineDetailScreen({ id }: { id: string }) {
  const query = useApiQuery([...COMPLIANCE_KEY, 'deadline', id], () =>
    api.compliance.getDeadline(id),
  );
  const d = query.data;
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<SingleKind>();
  const options = { invalidate: [...COMPLIANCE_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' });
  const start = useApiMutation(() => api.compliance.startDeadline(id), options);
  const wait = useApiMutation(() => api.compliance.waitOnClient(id), options);
  const reopen = useApiMutation(() => api.compliance.reopenDeadline(id), options);
  const archive = useApiMutation(() => api.compliance.archiveDeadline(id), options);
  const addTask = useApiMutation(() => api.compliance.addTask(id), options);
  const note = query.isPending ? 'Loading…' : 'This deadline is not available right now.';
  const open = d ? ['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT'].includes(d.status) : false;
  const btn = subtle;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="deadline-detail">
      <Link
        href="/compliance"
        className="flex w-fit items-center gap-2 text-sm font-medium text-link"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Compliance &amp;
        Deadlines
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-heading" data-testid="deadline-title">
            {d?.name ?? 'Deadline'}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base text-muted">
            {d ? (
              <>
                <StatusPill status={d.displayStatus} />
                <PriorityPill priority={d.priority} />
                {d.client.displayName} · {TYPE_LABEL[d.type]}
                {d.archived ? <Badge tone="neutral">Archived</Badge> : null}
              </>
            ) : (
              note
            )}
          </p>
        </div>
        {d && !d.archived ? (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Deadline actions"
          >
            {open ? (
              <>
                {d.status !== 'IN_PROGRESS' ? (
                  <button
                    type="button"
                    className={btn}
                    onClick={() =>
                      start.mutate(undefined, {
                        onSuccess: done('Marked in progress.'),
                        onError: fail,
                      })
                    }
                  >
                    <Spinner aria-hidden weight="fill" className="size-4" /> In Progress
                  </button>
                ) : null}
                {d.status !== 'WAITING_ON_CLIENT' ? (
                  <button
                    type="button"
                    className={btn}
                    onClick={() =>
                      wait.mutate(undefined, {
                        onSuccess: done('Waiting on the client.'),
                        onError: fail,
                      })
                    }
                  >
                    <Hourglass aria-hidden weight="fill" className="size-4" /> Waiting on Client
                  </button>
                ) : null}
                <button type="button" className={btn} onClick={() => setDialog('complete')}>
                  <CheckCircle aria-hidden weight="fill" className="size-4" /> Complete
                </button>
                <button type="button" className={btn} onClick={() => setDialog('reassign')}>
                  <UserSwitch aria-hidden weight="fill" className="size-4" /> Reassign
                </button>
                <button type="button" className={btn} onClick={() => setDialog('extension')}>
                  <CalendarPlus aria-hidden weight="fill" className="size-4" /> File Extension
                </button>
                <button type="button" className={btn} onClick={() => setDialog('notApplicable')}>
                  <Prohibit aria-hidden weight="fill" className="size-4" /> Not Applicable
                </button>
              </>
            ) : (
              <button
                type="button"
                className={btn}
                onClick={() =>
                  reopen.mutate(undefined, { onSuccess: done('Deadline reopened.'), onError: fail })
                }
              >
                <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" /> Reopen
              </button>
            )}
            <Link href={`/compliance/${id}/edit`} className={btn}>
              <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
            </Link>
            <button
              type="button"
              className={`${btn} text-danger`}
              onClick={() =>
                archive.mutate(undefined, { onSuccess: done('Deadline archived.'), onError: fail })
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
      {d?.calendarStale ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"
        >
          <Warning aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
          The calendar behind this date was verified a long time ago. Check the official source.
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Details" testId="detail-facts">
          {d ? (
            <Facts
              rows={[
                ['Type', TYPE_LABEL[d.type]],
                ['Source', SOURCE_LABEL[d.source]],
                ['Agency', d.agency ?? '—'],
                [
                  'Jurisdiction',
                  d.jurisdiction
                    ? d.jurisdiction.charAt(0) + d.jurisdiction.slice(1).toLowerCase()
                    : '—',
                ],
                ['State', d.state ?? '—'],
                ['Related form', d.relatedForm ?? '—'],
                ['Entity type', d.entityType ?? '—'],
                ['Tax year', d.taxYear ? String(d.taxYear) : '—'],
                ['Filing period', d.filingPeriod ?? '—'],
                ['Assigned to', d.assignedTo ? shortName(d.assignedTo.name) : 'Unassigned'],
                ['Priority', PRIORITY_LABEL[d.priority]],
                ['Client visible', d.clientVisible ? 'Yes' : 'No'],
                ['Description', d.description ?? '—'],
              ]}
            />
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Card>
        <Card title="Dates" testId="detail-dates">
          {d ? (
            <>
              <Facts
                rows={[
                  [
                    'Due date',
                    `${dayText(d.dueOn)}${d.dueTime ? ` at ${timeText(d.dueTime)}` : ''}`,
                  ],
                  ['Statutory date', d.statutoryDueOn ? dayText(d.statutoryDueOn) : '—'],
                  ['Extension filed', d.extensionFiledOn ? dayText(d.extensionFiledOn) : '—'],
                  ['Extended due date', d.extendedDueOn ? dayText(d.extendedDueOn) : '—'],
                  ['Payment due', d.paymentDueOn ? dayText(d.paymentDueOn) : '—'],
                  ['Days until due', String(d.daysUntilDue)],
                  ...(d.status === 'COMPLETED'
                    ? ([
                        ['Filed on', d.filedOn ? dayText(d.filedOn) : '—'],
                        ['Confirmation', d.confirmationNumber ?? '—'],
                        [
                          'Completed',
                          d.completedAt
                            ? `${stamp(d.completedAt)}${d.completedBy ? ` by ${shortName(d.completedBy.name)}` : ''}`
                            : '—',
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  ...(d.status === 'NOT_APPLICABLE'
                    ? ([['Not applicable because', d.notApplicableReason ?? '—']] as [
                        string,
                        ReactNode,
                      ][])
                    : []),
                ]}
              />
              {d.dueOverridden ? (
                <p className="mt-3 rounded-lg bg-info-soft p-3 text-sm text-info">
                  The date was changed from the statutory date. Reason: {d.dueOverrideReason}
                </p>
              ) : null}
            </>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Card>
        <Card title="Calendar Source" testId="detail-source">
          {d?.calendarEntry ? (
            <Facts
              rows={[
                ['Entry', d.calendarEntry.name],
                ['Calendar', `${d.calendarEntry.calendarName} (v${d.calendarEntry.version})`],
                ['Authority', d.calendarEntry.authority],
                ['Effective year', String(d.calendarEntry.effectiveYear)],
                [
                  'Last verified',
                  d.calendarEntry.verifiedAt
                    ? dayText(d.calendarEntry.verifiedAt.slice(0, 10))
                    : 'Not verified',
                ],
                [
                  'Official source',
                  <a
                    key="u"
                    href={d.calendarEntry.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link underline"
                  >
                    {d.calendarEntry.sourceUrl}
                  </a>,
                ],
                ...(d.applicabilityReason
                  ? ([['Why it applies', d.applicabilityReason]] as [string, ReactNode][])
                  : []),
              ]}
            />
          ) : (
            <p className={quiet}>
              {d ? 'This deadline was not made from a government calendar.' : note}
            </p>
          )}
        </Card>
        <Card title="Reminders" testId="detail-reminders">
          {d && d.reminders.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm text-heading">
              {remindersToDrafts(d.reminders).map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <Bell aria-hidden weight="fill" className="size-4 text-action" />
                  {r.days} {r.days === '1' ? 'day' : 'days'} before ({MODE_LABEL[r.mode]})
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>{d ? 'No reminders are set.' : note}</p>
          )}
          {d && open ? (
            <button type="button" className={`${btn} mt-3`} onClick={() => setDialog('reminders')}>
              Edit Reminders
            </button>
          ) : null}
        </Card>
        <div id="related" className="grid min-w-0 gap-4 lg:col-span-2 lg:grid-cols-3">
          <Card title="Tasks" testId="detail-tasks">
            {d && d.tasks.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="min-w-0 truncate font-medium text-heading hover:underline"
                    >
                      {t.title}
                    </Link>
                    <Badge tone={t.status === 'DONE' ? 'success' : 'info'}>
                      {t.status === 'DONE' ? 'Done' : 'Open'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={quiet}>{d ? 'No tasks are linked.' : note}</p>
            )}
            {d && open ? (
              <button
                type="button"
                className={`${btn} mt-3`}
                onClick={() =>
                  addTask.mutate(undefined, { onSuccess: done('Task created.'), onError: fail })
                }
              >
                <ListChecks aria-hidden weight="fill" className="size-4" /> Create Task
              </button>
            ) : null}
          </Card>
          <Card title="Documents" testId="detail-documents">
            {d && d.documents.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm text-heading">
                {d.documents.map((x) => (
                  <li key={x.documentId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{x.fileName}</span>
                    <span className="shrink-0 text-xs text-muted">{stamp(x.addedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={quiet}>{d ? 'No documents are added.' : note}</p>
            )}
            {d ? (
              <p className="mt-3 text-sm">
                <Link href={`/compliance/${id}/edit`} className="text-link underline">
                  Change related items
                </Link>
              </p>
            ) : null}
          </Card>
          <Card title="Related Deadlines" testId="detail-links">
            {d && d.relatedDeadlines.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {d.relatedDeadlines.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/compliance/${r.id}`}
                      className="min-w-0 truncate font-medium text-heading hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="shrink-0 text-muted">{dayText(r.dueOn)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={quiet}>{d ? 'No related deadlines.' : note}</p>
            )}
          </Card>
        </div>
        <div className="grid min-w-0 gap-4 lg:col-span-2 lg:grid-cols-2">
          <Card title="Internal Notes" testId="detail-internal">
            <p className={d?.internalNotes ? 'text-sm whitespace-pre-wrap text-heading' : quiet}>
              {d ? (d.internalNotes ?? 'No internal notes.') : note}
            </p>
          </Card>
          <Card title="Client-Facing Notes" testId="detail-client-notes">
            <p className={d?.clientNotes ? 'text-sm whitespace-pre-wrap text-heading' : quiet}>
              {d ? (d.clientNotes ?? 'No client-facing notes.') : note}
            </p>
          </Card>
        </div>
      </div>
      {d && dialog ? (
        <DeadlineDialog
          kind={dialog}
          deadline={d}
          reminders={d.reminders}
          onClose={() => setDialog(undefined)}
          onDone={(text) => {
            setDialog(undefined);
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}
