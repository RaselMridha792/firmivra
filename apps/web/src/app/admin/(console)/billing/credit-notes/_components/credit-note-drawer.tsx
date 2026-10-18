'use client';

import { Button, Drawer, Skeleton, Timeline, type TimelineItem } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  CheckCircle,
  DownloadSimple,
  FileText,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  Receipt,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { adminBilling, type BillingCreditNote } from '../../../../../../mocks/admin-billing';
import { useApiQuery } from '../../../../../../lib/query';
import {
  formatDate,
  formatDateTime,
  formatDayOf,
  formatMoney,
} from '../../_components/billing-format';
import { CREDIT_NOTE_STATUS_LABELS, CREDIT_REASON_LABELS } from '../../_components/billing-labels';
import {
  CreditNoteStatusBadge,
  DetailRow,
  QuietLine,
  quietErrorText,
} from '../../_components/billing-parts';
import { creditAbilities, type CreditNoteActions } from './credit-note-actions';

/**
 * Credit Note Details (docx §13.2, §17.4): the drawer the list opens from a credit note number.
 * Its amounts, notes, the application and refund history in time order (who did what, on which
 * invoice), and the actions its status allows.
 */

const EVENT_ICONS: { match: RegExp; icon: Icon; tone: TimelineItem['tone'] }[] = [
  { match: /^Applied/, icon: CheckCircle, tone: 'green' },
  { match: /^Refunded/, icon: ArrowUUpLeft, tone: 'red' },
  { match: /^Voided/, icon: Prohibit, tone: 'grey' },
  { match: /^(Issued|Sent)/, icon: PaperPlaneTilt, tone: 'blue' },
  { match: /^Edited/, icon: PencilSimple, tone: 'purple' },
];

/** The history oldest first, as the docx asks (chronological). */
function historyItems(note: BillingCreditNote): TimelineItem[] {
  return note.history.map((event) => {
    const look = EVENT_ICONS.find((row) => row.match.test(event.action));
    return {
      id: event.id,
      icon: look?.icon ?? FileText,
      tone: look?.tone ?? 'navy',
      title: (
        <>
          <span className="font-semibold">{event.action}</span>
          {event.detail ? `: ${event.detail}` : ''}
          {event.amountCents !== null ? ` (${formatMoney(event.amountCents, note.currency)})` : ''}
        </>
      ),
      time: formatDateTime(event.at),
      dateTime: event.at,
      actor: event.actor,
    };
  });
}

export function CreditNoteDrawer({
  noteId,
  actions,
  onClose,
}: {
  noteId: string | null;
  actions: CreditNoteActions;
  onClose: () => void;
}) {
  return (
    <Drawer open={noteId !== null} title="Credit Note Details" onClose={onClose}>
      {noteId ? <DrawerBody noteId={noteId} actions={actions} /> : null}
    </Drawer>
  );
}

function Amount({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-canvas p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-bold wrap-anywhere text-heading">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-divider pt-4">
      <h3 className="text-base font-semibold text-heading">{title}</h3>
      {children}
    </section>
  );
}

