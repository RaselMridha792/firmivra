'use client';

import {
  type ProjectDeadline,
  type ProjectDeadlineReminderUnit,
  type ProjectDeadlinesQuery,
  PROJECT_DEADLINE_MAX_REMINDERS,
  SaveProjectDeadlineRequest,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Modal,
  Radio,
  Select,
  Table,
  Textarea,
  type Column,
} from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { localParts, todayIn, toInstant } from '../../../calendar/_components/time';
import { RowMenu } from '../../../team/_components/row-menu';
import { TpShell } from '../../_components/tp-shell';
import { TP_KEY, card } from '../../_components/tp-shared';

const KEY = [...TP_KEY, 'project-deadlines'];
const ERRORS: Record<string, string> = {
  OWNER_ONLY: 'Only the owner can change, share or delete this deadline.',
  NOT_FOUND: 'This deadline is no longer there.',
};
const UNITS: { value: ProjectDeadlineReminderUnit; label: string }[] = [
  { value: 'MINUTES', label: 'Minutes before' },
  { value: 'HOURS', label: 'Hours before' },
  { value: 'DAYS', label: 'Days before' },
];
const UNIT_WORD: Record<ProjectDeadlineReminderUnit, [string, string]> = {
  MINUTES: ['minute', 'minutes'],
  HOURS: ['hour', 'hours'],
  DAYS: ['day', 'days'],
};
const reminderText = (r: { amount: number; unit: ProjectDeadlineReminderUnit }) =>
  r.amount === 0
    ? 'At the due time'
    : `${r.amount} ${UNIT_WORD[r.unit][r.amount === 1 ? 0 : 1]} before`;

type Status = NonNullable<ProjectDeadlinesQuery['status']>;
type Scope = NonNullable<ProjectDeadlinesQuery['scope']>;

