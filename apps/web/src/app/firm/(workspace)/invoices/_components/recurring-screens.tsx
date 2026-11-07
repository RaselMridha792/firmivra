'use client';

import {
  INVOICE_ERRORS,
  type RecurringInvoiceDetail,
  type RecurringInvoiceRow,
} from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Modal,
  Table,
  Tabs,
  Toast,
  Toggle,
  type Column,
} from '@firmivra/ui';
import { ArrowsClockwise, DotsThreeVertical, Plus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { card, dayText, INV_KEY, money, quiet } from './inv-shared';
import { RECURRING_LABEL, RECURRING_TONE, SubHeader, frequencyText } from './invoice-routes';

// IP-F18 (Octavia's Invoices & Payments review, Oct 27): Recurring Invoices, managed. The list has
// its figures, tabs and a row menu; a schedule's page has what it bills, the invoices it made, its
// next send days in the firm's time zone and its history. Owner and Admin pause, resume or end a
// schedule and turn Auto-send on or off; AutoPay stays off (it needs a payment provider that
// supports it and the client's own authorization). Nothing here makes or sends an invoice.

type Action = 'pause' | 'resume' | 'end' | 'send-now';
const TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'PAUSED', label: 'Paused' },
  { id: 'ENDED', label: 'Ended' },
] as const;
const DONE: Record<Action, string> = {
  pause: 'Paused: no invoice is made until it resumes.',
  resume: 'Resumed from the next send day.',
  end: 'Ended: no more invoices are made.',
  'send-now': 'The next invoice was made and sent to the client.',
};

/**
 * Send Now, Pause, Resume and End for Owner and Admin; Send Now and End ask first. `onDone` gets
 * the new state.
 */
function useScheduleActions(onDone: (d: RecurringInvoiceDetail, text: string) => void) {
  const qc = useQueryClient();
  const [ending, setEnding] = useState<{ id: string; name: string }>();
  const [sending, setSending] = useState<{ id: string; name: string; client: string }>();
  const [error, setError] = useState<string>();
  const run = async (id: string, action: Action) => {
    setError(undefined);
    try {
      const d = await api.invoices.recurringAction(id, action);
      await qc.invalidateQueries({ queryKey: [...INV_KEY] });
      onDone(d, DONE[action]);
    } catch (e) {
      setError(errorMessage(e, INVOICE_ERRORS));
    }
  };
  const items = (r: Pick<RecurringInvoiceRow, 'id' | 'name' | 'status' | 'client'>) => [
    ...(r.status === 'ACTIVE'
      ? [
          {
            label: 'Send Now',
            onSelect: () => setSending({ id: r.id, name: r.name, client: r.client.displayName }),
          },
        ]
      : []),
    ...(r.status === 'ACTIVE' ? [{ label: 'Pause', onSelect: () => void run(r.id, 'pause') }] : []),
    ...(r.status === 'PAUSED'
      ? [{ label: 'Resume', onSelect: () => void run(r.id, 'resume') }]
      : []),
    ...(r.status === 'ACTIVE' || r.status === 'PAUSED'
      ? [{ label: 'End', danger: true, onSelect: () => setEnding({ id: r.id, name: r.name }) }]
      : []),
  ];
  const dialog = ending ? (
    <Modal
      open
      title="End this recurring invoice?"
      onClose={() => setEnding(undefined)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setEnding(undefined)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const id = ending.id;
              setEnding(undefined);
              void run(id, 'end');
            }}
          >
            End Recurring Invoice
          </Button>
        </>
      }
    >
      <p className="text-sm text-text" data-testid="end-confirm">
        {ending.name} makes no more invoices. The invoices it already made stay as they are, and its
        history is kept. This cannot be undone: set up a new recurring invoice to start again.
      </p>
    </Modal>
  ) : sending ? (
    <Modal
      open
      title="Send the next invoice now?"
      onClose={() => setSending(undefined)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setSending(undefined)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const id = sending.id;
              setSending(undefined);
              void run(id, 'send-now');
            }}
          >
            Send Now
          </Button>
        </>
      }
    >
      <p className="text-sm text-text" data-testid="send-now-confirm">
        The next invoice of {sending.name} is made now and sent to {sending.client}, as Send does.
        The schedule then moves to the send day after.
      </p>
    </Modal>
  ) : null;
  return { items, dialog, error };
}