function DrawerBody({ noteId, actions }: { noteId: string; actions: CreditNoteActions }) {
  const query = useApiQuery(['admin-billing', 'credit-note', noteId], () =>
    adminBilling.creditNote(noteId),
  );
  if (query.isLoading)
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16" />
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <Skeleton key={key} />
        ))}
      </div>
    );
  if (!query.data)
    return <QuietLine testId="credit-note-error">{quietErrorText(query.error)}</QuietLine>;

  const note = query.data;
  const c = note.currency;
  const can = creditAbilities(note);
  return (
    <div data-testid="credit-note-details" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <p data-testid="credit-note-number" className="text-2xl font-bold text-heading">
            {note.number}
          </p>
          <CreditNoteStatusBadge status={note.status} />
        </div>
        <p className="text-sm text-muted">
          {note.clientName} · {note.firmName}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <Amount label="Original">{formatMoney(note.totalCents, c)}</Amount>
        <Amount label="Applied">{formatMoney(note.appliedCents, c)}</Amount>
        <Amount label="Remaining">
          <span data-testid="credit-note-remaining">{formatMoney(note.remainingCents, c)}</span>
        </Amount>
      </dl>

      <div className="grid gap-2 sm:grid-cols-2">
        {can.apply ? (
          <Button onClick={() => actions.open('apply', note)}>
            <Receipt aria-hidden weight="fill" className="size-5" />
            Apply to Invoice
          </Button>
        ) : null}
        {can.issue ? (
          <Button disabled={actions.issuing} onClick={() => actions.issue(note)}>
            <CheckCircle aria-hidden weight="fill" className="size-5" />
            {actions.issuing ? 'Issuing…' : 'Issue Credit Note'}
          </Button>
        ) : null}
        {can.refund ? (
          <Button variant="outline" onClick={() => actions.open('refund', note)}>
            <ArrowCounterClockwise aria-hidden weight="bold" className="size-5" />
            Refund Remaining Balance
          </Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={actions.downloading}
          onClick={() => actions.download(note)}
        >
          <DownloadSimple aria-hidden weight="fill" className="size-5" />
          {actions.downloading ? 'Preparing…' : 'Download PDF'}
        </Button>
        {can.send ? (
          <Button variant="secondary" disabled={actions.sending} onClick={() => actions.send(note)}>
            <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
            {actions.sending ? 'Sending…' : 'Send to Customer'}
          </Button>
        ) : null}
        {can.void ? (
          <Button variant="secondary" onClick={() => actions.open('void', note)}>
            <Prohibit aria-hidden weight="fill" className="size-5" />
            Void
          </Button>
        ) : null}
      </div>

      <dl>
        <DetailRow label="Credit Note #">{note.number}</DetailRow>
        <DetailRow label="Customer">{note.clientName}</DetailRow>
        <DetailRow label="Related Invoice">
          {note.invoiceId && note.invoiceNumber ? (
            <Link
              href={`/billing/invoices/${note.invoiceId}`}
              className="text-link underline hover:text-action-hover"
            >
              {note.invoiceNumber}
            </Link>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label="Date">{formatDate(note.date)}</DetailRow>
        <DetailRow label="Reason">{CREDIT_REASON_LABELS[note.reason]}</DetailRow>
        <DetailRow label="Credit Type">
          {note.method === 'LINE_ITEMS' ? 'Line items' : 'Adjustment amount'}
        </DetailRow>
        <DetailRow label="Original Amount">{formatMoney(note.totalCents, c)}</DetailRow>
        <DetailRow label="Amount Applied">{formatMoney(note.appliedCents, c)}</DetailRow>
        {note.refundedCents > 0 ? (
          <DetailRow label="Amount Refunded">{formatMoney(note.refundedCents, c)}</DetailRow>
        ) : null}
        <DetailRow label="Remaining Amount">{formatMoney(note.remainingCents, c)}</DetailRow>
        <DetailRow label="Status">{CREDIT_NOTE_STATUS_LABELS[note.status]}</DetailRow>
        <DetailRow label="Remaining Credit">
          {note.keepAvailable ? 'Kept on the customer account' : 'Applied or refunded on issue'}
        </DetailRow>
        <DetailRow label="Created By">{note.createdBy}</DetailRow>
        {note.issuedAt ? <DetailRow label="Issued">{formatDayOf(note.issuedAt)}</DetailRow> : null}
        {note.sentAt ? <DetailRow label="Last Sent">{formatDayOf(note.sentAt)}</DetailRow> : null}
        {note.voidedAt ? (
          <DetailRow label="Voided">
            {formatDayOf(note.voidedAt)}
            {note.voidReason ? `: ${note.voidReason}` : ''}
          </DetailRow>
        ) : null}
      </dl>

      {note.method === 'LINE_ITEMS' && note.lines.length ? (
        <Section title="Credited Items">
          <ul className="flex flex-col gap-2 text-sm">
            {note.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-3 rounded-lg bg-canvas p-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-heading">{line.item || line.description}</span>
                  {line.item && line.description ? (
                    <span className="text-muted">{line.description}</span>
                  ) : null}
                  <span className="text-muted">
                    {line.quantity} × {formatMoney(line.unitPriceCents, c)}
                    {line.taxPercent ? ` · Tax ${line.taxPercent}%` : ''}
                  </span>
                </span>
                <span className="font-semibold whitespace-nowrap text-heading">
                  {formatMoney(line.amountCents + line.taxCents, c)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Notes">
        <dl>
          <DetailRow label="Internal Note">{note.internalNote || '—'}</DetailRow>
          <DetailRow label="Customer Note">{note.customerNote || '—'}</DetailRow>
        </dl>
      </Section>

      <Section title="Application and Refund History">
        <Timeline
          items={historyItems(note)}
          variant="plain"
          label="Credit note history"
          emptyText="No history yet."
        />
      </Section>
    </div>
  );
}
