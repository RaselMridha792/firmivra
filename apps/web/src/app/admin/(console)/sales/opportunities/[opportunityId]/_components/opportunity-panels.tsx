'use client';

import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Input,
  Select,
  Textarea,
  Timeline,
  type TimelineItem,
} from '@firmivra/ui';
import { ArrowsClockwise, FilePdf } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import {
  adminSales,
  appointmentTypeLabel,
  fieldErrors,
  LEAD_SOURCES,
  maxExtraUsers,
  PLAN_IDS,
  planName,
  type LeadSource,
  type OpportunityRecord,
  type PipelineStage,
  type PlanId,
  type SalesMeta,
  type SalesCommunication,
} from '../../../../../../../mocks/admin-sales';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { activityMarker } from '../../../_components/feed-drawers';
import {
  dateText,
  dateTimeText,
  money,
  parseMoney,
  SALES_KEY,
  STAGE_STYLE,
} from '../../../_components/sales-ui';

const saved = 'text-sm text-success';
const failed = 'text-sm text-danger';

/** The record's own data: firm, contact, value, plan, source, tags and the next step. */
export function DetailsForm({
  data,
  meta,
}: {
  data: OpportunityRecord;
  meta: SalesMeta | undefined;
}) {
  const opp = data.opportunity;
  const [form, setForm] = useState({
    firmName: opp.firmName,
    contactName: opp.contactName,
    email: opp.email ?? '',
    phone: opp.phone ?? '',
    value: opp.valueCents === null ? '' : (opp.valueCents / 100).toFixed(2),
    plan: (opp.plan ?? '') as PlanId | '',
    extraUsers: String(opp.extraUsers),
    source: opp.source as LeadSource,
    tagIds: opp.tags.map((tag) => tag.id),
    nextStep: opp.nextStep ?? '',
  });
  const [valueError, setValueError] = useState('');
  const update = useApiMutation(
    (body: Parameters<typeof adminSales.updateOpportunity>[0]) =>
      adminSales.updateOpportunity(body),
    { invalidate: SALES_KEY },
  );
  const errors = fieldErrors(update.error);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const extraLimit = form.plan ? maxExtraUsers(form.plan) : 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    const valueCents = parseMoney(form.value);
    if (Number.isNaN(valueCents)) {
      setValueError('Enter an amount like 2,400 or 2400.00.');
      return;
    }
    setValueError('');
    update.mutate({
      id: opp.id,
      firmName: form.firmName,
      contactName: form.contactName,
      email: form.email,
      phone: form.phone,
      valueCents,
      plan: form.plan,
      extraUsers: Number(form.extraUsers) || 0,
      source: form.source,
      tagIds: form.tagIds,
      nextStep: form.nextStep,
    });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Firm / company"
          maxLength={120}
          value={form.firmName}
          error={errors['firmName']}
          onChange={(event) => set('firmName', event.target.value)}
        />
        <Input
          label="Primary contact"
          maxLength={80}
          value={form.contactName}
          error={errors['contactName']}
          onChange={(event) => set('contactName', event.target.value)}
        />
        <Input
          label="Email"
          type="email"
          maxLength={160}
          value={form.email}
          error={errors['email']}
          onChange={(event) => set('email', event.target.value)}
        />
        <Input
          label="Phone"
          type="tel"
          maxLength={20}
          value={form.phone}
          error={errors['phone']}
          onChange={(event) => set('phone', event.target.value)}
        />
        <Input
          label="Estimated annual value ($)"
          inputMode="decimal"
          maxLength={14}
          value={form.value}
          error={valueError || errors['valueCents']}
          onChange={(event) => set('value', event.target.value)}
        />
        <Select
          label="Lead source"
          value={form.source}
          error={errors['source']}
          onChange={(event) => {
            const source = LEAD_SOURCES.find((item) => item.id === event.target.value);
            if (source) set('source', source.id);
          }}
          options={LEAD_SOURCES.map((source) => ({ value: source.id, label: source.label }))}
        />
        <Select
          label="Plan"
          value={form.plan}
          error={errors['plan']}
          onChange={(event) => {
            set('plan', PLAN_IDS.find((id) => id === event.target.value) ?? '');
            set('extraUsers', '0');
          }}
          options={[
            { value: '', label: 'Not decided' },
            ...PLAN_IDS.map((id) => ({ value: id, label: planName(id) })),
          ]}
        />
        {extraLimit > 0 ? (
          <Input
            label={`Extra users (0–${extraLimit})`}
            type="number"
            min={0}
            max={extraLimit}
            value={form.extraUsers}
            error={errors['extraUsers']}
            onChange={(event) => set('extraUsers', event.target.value)}
          />
        ) : null}
        <div className="sm:col-span-2">
          <Input
            label="Next step"
            maxLength={200}
            value={form.nextStep}
            error={errors['nextStep']}
            onChange={(event) => set('nextStep', event.target.value)}
          />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-text">Tags</legend>
        <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
          {(meta?.tags ?? []).map((tag) => (
            <Checkbox
              key={tag.id}
              label={tag.name}
              checked={form.tagIds.includes(tag.id)}
              onChange={(event) =>
                set(
                  'tagIds',
                  event.target.checked
                    ? [...form.tagIds, tag.id]
                    : form.tagIds.filter((id) => id !== tag.id),
                )
              }
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {update.isSuccess ? (
          <p role="status" className={saved}>
            Changes saved.
          </p>
        ) : null}
        {update.error && !Object.keys(errors).length ? (
          <p role="alert" className={failed}>
            {errorMessage(update.error)}
          </p>
        ) : null}
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}

/** Where the record is in its pipeline, the move control, and the full stage history. */
export function StageAndHistory({
  data,
  onMove,
  moving,
}: {
  data: OpportunityRecord;
  onMove: (stage: PipelineStage) => void;
  moving: boolean;
}) {
  const opp = data.opportunity;
  const stages = data.pipeline.stages.filter((stage) => stage.active || stage.id === opp.stageId);
  const [target, setTarget] = useState('');
  const [all, setAll] = useState(false);
  const items: TimelineItem[] = data.activity.slice(0, all ? undefined : 8).map((entry) => {
    const marker = activityMarker(entry.kind);
    return {
      id: entry.id,
      icon: marker.icon,
      tone:
        entry.kind === 'LOST'
          ? 'red'
          : entry.kind === 'WON' || entry.kind === 'APPOINTMENT_SCHEDULED'
            ? 'green'
            : entry.actor.kind === 'USER'
              ? 'blue'
              : 'navy',
      title: (
        <>
          {entry.text}
          {entry.detail ? <span className="block text-xs text-muted">{entry.detail}</span> : null}
        </>
      ),
      time: dateTimeText(entry.at),
      dateTime: entry.at,
      actor: entry.actor.kind === 'USER' ? entry.actor.name : `${entry.actor.name} (system)`,
    };
  });
  return (
    <div className="flex flex-col gap-4">
      <ol aria-label="Pipeline stages" className="flex flex-wrap gap-1.5">
        {stages.map((stage) => {
          const current = stage.id === opp.stageId;
          return (
            <li
              key={stage.id}
              aria-current={current ? 'step' : undefined}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${current ? `${STAGE_STYLE[stage.tone].head} outline-2 outline-action` : 'bg-table-head text-muted'}`}
            >
              {stage.name}
            </li>
          );
        })}
      </ol>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const stage = stages.find((item) => item.id === target);
          if (stage) onMove(stage);
        }}
      >
        <div className="min-w-56 flex-1">
          <Select
            label="Move to stage"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            options={[
              { value: '', label: 'Choose a stage' },
              ...stages
                .filter((stage) => stage.id !== opp.stageId)
                .map((stage) => ({ value: stage.id, label: stage.name })),
            ]}
          />
        </div>
        <Button type="submit" disabled={!target || moving}>
          {moving ? 'Moving…' : 'Move'}
        </Button>
      </form>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-heading">History</h3>
        <Timeline items={items} variant="rail" label="Record history" emptyText="No history yet." />
        {data.activity.length > 8 ? (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="mt-2 text-sm font-medium text-action hover:underline"
          >
            {all ? 'Show less' : `Show all ${data.activity.length} entries`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function NotesPanelBody({ data }: { data: OpportunityRecord }) {
  const [body, setBody] = useState('');
  const add = useApiMutation(
    (text: string) => adminSales.addNote({ id: data.opportunity.id, body: text }),
    { invalidate: SALES_KEY },
  );
  const errors = fieldErrors(add.error);
  return (
    <div className="flex flex-col gap-3">
      <form
        noValidate
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate(body, { onSuccess: () => setBody('') });
        }}
      >
        <Textarea
          label="Add a note"
          rows={2}
          maxLength={2000}
          value={body}
          error={errors['body']}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Add Note'}
          </Button>
        </div>
      </form>
      {data.notes.length ? (
        <ul aria-label="Notes" className="flex flex-col gap-2">
          {data.notes.map((note) => (
            <li key={note.id} className="rounded-lg bg-subtle p-3 text-sm text-text">
              <p className="whitespace-pre-line">{note.body}</p>
              <p className="mt-1 text-xs text-muted">
                {note.author} ·{' '}
                <time dateTime={note.createdAt}>{dateTimeText(note.createdAt)}</time>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No notes yet.</p>
      )}
    </div>
  );
}

const CHANNELS: { value: SalesCommunication['channel']; label: string }[] = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'Text message' },
];

export function CommunicationsPanelBody({ data }: { data: OpportunityRecord }) {
  const [channel, setChannel] = useState<SalesCommunication['channel']>('CALL');
  const [reached, setReached] = useState(false);
  const [summary, setSummary] = useState('');
  const log = useApiMutation(
    () => adminSales.logOutreach({ id: data.opportunity.id, channel, reached, summary }),
    { invalidate: SALES_KEY },
  );
  const errors = fieldErrors(log.error);
  return (
    <div className="flex flex-col gap-3">
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          log.mutate(undefined, {
            onSuccess: () => {
              setSummary('');
              setReached(false);
            },
          });
        }}
      >
        <Select
          label="Channel"
          value={channel}
          onChange={(event) => {
            const next = CHANNELS.find((item) => item.value === event.target.value);
            if (next) setChannel(next.value);
          }}
          options={CHANNELS}
        />
        <Input
          label="Summary (optional)"
          maxLength={300}
          value={summary}
          error={errors['summary']}
          onChange={(event) => setSummary(event.target.value)}
        />
        <Checkbox
          label="Reached the contact (two-way conversation)"
          checked={reached}
          onChange={(event) => setReached(event.target.checked)}
        />
        <div className="flex items-center justify-end">
          <Button type="submit" variant="secondary" disabled={log.isPending}>
            {log.isPending ? 'Saving…' : 'Log Outreach'}
          </Button>
        </div>
      </form>
      <p className="text-xs text-muted">
        Attempts so far: {data.opportunity.attempts}.{' '}
        {data.opportunity.contactedAt
          ? `First reached ${dateText(data.opportunity.contactedAt)}.`
          : 'Not reached yet.'}
      </p>
      {data.communications.length ? (
        <ul aria-label="Communications" className="flex flex-col">
          {data.communications.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap justify-between gap-2 border-b border-divider py-2 text-sm last:border-0"
            >
              <span className="text-text">
                <Badge tone={item.direction === 'INBOUND' ? 'success' : 'neutral'}>
                  {item.direction === 'INBOUND' ? 'In' : 'Out'}
                </Badge>{' '}
                {item.summary}
              </span>
              <span className="text-xs text-muted">
                {item.by} · <time dateTime={item.at}>{dateTimeText(item.at)}</time>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No calls, emails or texts yet.</p>
      )}
    </div>
  );
}

export function AssignmentPanelBody({
  data,
  meta,
}: {
  data: OpportunityRecord;
  meta: SalesMeta | undefined;
}) {
  const owner = data.opportunity.owner;
  const [ownerId, setOwnerId] = useState(owner?.id ?? '');
  const assign = useApiMutation(
    (next: string) => adminSales.assign({ ids: [data.opportunity.id], ownerId: next || null }),
    { invalidate: SALES_KEY },
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {owner ? (
          <Avatar name={owner.name} size="lg" />
        ) : (
          <span
            aria-hidden
            className="size-10 rounded-full border border-dashed border-control-border"
          />
        )}
        <div>
          <p className="font-semibold text-heading">{owner?.name ?? 'Unassigned'}</p>
          <p className="text-sm text-muted">{owner?.role ?? 'No owner yet'}</p>
        </div>
      </div>
      {meta?.permissions.assign ? (
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            assign.mutate(ownerId);
          }}
        >
          <div className="min-w-40 flex-1">
            <Select
              label="Owner"
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              options={[
                { value: '', label: 'Unassigned' },
                ...meta.reps.map((rep) => ({ value: rep.id, label: rep.name })),
              ]}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={assign.isPending || ownerId === (owner?.id ?? '')}
          >
            {assign.isPending ? 'Saving…' : 'Reassign'}
          </Button>
        </form>
      ) : null}
      {assign.error ? (
        <p role="alert" className={failed}>
          {errorMessage(assign.error)}
        </p>
      ) : null}
    </div>
  );
}

const TRANSACTION_TONE = {
  OPEN: 'info',
  UNDER_CONTRACT: 'purple',
  CLOSED: 'success',
  TERMINATED: 'danger',
} as const;
const TRANSACTION_LABEL = {
  OPEN: 'Open',
  UNDER_CONTRACT: 'Under Contract',
  CLOSED: 'Closed',
  TERMINATED: 'Terminated',
} as const;

/**
 * The linked transaction (docx §14). Its status changes arrive from Transactions and move the
 * record by themselves; the buttons stand in for those events until that module exists.
 */
export function TransactionPanelBody({ data }: { data: OpportunityRecord }) {
  const transaction = data.opportunity.transaction;
  const [reference, setReference] = useState('');
  const event = useApiMutation(
    (body: Parameters<typeof adminSales.transactionEvent>[0]) => adminSales.transactionEvent(body),
    { invalidate: SALES_KEY },
  );
  const errors = fieldErrors(event.error);
  const id = data.opportunity.id;
  if (!transaction)
    return (
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          event.mutate({ id, event: 'LINK', reference });
        }}
      >
        <p className="text-sm text-muted">No transaction is linked yet.</p>
        <Input
          label="Transaction reference"
          placeholder="TX-2026-0142"
          maxLength={30}
          value={reference}
          error={errors['reference']}
          onChange={(change) => setReference(change.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" disabled={event.isPending}>
            Link Transaction
          </Button>
        </div>
      </form>
    );
  const open = transaction.status === 'OPEN' || transaction.status === 'UNDER_CONTRACT';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-heading">{transaction.reference}</span>
        <Badge tone={TRANSACTION_TONE[transaction.status]}>
          {TRANSACTION_LABEL[transaction.status]}
        </Badge>
      </div>
      <p className="inline-flex items-center gap-1.5 text-sm text-text">
        <ArrowsClockwise aria-hidden weight="bold" className="size-4 text-success" />
        Synced to Transactions
      </p>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-muted">Linked</dt>
        <dd className="text-text">{dateText(transaction.linkedAt)}</dd>
        {transaction.estimatedCloseAt ? (
          <>
            <dt className="text-muted">Est. close</dt>
            <dd className="text-text">{dateText(transaction.estimatedCloseAt)}</dd>
          </>
        ) : null}
        {transaction.closedAt ? (
          <>
            <dt className="text-muted">Closed</dt>
            <dd className="text-text">{dateText(transaction.closedAt)}</dd>
          </>
        ) : null}
      </dl>
      {open ? (
        <div className="flex flex-col gap-2 rounded-lg bg-subtle p-3">
          <p className="text-xs text-muted">Events from Transactions (they move the stage):</p>
          <div className="flex flex-wrap gap-2">
            {transaction.status === 'OPEN' ? (
              <Button
                variant="secondary"
                disabled={event.isPending}
                onClick={() => event.mutate({ id, event: 'UNDER_CONTRACT' })}
              >
                Under Contract
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={event.isPending}
              onClick={() => event.mutate({ id, event: 'CLOSE' })}
            >
              Close
            </Button>
            <Button
              variant="secondary"
              disabled={event.isPending}
              onClick={() => event.mutate({ id, event: 'TERMINATE' })}
            >
              Terminate
            </Button>
          </div>
        </div>
      ) : null}
      {event.error && !Object.keys(errors).length ? (
        <p role="alert" className={failed}>
          {errorMessage(event.error)}
        </p>
      ) : null}
    </div>
  );
}

export function TasksPanelBody({ data }: { data: OpportunityRecord }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const add = useApiMutation(
    () => adminSales.addFollowUp({ id: data.opportunity.id, title, dueDate }),
    { invalidate: SALES_KEY },
  );
  const complete = useApiMutation((taskId: string) => adminSales.completeFollowUp(taskId), {
    invalidate: SALES_KEY,
  });
  const errors = fieldErrors(add.error);
  return (
    <div className="flex flex-col gap-3">
      {data.tasks.length ? (
        <ul aria-label="Follow-ups" className="flex flex-col">
          {data.tasks.map((task) => (
            <li key={task.id} className="border-b border-divider last:border-0">
              <Checkbox
                label={`${task.title} · due ${dateText(task.dueAt)}`}
                checked={task.done}
                disabled={task.done || complete.isPending}
                onChange={() => complete.mutate(task.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No follow-ups yet.</p>
      )}
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate(undefined, {
            onSuccess: () => {
              setTitle('');
              setDueDate('');
            },
          });
        }}
      >
        <Input
          label="New follow-up"
          maxLength={120}
          value={title}
          error={errors['title']}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input
          label="Due"
          type="date"
          value={dueDate}
          error={errors['dueDate']}
          onChange={(event) => setDueDate(event.target.value)}
        />
        <div className="flex justify-end sm:col-span-2 xl:col-span-1 2xl:col-span-2">
          <Button type="submit" variant="secondary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Add Follow-up'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function AppointmentsPanelBody({ data }: { data: OpportunityRecord }) {
  return data.appointments.length ? (
    <ul aria-label="Appointments" className="flex flex-col">
      {data.appointments.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-divider py-2 text-sm last:border-0"
        >
          <span>
            <span className="block font-medium text-heading">
              {appointmentTypeLabel(item.type)}
            </span>
            <time dateTime={item.startsAt} className="text-muted">
              {dateTimeText(item.startsAt)}
            </time>
            {item.assignedName ? <span className="text-muted"> · {item.assignedName}</span> : null}
          </span>
          <Badge
            tone={
              item.status === 'SCHEDULED'
                ? 'info'
                : item.status === 'COMPLETED'
                  ? 'success'
                  : 'neutral'
            }
          >
            {item.status === 'SCHEDULED'
              ? 'Scheduled'
              : item.status === 'COMPLETED'
                ? 'Completed'
                : 'Cancelled'}
          </Badge>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted">No appointments yet.</p>
  );
}

export function DocumentsPanelBody({ data }: { data: OpportunityRecord }) {
  return data.documents.length ? (
    <ul aria-label="Documents" className="flex flex-col gap-2">
      {data.documents.map((document) => (
        <li key={document.id} className="flex items-center gap-3 text-sm">
          <FilePdf aria-hidden weight="fill" className="size-6 shrink-0 text-file-pdf" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-heading">{document.name}</span>
            <span className="text-xs text-muted">Added {dateText(document.addedAt)}</span>
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted">No documents yet.</p>
  );
}

/** "$24,500" or a quiet "No value yet": a value is never invented. */
export const valueText = (cents: number | null) => (cents === null ? 'No value yet' : money(cents));
