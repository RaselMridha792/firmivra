'use client';

import type { LeadActionType, LeadProfile, LeadTask } from '@firmivra/types';
import { Badge, Button, Select, Textarea } from '@firmivra/ui';
import { CheckSquare, Fire, PhoneCall } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from '../../_components/lead-shared';
import { CardFrame } from './profile-cards';
import { useProfile } from './profile-frame';
import { stamp, wsKey } from './profile-shared';

const ACTIONS: { value: LeadActionType; label: string }[] = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'APPOINTMENT', label: 'Appointment' },
  { value: 'SEND_DOCUMENTS', label: 'Send Documents' },
  { value: 'FOLLOW_UP', label: 'Follow Up' },
  { value: 'CLOSE_LEAD', label: 'Close Lead' },
];
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const m = i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
const timeText = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const PRIORITY: Record<
  LeadTask['priority'],
  { label: string; tone: 'danger' | 'warning' | 'success' }
> = {
  URGENT: { label: 'Urgent', tone: 'danger' },
  HIGH: { label: 'High', tone: 'danger' },
  MEDIUM: { label: 'Medium', tone: 'warning' },
  LOW: { label: 'Low', tone: 'success' },
};
const dueText = (date: string | null) =>
  date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'No due date';

/**
 * The Next Action / Follow-Up card: one action, one date and time (docx 8). It is "Overdue" in red
 * when the time has passed; completing it logs it and lets the next one be set.
 */
function FollowUpCard({ lead }: { lead: LeadProfile | undefined }) {
  const next = lead?.nextAction ?? null;
  const [type, setType] = useState<LeadActionType>(next?.type ?? 'CALL');
  const [date, setDate] = useState(() => (next ? next.dueAt.slice(0, 10) : ''));
  const [time, setTime] = useState('10:00');
  const [notes, setNotes] = useState(next?.notes ?? '');
  const [outcome, setOutcome] = useState('');
  const [message, setMessage] = useState<string>();
  const options = { invalidate: LEAD_PIPELINE_KEY };
  const save = useApiMutation(
    () =>
      api.leadPipeline.setFollowUp(lead?.id ?? '', {
        type,
        dueAt: new Date(`${date}T${time}:00`).toISOString(),
        notes,
      }),
    options,
  );
  const complete = useApiMutation(
    () => api.leadPipeline.completeFollowUp(lead?.id ?? '', { outcome }),
    options,
  );
  return (
    <CardFrame icon={PhoneCall} title="Next Action / Follow-Up" testId="card-follow-up">
      {next ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-heading">
          <span className="font-semibold">
            {ACTIONS.find((a) => a.value === next.type)?.label ?? next.type}
          </span>
          <span className="text-muted">{stamp(next.dueAt)}</span>
          {next.overdue ? <Badge tone="danger">Overdue</Badge> : null}
        </p>
      ) : (
        <p className="mb-3 text-sm text-muted">No follow-up is scheduled.</p>
      )}
      <div className="flex flex-col gap-3">
        <Select
          label="Action Type"
          value={type}
          disabled={!lead}
          onChange={(event) => setType(event.target.value as LeadActionType)}
          options={ACTIONS}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="fu-date" className="text-sm font-medium text-text">
              Date
            </label>
            <input
              id="fu-date"
              type="date"
              disabled={!lead}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm text-text disabled:bg-canvas"
            />
          </div>
          <Select
            label="Time"
            value={time}
            disabled={!lead}
            onChange={(event) => setTime(event.target.value)}
            options={TIMES.map((t) => ({ value: t, label: timeText(t) }))}
          />
        </div>
        <Textarea
          label="Notes"
          rows={2}
          maxLength={500}
          disabled={!lead}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!lead || !date || save.isPending}
            onClick={() =>
              save.mutate(undefined, { onSuccess: () => setMessage('Follow-up saved.') })
            }
          >
            Save Follow-Up
          </Button>
          {save.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error)}
            </p>
          ) : message ? (
            <p role="status" className="text-sm text-success">
              {message}
            </p>
          ) : null}
        </div>
        {next && next.type !== 'CLOSE_LEAD' ? (
          <div className="mt-1 flex flex-col gap-2 border-t border-divider pt-3">
            <Textarea
              label="How did it go? (optional)"
              rows={2}
              maxLength={500}
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                disabled={complete.isPending}
                onClick={() =>
                  complete.mutate(undefined, {
                    onSuccess: () => {
                      setOutcome('');
                      setMessage('Follow-up completed and logged.');
                    },
                  })
                }
              >
                Mark Follow-Up Complete
              </Button>
              {complete.isError ? (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(complete.error)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}

/** Tasks tab: the follow-up and the Open Tasks card. */
export function TasksTab() {
  const { id, profile } = useProfile();
  const query = useApiQuery(wsKey(id, 'tasks'), () => api.leadPipeline.tasks(id));
  const open = (query.data ?? []).filter((t) => !t.done);
  const done = (query.data ?? []).length - open.length;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <FollowUpCard key={profile ? 'loaded' : 'none'} lead={profile} />
      <CardFrame
        icon={CheckSquare}
        title="Open Tasks"
        testId="card-open-tasks"
        action={
          <Link href="/tasks/new" className="text-sm font-medium text-link underline">
            Add Task
          </Link>
        }
      >
        {open.length === 0 ? (
          <p className="rounded-lg bg-canvas p-6 text-center text-sm text-muted">
            {query.isPending
              ? 'Loading…'
              : query.isError
                ? 'Tasks are not available right now.'
                : 'No open tasks for this lead.'}
          </p>
        ) : (
          <ul className="flex flex-col" data-testid="lead-task-list">
            {open.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0"
              >
                <label className="flex min-w-0 items-center gap-3 text-sm text-heading">
                  <input
                    type="checkbox"
                    disabled
                    checked={false}
                    readOnly
                    aria-label={`${task.title} is open`}
                    className="size-5 shrink-0"
                  />
                  <span className="truncate">{task.title}</span>
                </label>
                <span className="flex shrink-0 items-center gap-3 text-sm text-muted">
                  {dueText(task.dueOn)}
                  <Badge
                    tone={PRIORITY[task.priority].tone}
                    {...(task.priority === 'HIGH' || task.priority === 'URGENT'
                      ? { icon: Fire }
                      : {})}
                  >
                    {PRIORITY[task.priority].label}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        {done > 0 ? (
          <p className="mt-3 text-xs text-muted">{done} completed task(s) not shown.</p>
        ) : null}
      </CardFrame>
    </div>
  );
}
