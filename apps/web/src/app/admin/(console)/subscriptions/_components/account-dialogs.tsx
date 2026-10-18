'use client';

import { Button, Callout, Input, Modal, Select, Skeleton, Table, Textarea } from '@firmivra/ui';
import { Info, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminSubscriptions,
  CYCLE_LABELS,
  cycleCents,
  monthlyListCents,
  PLAN_ORDER,
  PLANS,
  type BillingCycle,
  type CreateSubscriptionBody,
  type PlanId,
  type SubscriptionEvent,
} from '../../../../../mocks/admin-subscriptions';
import { fieldErrors, loadErrorText, money, seatText, timeText } from './format';
import {
  ActionForm,
  ChoiceGroup,
  ChoicePill,
  DetailDialog,
  KEY,
  useAct,
  type DialogProps,
  type FormProps,
} from './parts';
import { CyclePills } from './plan-dialogs';

export function NoteDialog({ id, firm, onClose, onDone }: DialogProps) {
  const [text, setText] = useState('');
  const add = useAct((body: { id: string; text: string }) => adminSubscriptions.addNote(body));
  const fields = fieldErrors(add.error);
  return (
    <Modal open title="Add Internal Note" subtitle={firm} onClose={onClose}>
      <ActionForm
        submitLabel="Add Note"
        pending={add.isPending}
        error={add.error}
        onCancel={onClose}
        onSubmit={() => add.mutate({ id, text }, { onSuccess: (result) => onDone(result.message) })}
      >
        <Textarea
          label="Note"
          required
          rows={4}
          maxLength={1000}
          placeholder="Billing exceptions, cancellation requests, follow-ups..."
          value={text}
          error={fields['text']}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-muted">
          Internal only: the firm never sees it. Your name and the time are kept with it.
        </p>
      </ActionForm>
    </Modal>
  );
}

const categoryLabel: Record<SubscriptionEvent['category'], string> = {
  LIFECYCLE: 'Subscription',
  BILLING: 'Billing',
  NOTE: 'Note',
  NOTIFICATION: 'Notification',
  ACCESS: 'Access',
};

