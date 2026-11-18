'use client';

import type { TaskNotices } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { TASKS_KEY, TASK_ERRORS } from './task-shared';

type Delivery = TaskNotices['sent'][number]['deliveries'][number];

const STATUS: Record<
  Delivery['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  SENT: { label: 'Sent', tone: 'success' },
  QUEUED: { label: 'Queued', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SKIPPED: { label: 'Skipped', tone: 'neutral' },
};

/**
 * Dashboard Review Two §9: the task's reminder history on its page: who reminders reach, when each
 * goes next (in the firm's time zone), and each one that went out with its bell and email copy.
 */
export function ReminderHistory({ taskId }: { taskId: string }) {
  const notices = useApiQuery([...TASKS_KEY, 'notices', taskId], () =>
    api.taskWork.notices(taskId),
  );
  if (notices.isPending) return <p className="text-muted">Loading the reminder history…</p>;
  if (notices.isError)
    return (
      <p role="alert" className="text-danger">
        {errorMessage(notices.error, TASK_ERRORS)}
      </p>
    );
  const n = notices.data;
  const when = (iso: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: n.timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  const dueText = (dueFor: string) =>
    new Date(`${dueFor.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
    });
  return (
    <section className="flex flex-col gap-2" data-testid="reminder-history">
      <h3 className="font-semibold text-heading">Reminder history</h3>
      <p className="text-text" data-testid="reminder-recipients">
        Goes to: {n.recipients.length ? n.recipients.map((m) => m.name).join(', ') : 'Nobody yet'}
        <span className="block text-xs text-muted">
          The assignees (or, with none, who made the task), never the client. Times are in{' '}
          {n.timeZone}.
        </span>
      </p>
      {n.upcoming.length ? (
        <ul className="text-text" data-testid="reminder-upcoming">
          {n.upcoming.map((u) => (
            <li key={u.reminderId}>Next: {when(u.at)}</li>
          ))}
        </ul>
      ) : null}
      {n.sent.length === 0 && n.emailOnly.length === 0 ? (
        <p className="text-muted">No reminder has gone out yet.</p>
      ) : (
        <ul className="divide-y divide-divider" data-testid="reminder-sent">
          {n.sent.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 py-2">
              <span className="text-heading">
                {when(s.at)} · {s.recipient?.name ?? 'A former member'} · for {dueText(s.dueFor)}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Bell: {s.readAt ? `read ${when(s.readAt)}` : 'not read yet'}</span>
                {s.deliveries.map((d) => (
                  <span key={d.channel} className="flex flex-wrap items-center gap-1">
                    {d.channel === 'EMAIL' ? 'Email' : 'Text'}:{' '}
                    <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                    {d.sentAt ? when(d.sentAt) : null}
                    {d.attempts > 1 ? ` · ${d.attempts} tries` : null}
                    {d.error ? ` · ${d.error}` : null}
                    {d.providerMessageId ? ` · ID ${d.providerMessageId}` : null}
                  </span>
                ))}
              </span>
            </li>
          ))}
          {n.emailOnly.map((e) => (
            <li key={e.reminderId} className="py-2 text-text">
              Emailed for {dueText(e.firedFor)}
              <span className="block text-xs text-muted">
                With the bell off, the email goes out directly and each person&apos;s delivery is
                not recorded.
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
