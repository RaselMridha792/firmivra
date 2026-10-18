'use client';

import { Button, Skeleton } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowSquareOut,
  FileText,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { Ref } from 'react';
import type { BillingPayment } from '../../../../../../mocks/admin-billing';
import { formatDate, formatDayOf, formatMoney } from '../../_components/billing-format';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from '../../_components/billing-labels';
import {
  DetailRow,
  PaymentStatusBadge,
  QuietLine,
  quietErrorText,
} from '../../_components/billing-parts';

/**
 * Payment Details (docx §12.2): the side panel next to the Payments list. View Receipt, Send
 * Receipt and Issue Refund work here; View Invoice opens the existing Invoice Details screen.
 */

/** A payment that completed has a receipt (refunded ones too); pending and failed ones don't. */
export const hasReceipt = (payment: Pick<BillingPayment, 'status'>) =>
  payment.status !== 'FAILED' && payment.status !== 'PENDING';

/** "10/10/2026 2:15 PM" in the platform time zone. */
function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })
    .format(new Date(iso))
    .replace(',', '');
}

const outlineLink =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 py-2 text-sm font-medium text-action hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'none'; text: string }
  | { kind: 'ready'; payment: BillingPayment };

export function PaymentPanel({
  state,
  ref,
  sending,
  onClose,
  onViewReceipt,
  onSendReceipt,
  onRefund,
}: {
  state: PanelState;
  ref?: Ref<HTMLElement>;
  sending: boolean;
  onClose: () => void;
  onViewReceipt: (payment: BillingPayment) => void;
  onSendReceipt: (payment: BillingPayment) => void;
  onRefund: (payment: BillingPayment) => void;
}) {
  return (
    <aside
      ref={ref}
      aria-labelledby="payment-details-title"
      data-testid="payment-panel"
      className="flex min-w-0 shrink-0 scroll-mt-4 flex-col gap-4 rounded-xl bg-surface p-5 shadow-sm min-[1440px]:w-64 2xl:w-72"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="payment-details-title" className="text-xl font-bold text-heading">
          Payment Details
        </h2>
        {state.kind === 'ready' ? (
          <button
            type="button"
            aria-label="Close payment details"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg text-heading hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden weight="bold" className="size-5" />
          </button>
        ) : null}
      </div>
      {state.kind === 'loading' ? (
        <div role="status" aria-label="Loading" className="flex flex-col gap-3">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-9 w-40" />
          {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
            <Skeleton key={key} />
          ))}
        </div>
      ) : state.kind === 'error' ? (
        <QuietLine testId="panel-error">{quietErrorText(state.error)}</QuietLine>
      ) : state.kind === 'none' ? (
        <QuietLine testId="panel-empty">{state.text}</QuietLine>
      ) : (
        <PaymentDetails
          payment={state.payment}
          sending={sending}
          onViewReceipt={onViewReceipt}
          onSendReceipt={onSendReceipt}
          onRefund={onRefund}
        />
      )}
    </aside>
  );
}

function PaymentDetails({
  payment,
  sending,
  onViewReceipt,
  onSendReceipt,
  onRefund,
}: {
  payment: BillingPayment;
  sending: boolean;
  onViewReceipt: (payment: BillingPayment) => void;
  onSendReceipt: (payment: BillingPayment) => void;
  onRefund: (payment: BillingPayment) => void;
}) {
  const c = payment.currency;
  const receipt = hasReceipt(payment);
  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <PaymentStatusBadge status={payment.status} />
        <p data-testid="payment-amount" className="mt-2 text-3xl font-bold text-heading">
          {formatMoney(payment.amountCents, c)}
        </p>
        <p className="font-semibold text-heading">{payment.clientName}</p>
        <p className="text-sm text-muted">Invoice # {payment.invoiceNumber}</p>
      </div>
      <dl className="border-t border-divider pt-3">
        <DetailRow label="Payment Date">{formatDate(payment.paidOn)}</DetailRow>
        <DetailRow label="Payment Method">{PAYMENT_METHOD_LABELS[payment.method]}</DetailRow>
        <DetailRow label="Reference ID">{payment.reference}</DetailRow>
        <DetailRow label="Processor">{payment.processor}</DetailRow>
        <DetailRow label="Firm">{payment.firmName}</DetailRow>
        <DetailRow label="Status">{PAYMENT_STATUS_LABELS[payment.status]}</DetailRow>
        {payment.failureReason ? (
          <DetailRow label="Failure Reason">{payment.failureReason}</DetailRow>
        ) : null}
        {payment.refundedCents > 0 ? (
          <DetailRow label="Refunded">{formatMoney(payment.refundedCents, c)}</DetailRow>
        ) : null}
        <DetailRow label="Recorded By">{payment.recordedBy}</DetailRow>
        <DetailRow label="Recorded On">{formatStamp(payment.recordedAt)}</DetailRow>
        <DetailRow label="Notes">{payment.notes || '—'}</DetailRow>
      </dl>
      {payment.refunds.length ? (
        <section aria-label="Refunds" className="flex flex-col gap-2 border-t border-divider pt-3">
          <h3 className="text-sm font-semibold text-heading">Refunds</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {payment.refunds.map((refund) => (
              <li key={refund.id} className="flex flex-col rounded-lg bg-canvas p-2">
                <span className="flex justify-between gap-2 font-medium text-heading">
                  <span>{refund.confirmation}</span>
                  <span>{formatMoney(refund.amountCents, c)}</span>
                </span>
                <span className="text-muted">
                  {formatDayOf(refund.at)} · {refund.by}
                </span>
                {refund.reason ? <span className="text-muted">{refund.reason}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-col gap-3 pt-1">
        <Button disabled={!receipt} onClick={() => onViewReceipt(payment)}>
          <FileText aria-hidden weight="fill" className="size-5" />
          View Receipt
        </Button>
        <Button
          variant="outline"
          disabled={!receipt || sending}
          onClick={() => onSendReceipt(payment)}
        >
          <ArrowRight aria-hidden weight="bold" className="size-5" />
          {sending ? 'Sending…' : 'Send Receipt'}
        </Button>
        <Button
          variant="outline"
          disabled={payment.refundableCents <= 0}
          onClick={() => onRefund(payment)}
        >
          <ArrowCounterClockwise aria-hidden weight="bold" className="size-5" />
          Issue Refund
        </Button>
        <Link href={`/billing/invoices/${payment.invoiceId}`} className={outlineLink}>
          <ArrowSquareOut aria-hidden weight="bold" className="size-5" />
          View Invoice
        </Link>
        {receipt ? null : (
          <p className="text-sm text-muted">A receipt is ready once the payment completes.</p>
        )}
      </div>
    </>
  );
}