/** The read-only audit trail: every change with who, when, old and new values and the reason. */
export function ActivityLogDialog({ id, firm, onClose }: DialogProps) {
  return (
    <DetailDialog id={id} title="Activity Log" subtitle={firm} onClose={onClose}>
      {(sub) => (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm text-muted">
            <ShieldCheck aria-hidden weight="fill" className="size-4 shrink-0 text-success" />
            Read-only. Entries can’t be edited or removed.
          </p>
          <Table
            dense
            caption={`Activity log for ${sub.firm.name}`}
            noun="entries"
            rows={sub.events}
            rowKey={(event) => event.id}
            pageSize={8}
            emptyTitle="No activity yet"
            emptyText="Changes to this subscription will be listed here."
            columns={[
              {
                id: 'at',
                label: 'When',
                cell: (event) => (
                  <time dateTime={event.at} className="whitespace-nowrap">
                    {timeText(event.at)}
                  </time>
                ),
              },
              {
                id: 'action',
                label: 'Action',
                cell: (event) => (
                  <span className="block min-w-36">
                    <span className="block font-medium text-heading">{event.action}</span>
                    <span className="block text-muted">{categoryLabel[event.category]}</span>
                  </span>
                ),
              },
              {
                id: 'actor',
                label: 'By',
                cell: (event) => (
                  <span className="block whitespace-nowrap">
                    {event.actor}
                    <span className="block text-muted">{event.role}</span>
                  </span>
                ),
              },
              {
                id: 'change',
                label: 'Change',
                cell: (event) => (
                  <span className="block min-w-32">
                    {event.from || event.to
                      ? [event.from ?? '—', event.to ?? '—'].join(' → ')
                      : '—'}
                    {event.amountCents ? (
                      <span className="block text-muted">
                        {event.amountCents < 0 ? '−' : ''}
                        {money(Math.abs(event.amountCents))}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                id: 'reason',
                label: 'Reason',
                cell: (event) => <span className="block min-w-40">{event.reason ?? '—'}</span>,
              },
            ]}
          />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </DetailDialog>
  );
}

/** "View as Firm Admin": permission-gated, time-limited, bannered while it runs, fully logged. */
function SupportViewForm({ sub, onClose, onDone }: FormProps) {
  const [minutes, setMinutes] = useState('30');
  const [reason, setReason] = useState('');
  const start = useAct((body: { id: string; reason: string; minutes: number }) =>
    adminSubscriptions.startSupportView(body),
  );
  const fields = fieldErrors(start.error);
  return (
    <ActionForm
      submitLabel="Start Support View"
      pending={start.isPending}
      error={start.error}
      blocked={sub.status === 'CLOSED' ? 'A closed account has no workspace to view.' : null}
      onCancel={onClose}
      onSubmit={() =>
        start.mutate(
          { id: sub.id, reason, minutes: Number(minutes) },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <Callout
        icon={WarningCircle}
        surface="warning"
        tone="amber"
        size="compact"
        title="Controlled support access"
      >
        You see {sub.firm.name}’s workspace as its firm admin for a limited time. A banner stays on
        screen until it ends, and every step is logged. Client documents and confidential client
        records stay hidden.
      </Callout>
      {sub.supportView ? (
        <Callout icon={Info} surface="info" size="compact">
          A support view is already running. Starting again replaces it.
        </Callout>
      ) : null}
      <Select
        label="Duration"
        options={[
          { value: '15', label: '15 minutes' },
          { value: '30', label: '30 minutes' },
          { value: '60', label: '60 minutes' },
        ]}
        value={minutes}
        error={fields['minutes']}
        onChange={(event) => setMinutes(event.target.value)}
      />
      <Textarea
        label="Reason"
        required
        rows={3}
        maxLength={500}
        placeholder="The support question you are looking into..."
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
    </ActionForm>
  );
}

export function SupportViewDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Impersonate as Firm Admin" subtitle={firm} onClose={onClose}>
      {(sub) => <SupportViewForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

const EXPORT_COLUMNS =
  'firm, email, domain, plan, billing cycle, status, list and discounted monthly price, seats used and allowed, next billing, end date, Auto-Renew, add-ons and discount';

/** Subscription and billing metadata only, as a CSV file. */
export function ExportDialog({
  ids,
  scope,
  onClose,
  onDone,
}: {
  ids: string[];
  scope: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const exportCsv = useApiMutation(
    (list: string[]) => adminSubscriptions.exportCsv({ ids: list }),
    {
      invalidate: [KEY],
    },
  );
  return (
    <Modal open title="Export Subscription Data" subtitle={scope} onClose={onClose}>
      <ActionForm
        submitLabel="Download CSV"
        pending={exportCsv.isPending}
        error={exportCsv.error}
        blocked={ids.length ? null : 'There is nothing to export with these filters.'}
        onCancel={onClose}
        onSubmit={() =>
          exportCsv.mutate(ids, {
            onSuccess: ({ csv, count }) => {
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = `firmivra-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
              link.click();
              URL.revokeObjectURL(url);
              onDone(`Exported ${count} ${count === 1 ? 'subscription' : 'subscriptions'}.`);
            },
          })
        }
      >
        <p className="text-sm text-text">
          {ids.length} {ids.length === 1 ? 'subscription' : 'subscriptions'}: {EXPORT_COLUMNS}.
        </p>
        <Callout icon={ShieldCheck} surface="plain" tone="green" size="compact">
          Client records and documents are never included. The export is logged.
        </Callout>
      </ActionForm>
    </Modal>
  );
}

const OWNERS = ['Jordan Sales', 'Casey Accounts'];

/** Manual enrollment: a 14-day trial or a paid plan for an approved firm without one. */
export function AddSubscriptionDialog({
  trial,
  onClose,
  onDone,
}: {
  trial: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const firms = useApiQuery([KEY, 'firms-without'], () =>
    adminSubscriptions.firmsWithoutSubscription(),
  );
  const [firmId, setFirmId] = useState('');
  const [mode, setMode] = useState<'TRIAL' | 'PAID'>(trial ? 'TRIAL' : 'PAID');
  const [plan, setPlan] = useState<PlanId>('TEAM_PRO');
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [seats, setSeats] = useState(String(PLANS.TEAM_PRO.includedSeats));
  const [owner, setOwner] = useState('');
  const create = useAct((body: CreateSubscriptionBody) => adminSubscriptions.create(body));
  const fields = fieldErrors(create.error);
  const info = PLANS[plan];
  const count = Number(seats);
  const firm = firms.data?.find((candidate) => candidate.id === firmId);
  const first = cycleCents(
    monthlyListCents(plan, Number.isInteger(count) ? count : info.includedSeats, []),
    cycle,
  );
  return (
    <Modal open title={trial ? 'Start Trial for Firm' : 'Add Subscription'} onClose={onClose}>
      {firms.isPending ? (
        <div role="status" aria-label="Loading firms" className="flex flex-col gap-3">
          <Skeleton className="h-10" />
          <Skeleton />
        </div>
      ) : (
        <ActionForm
          submitLabel={mode === 'TRIAL' ? 'Start Trial' : 'Add Subscription'}
          pending={create.isPending}
          error={create.error}
          blocked={
            firms.isError
              ? loadErrorText(firms.error)
              : firms.data?.length
                ? null
                : 'Every approved firm already has a subscription.'
          }
          onCancel={onClose}
          onSubmit={() =>
            create.mutate(
              { firmId, mode, plan, cycle, seats: count, accountOwner: owner },
              { onSuccess: (result) => onDone(result.message) },
            )
          }
        >
          <Select
            label="Firm"
            required
            options={[
              { value: '', label: 'Choose an approved firm...' },
              ...(firms.data ?? []).map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
              })),
            ]}
            value={firmId}
            error={fields['firmId']}
            onChange={(event) => setFirmId(event.target.value)}
          />
          <ChoiceGroup legend="Start as" error={fields['mode']}>
            <ChoicePill
              name="start-mode"
              value="TRIAL"
              checked={mode === 'TRIAL'}
              onChange={() => setMode('TRIAL')}
            >
              14-day trial
            </ChoicePill>
            <ChoicePill
              name="start-mode"
              value="PAID"
              checked={mode === 'PAID'}
              onChange={() => setMode('PAID')}
            >
              Paid plan
            </ChoicePill>
          </ChoiceGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Plan"
              options={PLAN_ORDER.map((id) => ({
                value: id,
                label: `${PLANS[id].name} · ${money(PLANS[id].monthlyCents)}/mo`,
              }))}
              value={plan}
              error={fields['plan']}
              onChange={(event) => {
                const next = PLAN_ORDER.find((id) => id === event.target.value) ?? plan;
                setPlan(next);
                setSeats(String(PLANS[next].includedSeats));
              }}
            />
            <Input
              label="Seats"
              type="number"
              inputMode="numeric"
              min={info.includedSeats}
              max={info.maxSeats}
              value={seats}
              error={fields['seats']}
              onChange={(event) => setSeats(event.target.value)}
            />
          </div>
          <CyclePills value={cycle} onChange={setCycle} error={fields['cycle']} />
          <Select
            label="Account owner"
            options={[
              { value: '', label: 'Not assigned' },
              ...OWNERS.map((name) => ({ value: name, label: name })),
            ]}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
          <Callout
            icon={Info}
            surface="info"
            size="compact"
            title={mode === 'TRIAL' ? 'Trial' : 'First charge'}
          >
            {mode === 'TRIAL'
              ? `${info.name} for 14 days from today. Nothing is charged; staff follow up before it ends.`
              : `${money(first)} today (${seatText(Number.isInteger(count) ? count : info.includedSeats)}, ${CYCLE_LABELS[cycle].toLowerCase()}). The subscription starts only if the charge succeeds.`}
          </Callout>
          {mode === 'PAID' && firm && !firm.hasCard ? (
            <Callout icon={WarningCircle} surface="warning" tone="amber" size="compact">
              {firm.name} has no payment method on file. Start a trial, or send a payment link
              first.
            </Callout>
          ) : null}
        </ActionForm>
      )}
    </Modal>
  );
}
