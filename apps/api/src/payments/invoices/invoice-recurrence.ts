import type { TxClient } from '@firmivra/db';
import {
  type InvoiceRecurrenceInput,
  type RecurrenceRule,
  recurringPeriodOn,
} from '@firmivra/types';
import type { AuditService } from '../../audit/audit.service.js';
import { conflict, day, type InvoiceRow, titleOf, toDate } from './invoice-view.js';

// IP-F05: an invoice made recurring in Create Invoice starts a schedule (`recurring_invoices`).
// While the invoice is a draft the schedule waits PAUSED, so nothing is ever made or sent from a
// draft; sending the invoice starts it ACTIVE from the day the invoice opens, as its first
// period. Recurrence never turns on auto-send or AutoPay (Octavia's IP-010): both are written off.
// A schedule is never deleted (no DELETE grant): turning Recurring off, or canceling the draft,
// ends it.

type RecurringRow = NonNullable<InvoiceRow['recurring']>;

export const endTooSoon = () =>
  conflict(
    'RECURRING_END_TOO_SOON',
    'The schedule ends before its second invoice; choose a later end date',
  );

/** A schedule that only waits for its draft: it never made or sent anything. */
const waiting = (r: RecurringRow | null): r is RecurringRow =>
  r !== null && r.status === 'PAUSED' && r.occurrences === 0;

const ruleOf = (r: {
  frequency: string;
  intervalCount: number | null;
  intervalUnit: RecurrenceRule['intervalUnit'];
}): RecurrenceRule => ({
  frequency: r.frequency as RecurrenceRule['frequency'],
  intervalCount: r.intervalCount,
  intervalUnit: r.intervalUnit,
});

/** The second invoice's day from `startOn`; 409 when the end date comes before it. */
function nextAfter(startOn: string, rule: RecurrenceRule, endOn: string | null): string {
  const next = recurringPeriodOn(startOn, rule, 1);
  if (endOn !== null && endOn < next) throw endTooSoon();
  return next;
}

/**
 * After a draft's fields and lines are written (`row` read again): keeps its waiting schedule in
 * step with `input` (made, changed, or ended when Recurring is off). `today` is the firm's.
 */
export async function syncDraftRecurrence(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  actorUserId: string,
  row: InvoiceRow,
  input: InvoiceRecurrenceInput | null | undefined,
  today: string,
): Promise<void> {
  const current = waiting(row.recurring) ? row.recurring : null;
  const invoiceWhere = { businessId_id: { businessId, id: row.id } };
  if (!input) {
    if (!current) return;
    await tx.invoice.update({
      where: invoiceWhere,
      data: { recurringInvoiceId: null, recurringPeriodOn: null },
    });
    await endSchedule(tx, audit, businessId, row, current.id, 'recurring_off');
    return;
  }
  const custom = input.frequency === 'CUSTOM';
  const rule: RecurrenceRule = {
    frequency: input.frequency,
    intervalCount: custom ? (input.intervalCount ?? null) : null,
    intervalUnit: custom ? (input.intervalUnit ?? null) : null,
  };
  const scheduled = day(row.scheduledFor);
  const startOn = scheduled !== null && scheduled > today ? scheduled : today;
  const endOn = input.endOn ?? null;
  const nextSendOn = nextAfter(startOn, rule, endOn);
  const data = {
    clientId: row.clientId,
    engagementId: row.engagement?.id ?? null,
    name: titleOf(row).slice(0, 100),
    frequency: rule.frequency,
    intervalCount: rule.intervalCount ?? null,
    intervalUnit: rule.intervalUnit ?? null,
    startOn: toDate(startOn),
    nextSendOn: toDate(nextSendOn),
    endOn: endOn === null ? null : toDate(endOn),
    maxOccurrences: endOn === null ? (input.maxOccurrences ?? null) : null,
    paymentTerms: row.paymentTerms,
    discountCents: row.discountCents,
    notesToClient: row.notesToClient,
  };
  let id: string;
  if (current) {
    id = current.id;
    await tx.recurringInvoice.update({ where: { businessId_id: { businessId, id } }, data });
    await tx.recurringInvoiceLine.deleteMany({ where: { businessId, recurringInvoiceId: id } });
  } else {
    ({ id } = await tx.recurringInvoice.create({
      data: {
        businessId,
        ...data,
        status: 'PAUSED',
        pausedAt: new Date(),
        autoSend: false,
        autopay: false,
        createdByUserId: actorUserId,
      },
      select: { id: true },
    }));
  }
  await tx.recurringInvoiceLine.createMany({
    data: row.lines.map((l, i) => ({
      businessId,
      recurringInvoiceId: id,
      description: l.description,
      quantity: l.quantity,
      unitAmountCents: l.unitAmountCents,
      sortOrder: i,
    })),
  });
  await tx.invoice.update({
    where: invoiceWhere,
    data: { recurringInvoiceId: id, recurringPeriodOn: toDate(startOn) },
  });
  await audit.logIn(
    tx,
    current ? 'recurring_invoice.updated' : 'recurring_invoice.created',
    { type: 'recurring_invoice', id },
    {
      invoiceId: row.id,
      clientId: row.clientId,
      frequency: rule.frequency,
      intervalCount: rule.intervalCount,
      intervalUnit: rule.intervalUnit,
      endOn,
      maxOccurrences: data.maxOccurrences,
    },
  );
}

/**
 * Sending the draft starts its waiting schedule: ACTIVE from `openOn` (the day the invoice opens),
 * which is its first period, so the next invoice is the one after. 409 RECURRING_END_TOO_SOON when
 * the end date now comes before that.
 */
export async function startRecurrence(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  row: InvoiceRow,
  openOn: string,
): Promise<void> {
  const r = row.recurring;
  if (!waiting(r)) return;
  const nextSendOn = nextAfter(openOn, ruleOf(r), day(r.endOn));
  await tx.recurringInvoice.update({
    where: { businessId_id: { businessId, id: r.id } },
    data: {
      status: 'ACTIVE',
      pausedAt: null,
      startOn: toDate(openOn),
      nextSendOn: toDate(nextSendOn),
      occurrences: 1,
    },
  });
  await tx.invoice.update({
    where: { businessId_id: { businessId, id: row.id } },
    data: { recurringPeriodOn: toDate(openOn) },
  });
  await audit.logIn(
    tx,
    'recurring_invoice.started',
    { type: 'recurring_invoice', id: r.id },
    { invoiceId: row.id, clientId: row.clientId, startOn: openOn, nextSendOn },
  );
}

/** Canceling the draft ends the schedule waiting for it (one already running is the firm's). */
export async function endDraftRecurrence(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  row: InvoiceRow,
): Promise<void> {
  if (row.status !== 'DRAFT' || !waiting(row.recurring)) return;
  await endSchedule(tx, audit, businessId, row, row.recurring.id, 'draft_canceled');
}

async function endSchedule(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  row: InvoiceRow,
  id: string,
  reason: 'recurring_off' | 'draft_canceled',
) {
  await tx.recurringInvoice.update({
    where: { businessId_id: { businessId, id } },
    data: { status: 'ENDED', endedAt: new Date(), pausedAt: null, nextSendOn: null },
  });
  await audit.logIn(
    tx,
    'recurring_invoice.ended',
    { type: 'recurring_invoice', id },
    { invoiceId: row.id, clientId: row.clientId, reason },
  );
}