/** The firm's time zone (every role reads it, as the header clock does). */
function useFirmZone(): string {
  const availability = useApiQuery(['availability'], () => api.availability.get());
  return availability.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const dueText = (iso: string, zone: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

/**
 * Tax Planning > Project Deadlines (Tax Planning Review 2, approved addition; no mockup): the
 * member's own deadlines and the ones coworkers share with them, apart from the Tax Calendar and
 * the Super Admin's mandatory deadlines. Each row shows its owner and who it is shared with. Add
 * Deadline takes a name, a date and time, a description, a service, an optional client and up to
 * five reminders; it is private unless shared with chosen coworkers. Only the owner edits,
 * shares or deletes; the owner and those coworkers mark it complete.
 */
export function ProjectDeadlinesScreen() {
  const zone = useFirmZone();
  const [status, setStatus] = useState<Status>('open');
  const [scope, setScope] = useState<Scope>('all');
  const [editing, setEditing] = useState<ProjectDeadline | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProjectDeadline | null>(null);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const list = useApiQuery([...KEY, status, scope], () =>
    api.projectDeadlines.list({ status, scope }),
  );
  const toggle = useApiMutation(
    (d: ProjectDeadline) =>
      d.completedAt ? api.projectDeadlines.reopen(d.id) : api.projectDeadlines.complete(d.id),
    { invalidate: KEY },
  );
  const act = (d: ProjectDeadline) =>
    toggle.mutate(d, {
      onSuccess: (after) =>
        setNotice({
          text: after.completedAt ? `${d.name} is complete.` : `${d.name} is open again.`,
          failed: false,
        }),
      onError: (e) => setNotice({ text: errorMessage(e, ERRORS), failed: true }),
    });

  const columns: Column<ProjectDeadline>[] = [
    {
      id: 'name',
      label: 'Deadline',
      cell: (d) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold text-heading">{d.name}</span>
          {d.description ? (
            <span className="line-clamp-2 text-xs text-muted">{d.description}</span>
          ) : null}
        </div>
      ),
    },
    { id: 'due', label: 'Due', cell: (d) => dueText(d.dueAt, zone) },
    { id: 'service', label: 'Service', cell: (d) => d.service.name },
    {
      id: 'client',
      label: 'Client',
      cell: (d) =>
        d.client ? (
          d.client.name
        ) : d.clientHidden ? (
          <span className="text-muted">A client you don’t work with</span>
        ) : (
          <span className="text-muted">None</span>
        ),
    },
    {
      id: 'owner',
      label: 'Owner',
      cell: (d) => (d.mine ? 'You' : d.owner.name),
    },
    {
      id: 'visibility',
      label: 'Visibility',
      cell: (d) =>
        d.visibility === 'PRIVATE' ? (
          <Badge tone="neutral">Private</Badge>
        ) : (
          <span className="flex flex-col gap-1" data-testid="deadline-shared">
            <Badge tone="info">Shared</Badge>
            <span className="text-xs text-muted">{d.sharedWith.map((m) => m.name).join(', ')}</span>
          </span>
        ),
    },
    {
      id: 'reminders',
      label: 'Reminders',
      cell: (d) =>
        d.reminders.length ? (
          <span className="text-xs">{d.reminders.map(reminderText).join('; ')}</span>
        ) : (
          <span className="text-muted">None</span>
        ),
    },
    {
      id: 'status',
      label: 'Status',
      cell: (d) =>
        d.completedAt ? (
          <Badge tone="success">Completed</Badge>
        ) : Date.parse(d.dueAt) < Date.now() ? (
          <Badge tone="danger">Overdue</Badge>
        ) : (
          <Badge tone="warning">Open</Badge>
        ),
    },
  ];

  return (
    <TpShell
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden weight="bold" className="size-4" />
          Add Deadline
        </Button>
      }
    >
      <section
        aria-label="Project Deadlines"
        data-testid="project-deadlines"
        className={`${card} flex flex-col gap-4`}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-heading">Project Deadlines</h2>
            <p className="text-sm text-muted">
              Your own deadlines for planning work: private unless you share them. The Tax
              Calendar&apos;s filing deadlines stay in Tax Calendar.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Select
              label="Status"
              hideLabel
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'completed', label: 'Completed' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Select
              label="Show"
              hideLabel
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              options={[
                { value: 'all', label: 'Mine and shared with me' },
                { value: 'mine', label: 'Mine' },
                { value: 'shared', label: 'Shared with me' },
              ]}
            />
          </div>
        </div>
        {notice ? (
          <p
            role={notice.failed ? 'alert' : 'status'}
            data-testid="deadlines-result"
            className={`text-sm ${notice.failed ? 'text-danger' : 'text-success'}`}
          >
            {notice.text}
          </p>
        ) : null}
        <Table
          rows={list.data ?? []}
          columns={columns}
          rowKey={(d) => d.id}
          caption="Project deadlines"
          noun="deadlines"
          dense
          showPagination={false}
          loading={list.isPending}
          rowActions={(d) => (
            <RowMenu
              label={`Actions for ${d.name}`}
              items={[
                ...(d.mine ? [{ label: 'Edit', onSelect: () => setEditing(d) }] : []),
                {
                  label: d.completedAt ? 'Reopen' : 'Mark Complete',
                  onSelect: () => act(d),
                },
                ...(d.mine
                  ? [{ label: 'Delete', danger: true, onSelect: () => setDeleting(d) }]
                  : []),
              ]}
            />
          )}
          emptyTitle={list.isError ? 'Deadlines are not available' : 'No project deadlines'}
          emptyText={
            list.isError
              ? 'They could not be loaded. Try again in a moment.'
              : 'Add a deadline for your planning work. Only you see it unless you share it.'
          }
        />
      </section>

      {editing ? (
        <DeadlineForm
          deadline={editing === 'new' ? null : editing}
          zone={zone}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice({ text, failed: false });
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog
          deadline={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setNotice({ text: `${deleting.name} is deleted.`, failed: false });
            setDeleting(null);
          }}
        />
      ) : null}
    </TpShell>
  );
}