/** /invoices/recurring: the firm's recurring invoices. */
export function RecurringInvoicesScreen() {
  const { role } = useFirm();
  const router = useRouter();
  const canChange = role === 'OWNER' || role === 'ADMIN';
  const q = useApiQuery([...INV_KEY, 'recurring'], () => api.invoices.recurring());
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ALL');
  const [notice, setNotice] = useState<string>();
  const actions = useScheduleActions((_, text) => setNotice(text));
  const all = q.data?.items ?? [];
  const inTab = (r: RecurringInvoiceRow) =>
    tab === 'ALL' || r.status === tab || (tab === 'ENDED' && r.status === 'COMPLETED');
  const active = all.filter((r) => r.status === 'ACTIVE');
  const next = active
    .map((r) => r.nextSendOn)
    .filter((d): d is string => d !== null)
    .sort()[0];
  const columns: Column<RecurringInvoiceRow>[] = [
    {
      id: 'name',
      label: 'Schedule',
      cell: (r) => (
        <Link
          href={`/invoices/recurring/${r.id}`}
          className="font-medium text-link hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    { id: 'client', label: 'Client', cell: (r) => r.client.displayName },
    { id: 'frequency', label: 'Frequency', cell: frequencyText },
    { id: 'next', label: 'Next Invoice', cell: (r) => dayText(r.nextSendOn) },
    { id: 'amount', label: 'Amount', className: 'text-right', cell: (r) => money(r.amountCents) },
    { id: 'send', label: 'Sends', cell: (r) => (r.autoSend ? 'Automatically' : 'After review') },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => <Badge tone={RECURRING_TONE[r.status]}>{RECURRING_LABEL[r.status]}</Badge>,
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (r) => (
        <ActionMenu
          label={`Actions for ${r.name}`}
          trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
          align="right"
          sections={[
            {
              items: [
                {
                  label: 'View',
                  onSelect: () => router.push(`/invoices/recurring/${r.id}`),
                },
                ...(canChange ? actions.items(r) : []),
              ],
            },
          ]}
        />
      ),
    },
  ];
  const stat = (label: string, value: string, testId: string) => (
    <div className={card} data-testid={testId}>
      <p className="font-display text-2xl font-bold text-heading">{value}</p>
      <p className="text-sm text-text">{label}</p>
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="recurring-invoices">
      <SubHeader
        icon={ArrowsClockwise}
        title="Recurring Invoices"
        subtitle="Invoices that repeat on a schedule, and when the next one goes out."
      />
      {notice ? <Toast message={notice} onDismiss={() => setNotice(undefined)} /> : null}
      {actions.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {actions.error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="recurring-cards">
        {stat('Active', String(active.length), 'card-active')}
        {stat('Paused', String(all.filter((r) => r.status === 'PAUSED').length), 'card-paused')}
        {stat('Next invoice', next ? dayText(next) : '—', 'card-next')}
        {stat(
          'Billed each cycle (active)',
          money(active.reduce((n, r) => n + r.amountCents, 0)),
          'card-amount',
        )}
      </div>
      <section className={`${card} flex flex-col gap-3`} aria-label="Recurring invoices">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            variant="underline"
            label="Recurring invoice views"
            items={TABS.map((t) => ({
              id: t.id,
              label: t.label,
              count: all.filter(
                (r) =>
                  t.id === 'ALL' ||
                  r.status === t.id ||
                  (t.id === 'ENDED' && r.status === 'COMPLETED'),
              ).length,
            }))}
            value={tab}
            onChange={(id) => setTab(id as typeof tab)}
          />
          {canChange ? (
            <Link
              href="/invoices/new"
              className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:opacity-90"
            >
              <Plus aria-hidden weight="bold" className="size-4" /> New Recurring Invoice
            </Link>
          ) : null}
        </div>
        <Table
          rows={all.filter(inTab)}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Recurring invoices"
          dense
          noun="schedules"
          pageSize={25}
          loading={q.isPending}
          keepHeaderWhenEmpty
          emptyTitle={
            q.isError ? 'Recurring invoices are not available' : 'No recurring invoices here'
          }
          emptyText={
            q.isError
              ? errorMessage(q.error, INVOICE_ERRORS)
              : 'Create an invoice and turn Recurring on: it starts once the invoice is sent.'
          }
        />
      </section>
      {actions.dialog}
    </div>
  );
}

const ACTION_WORD: Record<string, string> = {
  created: 'Set up',
  started: 'Started (its first invoice sent)',
  updated: 'Changed',
  paused: 'Paused',
  resumed: 'Resumed',
  ended: 'Ended',
  invoice_made: 'Invoice made',
  period_skipped: 'Period already made; moved on',
};

/** /invoices/recurring/[id]: one recurring invoice. */
export function RecurringDetailScreen({ id }: { id: string }) {
  const { role } = useFirm();
  const canChange = role === 'OWNER' || role === 'ADMIN';
  const qc = useQueryClient();
  const q = useApiQuery([...INV_KEY, 'recurring', id], () => api.invoices.recurringOne(id));
  const [notice, setNotice] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const actions = useScheduleActions((d, text) => {
    qc.setQueryData([...INV_KEY, 'recurring', id], d);
    setNotice(text);
  });
  const d = q.data;
  const autoSend = async (on: boolean) => {
    setSaveError(undefined);
    try {
      const next = await api.invoices.updateRecurring(id, { autoSend: on });
      qc.setQueryData([...INV_KEY, 'recurring', id], next);
      await qc.invalidateQueries({ queryKey: [...INV_KEY, 'recurring'], exact: true });
      setNotice(on ? 'Auto-send is on.' : 'Auto-send is off: each invoice waits for review.');
    } catch (e) {
      setSaveError(errorMessage(e, INVOICE_ERRORS));
    }
  };
  if (!d) {
    return (
      <div className="flex min-w-0 flex-col gap-5" data-testid="recurring-detail">
        <SubHeader icon={ArrowsClockwise} title="Recurring Invoice" subtitle="" />
        <p className={quiet}>{q.isError ? errorMessage(q.error, INVOICE_ERRORS) : 'Loading…'}</p>
      </div>
    );
  }
  const ends =
    d.endOn !== null
      ? `On ${dayText(d.endOn)}`
      : d.maxOccurrences !== null
        ? `After ${d.maxOccurrences} invoices`
        : 'Never';
  const facts: [string, string][] = [
    ['Client', d.client.displayName],
    ['Frequency', frequencyText(d)],
    ['Amount each time', money(d.amountCents)],
    ['Started', dayText(d.startOn)],
    ['Ends', ends],
    ['Invoices made', String(d.occurrences)],
    [
      'Delivery',
      d.delivery === 'EMAIL_AND_PORTAL'
        ? 'Email and portal'
        : d.delivery === 'EMAIL'
          ? 'Email'
          : 'Portal',
    ],
    ['Time zone', d.timezone],
  ];
  const menu = canChange && !d.waiting ? actions.items(d) : [];
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="recurring-detail">
      <SubHeader icon={ArrowsClockwise} title={d.name} subtitle={d.client.displayName} />
      {notice ? <Toast message={notice} onDismiss={() => setNotice(undefined)} /> : null}
      {actions.error || saveError ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {actions.error ?? saveError}
        </p>
      ) : null}
      {d.waiting ? (
        <p role="status" className="rounded-lg bg-info-soft p-3 text-sm text-info">
          This recurring invoice starts when its draft invoice is sent. Change it on that draft.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={RECURRING_TONE[d.status]}>{RECURRING_LABEL[d.status]}</Badge>
        {menu.map((m) => (
          <Button key={m.label} variant="secondary" onClick={m.onSelect}>
            {m.label}
          </Button>
        ))}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Schedule" data-testid="recurring-facts">
          <h2 className="mb-3 font-display text-lg font-bold text-heading">Schedule</h2>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-text">{k}</dt>
                <dd className="text-heading">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={card} aria-label="Sending" data-testid="recurring-sending">
          <h2 className="mb-3 font-display text-lg font-bold text-heading">Sending</h2>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-heading">
              Auto-send: each invoice goes to the client by itself
            </span>
            <Toggle
              label="Auto-send"
              checked={d.autoSend}
              disabled={!canChange || d.status === 'ENDED' || d.status === 'COMPLETED'}
              onChange={(on) => void autoSend(on)}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            Off: each invoice is made as a draft for the firm to review and send.
          </p>
          <p className="mt-3 text-sm text-text" data-testid="autopay-note">
            AutoPay is off. It needs a payment provider that supports it and the client&apos;s own
            authorization, which are not set up.
          </p>
          <h3 className="mt-4 mb-2 text-sm font-semibold text-heading">Next send days</h3>
          {d.upcoming.length ? (
            <ul
              className="flex flex-col gap-1 text-sm text-heading"
              data-testid="recurring-upcoming"
            >
              {d.upcoming.map((u) => (
                <li key={u}>
                  {dayText(u)} <span className="text-xs text-muted">({d.timezone})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              {d.status === 'PAUSED' ? 'None while paused.' : 'No more invoices.'}
            </p>
          )}
        </section>
      </div>
      <section className={card} aria-label="What it bills">
        <h2 className="mb-3 font-display text-lg font-bold text-heading">What it bills</h2>
        <ul className="flex flex-col gap-1 text-sm text-heading">
          {d.lines.map((l, i) => (
            <li key={`${l.description}${i}`} className="flex justify-between gap-3">
              <span>
                {l.description} × {l.quantity}
              </span>
              <span>{money(Math.round(l.quantity * l.unitAmountCents))}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={card} aria-label="Invoices made" data-testid="recurring-invoices-made">
        <h2 className="mb-3 font-display text-lg font-bold text-heading">Invoices made</h2>
        {d.invoices.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {d.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-3">
                <Link href={`/invoices/${i.id}`} className="font-medium text-link hover:underline">
                  {i.number}
                </Link>
                <span className="text-text">for {dayText(i.periodOn)}</span>
                <span className="text-heading">{money(i.totalCents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={quiet}>None yet.</p>
        )}
      </section>
      <section className={card} aria-label="History" data-testid="recurring-history">
        <h2 className="mb-3 font-display text-lg font-bold text-heading">History</h2>
        <ul className="flex flex-col gap-1 text-sm text-heading">
          {d.history.map((h, i) => (
            <li key={`${h.at}${i}`}>
              {ACTION_WORD[h.action] ?? h.action} · {new Date(h.at).toLocaleString('en-US')}
              {h.by ? ` · ${h.by}` : ''}
            </li>
          ))}
        </ul>
      </section>
      {actions.dialog}
    </div>
  );
}
