'use client';

import type { LeadActionType, LeadFollowUp, LeadProfile, LeadTask } from '@firmivra/types';
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

export const ACTIONS: { value: LeadActionType; label: string }[] = [
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

/** "HH:MM" of a time, local, on the half hour the picker offers. */
const halfHour = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${d.getMinutes() < 30 ? '00' : '30'}`;
};

/**
 * L8: every follow-up step, the next unfinished first. An unfinished step can be edited (into the
 * form above), removed or completed; a finished one shows its outcome.
 */
function FollowUpSteps({
  lead,
  onEdit,
  editing,
  onMessage,
}: {
  lead: LeadProfile;
  onEdit: (step: LeadFollowUp) => void;
  editing: string | null;
  onMessage: (text: string) => void;
}) {
  const options = { invalidate: LEAD_PIPELINE_KEY };
  const remove = useApiMutation(
    (id: string) => api.leadPipeline.removeFollowUp(lead.id, id),
    options,
  );
  const done = useApiMutation(
    (id: string) => api.leadPipeline.completeFollowUpStep(lead.id, id, {}),
    options,
  );
  if (!lead.followUps.length) return null;
  const busy = remove.isPending || done.isPending;
  return (
    <div className="mb-3 flex flex-col gap-2">
      <ol className="flex flex-col divide-y divide-divider" data-testid="follow-up-steps">
        {lead.followUps.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="min-w-0 grow">
              <span className={`font-semibold ${f.doneAt ? 'text-muted' : 'text-heading'}`}>
                {ACTIONS.find((a) => a.value === f.type)?.label ?? f.type}
              </span>{' '}
              <span className="text-muted">{stamp(f.dueAt)}</span>
              {f.notes ? <span className="block text-muted">{f.notes}</span> : null}
              {f.doneAt ? (
                <span className="block text-xs text-success">
                  Done {stamp(f.doneAt)}
                  {f.outcome ? `: ${f.outcome}` : ''}
                </span>
              ) : null}
            </span>
            {!f.doneAt ? (
              <span className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  disabled={busy || editing === f.id}
                  onClick={() => onEdit(f)}
                >
                  Edit<span className="sr-only"> follow-up</span>
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    remove.mutate(f.id, { onSuccess: () => onMessage('Follow-up removed.') })
                  }
                >
                  Remove<span className="sr-only"> follow-up</span>
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    done.mutate(f.id, {
                      onSuccess: () => onMessage('Follow-up completed and logged.'),
                    })
                  }
                >
                  Complete<span className="sr-only"> follow-up</span>
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {remove.isError || done.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(remove.error ?? done.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Next Action / Follow-Up card (docx 8, L8): the next step, "Overdue" in red when its time has
 * passed, and every step. Save Follow-Up changes the next step (or sets the first); + Add Follow-Up
 * adds another; a step's Edit puts it into the form to change it.
 */
export function FollowUpCard({ lead }: { lead: LeadProfile | undefined }) {
  const next = lead?.nextAction ?? null;
  const [type, setType] = useState<LeadActionType>(next?.type ?? 'CALL');
  const [date, setDate] = useState(() => (next ? next.dueAt.slice(0, 10) : ''));
  const [time, setTime] = useState('10:00');
  const [notes, setNotes] = useState(next?.notes ?? '');
  const [outcome, setOutcome] = useState('');
  const [message, setMessage] = useState<string>();
  const [editing, setEditing] = useState<string | null>(null);
  const options = { invalidate: LEAD_PIPELINE_KEY };
  const form = () => ({
    type,
    dueAt: new Date(`${date}T${time}:00`).toISOString(),
    notes: notes.trim() || null,
  });
  const add = useApiMutation(() => api.leadPipeline.addFollowUp(lead?.id ?? '', form()), options);
  const change = useApiMutation(
    () => api.leadPipeline.updateFollowUp(lead?.id ?? '', editing ?? '', form()),
    options,
  );
  const edit = (step: LeadFollowUp) => {
    setEditing(step.id);
    setType(step.type);
    setDate(step.dueAt.slice(0, 10));
    setTime(halfHour(step.dueAt));
    setNotes(step.notes ?? '');
    setMessage(undefined);
  };
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
      {lead ? (
        <FollowUpSteps lead={lead} onEdit={edit} editing={editing} onMessage={setMessage} />
      ) : null}
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
          {editing ? (
            <>
              <Button
                disabled={!lead || !date || change.isPending}
                onClick={() =>
                  change.mutate(undefined, {
                    onSuccess: () => {
                      setEditing(null);
                      setMessage('Follow-up changed.');
                    },
                  })
                }
              >
                Save Step
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel Edit
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={!lead || !date || save.isPending}
                onClick={() =>
                  save.mutate(undefined, { onSuccess: () => setMessage('Follow-up saved.') })
                }
              >
                Save Follow-Up
              </Button>
              <Button
                variant="secondary"
                disabled={!lead || !date || add.isPending}
                onClick={() =>
                  add.mutate(undefined, { onSuccess: () => setMessage('Follow-up added.') })
                }
              >
                + Add Follow-Up
              </Button>
            </>
          )}
          {save.isError || add.isError || change.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error ?? add.error ?? change.error)}
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

/** Open Tasks (Overview and the Tasks tab): the lead's unfinished tasks, Add Task. */
export function OpenTasksCard() {
  const { id } = useProfile();
  const query = useApiQuery(wsKey(id, 'tasks'), () => api.leadPipeline.tasks(id));
  const open = (query.data ?? []).filter((t) => !t.done);
  const done = (query.data ?? []).length - open.length;
  return (
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
  );
}

/** Tasks tab: the follow-up and the Open Tasks card. */
export function TasksTab() {
  const { profile } = useProfile();
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <FollowUpCard key={profile ? 'loaded' : 'none'} lead={profile} />
      <OpenTasksCard />
    </div>
  );
}