function DeleteDialog({
  deadline,
  onClose,
  onDeleted,
}: {
  deadline: ProjectDeadline;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useApiMutation(() => api.projectDeadlines.remove(deadline.id), {
    invalidate: KEY,
  });
  return (
    <Modal open title="Delete this deadline?" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          {deadline.name} and its reminders are deleted
          {deadline.sharedWith.length ? ', and the coworkers it is shared with lose it' : ''}.
        </p>
        {remove.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(remove.error, ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-danger! hover:bg-danger!"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: onDeleted })}
          >
            Delete Deadline
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ReminderRow {
  key: string;
  amount: string;
  unit: ProjectDeadlineReminderUnit;
  inApp: boolean;
  email: boolean;
}

/** A new row; its key is made when it is added (index keys for the saved ones). */
const newRow = (key: string): ReminderRow => ({
  key,
  amount: '1',
  unit: 'DAYS',
  inApp: true,
  email: false,
});

/** Add Deadline and Edit (the owner's). */
function DeadlineForm({
  deadline,
  zone,
  onClose,
  onSaved,
}: {
  deadline: ProjectDeadline | null;
  zone: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const due = deadline ? localParts(deadline.dueAt, zone) : null;
  const [name, setName] = useState(deadline?.name ?? '');
  const [date, setDate] = useState(() => due?.date ?? todayIn(zone));
  const [time, setTime] = useState(due?.time ?? '17:00');
  const [description, setDescription] = useState(deadline?.description ?? '');
  const [serviceId, setServiceId] = useState(deadline?.service.id ?? '');
  const [clientId, setClientId] = useState(deadline?.client?.id ?? '');
  const [shared, setShared] = useState(deadline?.visibility === 'SHARED');
  const [coworkers, setCoworkers] = useState<string[]>(
    deadline?.sharedWith.map((m) => m.userId) ?? [],
  );
  const [reminders, setReminders] = useState<ReminderRow[]>(() =>
    deadline
      ? deadline.reminders.map((r, i) => ({
          key: `saved-${i}`,
          amount: String(r.amount),
          unit: r.unit,
          inApp: r.inApp,
          email: r.email,
        }))
      : [newRow('first')],
  );
  const [problem, setProblem] = useState('');

  const services = useApiQuery(['catalog-services', 'project-deadlines'], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100, sort: 'name' }),
  );
  const clients = useApiQuery([...KEY, 'clients'], () => api.clients.list({ limit: 100 }));
  const team = useApiQuery([...KEY, 'coworkers'], () => api.projectDeadlines.coworkers());
  const save = useApiMutation(
    (body: SaveProjectDeadlineRequest) =>
      deadline ? api.projectDeadlines.update(deadline.id, body) : api.projectDeadlines.create(body),
    { invalidate: KEY },
  );

  const serviceOptions = [
    { value: '', label: 'Choose a service' },
    ...(services.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];
  if (deadline && !serviceOptions.some((o) => o.value === deadline.service.id)) {
    serviceOptions.push({ value: deadline.service.id, label: deadline.service.name });
  }
  const clientOptions = [
    { value: '', label: 'No client' },
    ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
  ];
  if (deadline?.client && !clientOptions.some((o) => o.value === deadline.client?.id)) {
    clientOptions.push({ value: deadline.client.id, label: deadline.client.name });
  }

  const submit = () => {
    setProblem('');
    const body = {
      name,
      dueAt: toInstant(date, time, zone),
      description: description.trim() || null,
      serviceId,
      clientId: clientId || null,
      visibility: shared ? ('SHARED' as const) : ('PRIVATE' as const),
      sharedWithUserIds: shared ? coworkers : [],
      reminders: reminders.map((r) => ({
        amount: Number(r.amount),
        unit: r.unit,
        inApp: r.inApp,
        email: r.email,
      })),
    };
    const check = SaveProjectDeadlineRequest.safeParse(body);
    if (!check.success) {
      const issue = check.error.issues[0];
      const where = issue?.path[0] === 'serviceId' ? 'Choose a service.' : issue?.message;
      setProblem(where ?? 'Check the fields.');
      return;
    }
    save.mutate(body, {
      onSuccess: (d) => onSaved(deadline ? `${d.name} is saved.` : `${d.name} is added.`),
    });
  };

  const setRow = (key: string, change: Partial<ReminderRow>) =>
    setReminders(reminders.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <Modal open title={deadline ? `Edit ${deadline.name}` : 'Add Deadline'} onClose={onClose}>
      <form
        noValidate
        data-testid="deadline-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label="Deadline name"
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Due date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label="Due time"
            type="time"
            hint={`In the firm's time zone (${zone}).`}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <Textarea
          label="Description (optional)"
          rows={3}
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Service"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setProblem('');
            }}
            options={serviceOptions}
          />
          <Select
            label="Client (optional)"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={clientOptions}
          />
        </div>

        <fieldset className="flex flex-col gap-2" data-testid="deadline-visibility">
          <legend className="mb-1 text-sm font-semibold text-heading">Who sees it</legend>
          <Radio
            name="deadline-visibility"
            label="Private: only me"
            checked={!shared}
            onChange={() => setShared(false)}
          />
          <Radio
            name="deadline-visibility"
            label="Shared with chosen coworkers"
            checked={shared}
            onChange={() => setShared(true)}
          />
          {shared ? (
            <div
              className="ml-6 grid gap-1 sm:grid-cols-2"
              role="group"
              aria-label="Coworkers to share with"
            >
              {(team.data ?? []).map((m) => (
                <Checkbox
                  key={m.userId}
                  label={m.name}
                  checked={coworkers.includes(m.userId)}
                  onChange={(e) =>
                    setCoworkers(
                      e.target.checked
                        ? [...coworkers, m.userId]
                        : coworkers.filter((u) => u !== m.userId),
                    )
                  }
                />
              ))}
              {team.isError ? (
                <p className="text-sm text-danger">The coworkers could not be loaded.</p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-2" data-testid="deadline-reminders">
          <legend className="mb-1 text-sm font-semibold text-heading">Reminders</legend>
          {reminders.map((r, i) => (
            <div key={r.key} className="flex flex-wrap items-end gap-2">
              <div className="w-24">
                <Input
                  label={`Reminder ${i + 1} amount`}
                  hideLabel
                  type="number"
                  min={0}
                  value={r.amount}
                  onChange={(e) => setRow(r.key, { amount: e.target.value })}
                />
              </div>
              <Select
                label={`Reminder ${i + 1} unit`}
                hideLabel
                value={r.unit}
                onChange={(e) =>
                  setRow(r.key, { unit: e.target.value as ProjectDeadlineReminderUnit })
                }
                options={UNITS}
              />
              <Checkbox
                label="In-app"
                checked={r.inApp}
                onChange={(e) => setRow(r.key, { inApp: e.target.checked })}
              />
              <Checkbox
                label="Email"
                checked={r.email}
                onChange={(e) => setRow(r.key, { email: e.target.checked })}
              />
              <button
                type="button"
                aria-label={`Remove reminder ${i + 1}`}
                onClick={() => setReminders(reminders.filter((x) => x.key !== r.key))}
                className="inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-subtle hover:text-danger"
              >
                <Trash aria-hidden className="size-4" />
              </button>
            </div>
          ))}
          {reminders.length < PROJECT_DEADLINE_MAX_REMINDERS ? (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => setReminders([...reminders, newRow(`added-${Date.now()}`)])}
            >
              <Plus aria-hidden weight="bold" className="size-4" />
              Add Reminder
            </Button>
          ) : null}
          <p className="text-xs text-muted">
            Reminders go to you and to the coworkers it is shared with.
          </p>
        </fieldset>

        {problem || save.error ? (
          <p role="alert" data-testid="deadline-form-error" className="text-sm text-danger">
            {problem || errorMessage(save.error, ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {deadline ? 'Save Deadline' : 'Add Deadline'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
