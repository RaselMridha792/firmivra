'use client';

import {
  INVOICE_ERRORS,
  type Invoice,
  type InvoiceRecurrence,
  paymentTermLabel,
  recurrenceLabel,
} from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import {
  ArrowLeft,
  BellRinging,
  FileMagnifyingGlass,
  Invoice as InvoiceIcon,
  LinkSimple,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  Receipt,
  Copy,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { RequireRole } from '../../../../../components/require-role';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { InvoiceCancelForm } from './invoice-cancel-form';
import { ReceiptButton } from './receipt-button';
import {
  card,
  dayText,
  INV_KEY,
  money,
  OFFLINE_METHOD,
  canEditInvoice,
  outlined,
  paidCents,
  primary,
  quiet,
  toCents,
  ViewPill,
} from './inv-shared';
import { InvoiceHistoryCard } from './invoice-history';
import { InvoicePreviewDialog } from './invoice-preview';
import { NewMessageDialog } from '../../messages/_components/messages-screen';

/** Q23 (IP-041): how the client paid, once Stripe says: "card ••4242" or "bank ••6789". */
const methodText = (p: { methodType: string | null; last4: string | null }) => {
  const kind =
    p.methodType === 'us_bank_account' ? 'bank (ACH)' : p.methodType === 'card' ? 'card' : null;
  if (!kind) return '';
  return p.last4 ? `, ${kind} ••${p.last4}` : `, ${kind}`;
};

/** Q23 (IP-041): a bank payment (ACH), refunded in full only. */
const bankPayment = (p: { methodType: string | null }) => p.methodType === 'us_bank_account';

const PAYMENT_STATUS: Record<string, string> = {
  // Q23 (IP-041): the firm's word for a payment Stripe is still settling (a bank debit).
  PENDING: 'Payment pending',
  SUCCEEDED: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
};

/** /invoices/[invoiceId]: one invoice with its lines, totals and every payment. */
export function InvoiceDetail({
  invoiceId,
  portalBase = '',
}: {
  invoiceId: string;
  /** Q24 (I-N03): the client portal's address, for Copy Payment Link. */
  portalBase?: string;
}) {
  const qc = useQueryClient();
  const { firm } = useFirm();
  const q = useApiQuery([...INV_KEY, 'one', invoiceId], () => api.invoices.get(invoiceId));
  const [canceling, setCanceling] = useState(false);
  // I-N08: Preview on screen.
  const [previewing, setPreviewing] = useState(false);
  const [refunding, setRefunding] = useState<Invoice['payments'][number]>();
  const [voiding, setVoiding] = useState<Invoice['offlinePayments'][number]>();
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const i = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: [...INV_KEY] });
  const [notice, setNotice] = useState('');
  const [reminding, setReminding] = useState(false);
  const act = async (call: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      await call();
      await refresh();
      setNotice(done);
    } catch (e) {
      setFailure(errorMessage(e, INVOICE_ERRORS));
    }
    setBusy(false);
  };
  const send = () =>
    act(() => api.invoices.send(invoiceId), `${i?.number ?? 'The invoice'} sent to the client.`);
  // Q24 (I-N03): the list's Resend, Send Reminder and Copy Payment Link on the invoice page too.
  const resend = () =>
    act(
      () => api.invoices.resend(invoiceId),
      `${i?.number ?? 'The invoice'} sent to the client again.`,
    );
  const payLink =
    portalBase && firm ? `${portalBase.replace(/\/$/, '')}/${firm.slug}/invoices/${invoiceId}` : '';
  const copyLink = async () => {
    setFailure('');
    try {
      await navigator.clipboard.writeText(payLink);
      setNotice(`Payment link copied. It opens the invoice in the client's portal, after sign-in.`);
    } catch {
      setNotice('');
      setFailure('The link could not be copied. Use the Payment Link Generator.');
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="invoice-detail">
      <Link href="/invoices" className="inline-flex items-center gap-2 text-sm text-link">
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Invoices &amp; Payments
      </Link>
      {q.isError ? (
        <p role="alert" className={quiet}>
          This invoice is not available right now.
        </p>
      ) : null}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <InvoiceIcon weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
            >
              {i?.number ?? 'Invoice'}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-base text-muted">
              {i ? (
                <>
                  {i.client.displayName} · {i.title} <ViewPill invoice={i} />
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
        </div>
        {i ? (
          <div className="flex flex-wrap gap-2">
            <RequireRole roles={['OWNER', 'ADMIN']}>
              {i.status === 'DRAFT' || i.status === 'SCHEDULED' ? (
                <button
                  type="button"
                  className={primary}
                  disabled={busy}
                  onClick={() => void send()}
                >
                  <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />{' '}
                  {/* Q24 (I-N03): a scheduled invoice can go now instead of on its day. */}
                  {i.status === 'DRAFT' ? 'Send Invoice' : 'Send Now'}
                </button>
              ) : null}
              {/* Q24 (I-N03): as in the list, for a sent invoice with something still to pay. */}
              {i.status === 'OPEN' && i.balanceDueCents > 0 ? (
                <>
                  <button
                    type="button"
                    className={outlined}
                    disabled={busy}
                    onClick={() => void resend()}
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-5 text-action" />{' '}
                    Resend
                  </button>
                  <button type="button" className={outlined} onClick={() => setReminding(true)}>
                    <BellRinging aria-hidden weight="fill" className="size-5 text-action" /> Send
                    Reminder
                  </button>
                  {payLink ? (
                    <button type="button" className={outlined} onClick={() => void copyLink()}>
                      <LinkSimple aria-hidden weight="bold" className="size-5 text-action" /> Copy
                      Payment Link
                    </button>
                  ) : null}
                </>
              ) : null}
            </RequireRole>
            {/* Q24: everyone who can open the invoice can preview it (Staff too). */}
            <button type="button" className={outlined} onClick={() => setPreviewing(true)}>
              <FileMagnifyingGlass aria-hidden weight="fill" className="size-5 text-action" />{' '}
              Preview
            </button>
            <RequireRole roles={['OWNER', 'ADMIN']}>
              {/* I-N06: a draft, a scheduled invoice, or a sent one with nothing paid. */}
              {canEditInvoice(i) ? (
                <Link href={`/invoices/${i.id}/edit`} className={outlined}>
                  <PencilSimple aria-hidden weight="fill" className="size-5 text-action" /> Edit
                </Link>
              ) : null}
              {i.status === 'OPEN' ? (
                <Link href={`/invoices/record-payment?invoice=${i.id}`} className={primary}>
                  <Receipt aria-hidden weight="fill" className="size-5" /> Record Payment
                </Link>
              ) : null}
              <Link href={`/invoices/new?copyFrom=${i.id}`} className={outlined}>
                <Copy aria-hidden weight="fill" className="size-5 text-action" /> Duplicate
              </Link>
              {(i.status === 'DRAFT' || i.status === 'SCHEDULED' || i.status === 'OPEN') &&
              paidCents(i) === 0 ? (
                <button type="button" className={outlined} onClick={() => setCanceling(true)}>
                  <Prohibit aria-hidden weight="fill" className="size-5 text-danger" /> Cancel
                  Invoice
                </button>
              ) : null}
            </RequireRole>
          </div>
        ) : null}
      </header>
      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-success" data-testid="invoice-notice">
          {notice}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className={card} aria-labelledby="inv-facts">
            <h2 id="inv-facts" className="sr-only">
              Invoice details
            </h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                [
                  'Client',
                  i ? (
                    <Link key="c" href={`/clients/${i.client.id}`} className="text-link">
                      {i.client.displayName}
                    </Link>
                  ) : (
                    '—'
                  ),
                ],
                ['Service', i?.service?.title ?? '—'],
                ['Invoice Date', dayText(i?.issuedAt ?? i?.createdAt)],
                ['Due Date', dayText(i?.dueOn)],
                ...(i?.paymentTerms
                  ? [['Payment Terms', paymentTermLabel(i.paymentTerms)] as const]
                  : []),
                ...(i?.recurring ? [['Recurring', recurringText(i.recurring)] as const] : []),
                ...(i?.scheduledFor ? [['Opens On', dayText(i.scheduledFor)] as const] : []),
                ...(i?.paidAt ? [['Paid On', dayText(i.paidAt)] as const] : []),
                ...(i?.canceledAt ? [['Canceled On', dayText(i.canceledAt)] as const] : []),
                ['Created By', i?.createdBy?.name ?? '—'],
                ['Assigned Staff', i?.assignedTo?.name ?? 'Unassigned'],
                ['Template', i?.template?.name ?? "Your firm's branding"],
                // IP-F04
                ['Email to Client', i && !i.emailClient ? 'Off: portal only' : 'On'],
                ...(i?.allowTip ? [['Tips', 'Allowed (not added to Pay Now yet)'] as const] : []),
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-semibold text-heading">{value}</dd>
                </div>
              ))}
            </dl>
            {i?.cancelReason ? (
              <p className="mt-3 rounded-lg bg-canvas p-3 text-sm">
                <span className="font-semibold">Why it was canceled:</span> {i.cancelReason}
              </p>
            ) : null}
            {i?.notesToClient ? (
              <p className="mt-3 rounded-lg bg-canvas p-3 text-sm whitespace-pre-line">
                <span className="font-semibold">Notes to Client:</span> {i.notesToClient}
              </p>
            ) : null}
            {i?.internalNote ? (
              <p
                data-testid="internal-note"
                className="mt-3 rounded-lg border border-warning bg-warning-soft p-3 text-sm whitespace-pre-line"
              >
                <span className="font-semibold">Internal Note (your firm only):</span>{' '}
                {i.internalNote}
              </p>
            ) : null}
            {i && i.attachments.length > 0 ? (
              <div className="mt-3" data-testid="invoice-attachments">
                <p className="text-sm font-semibold text-heading">Attachments</p>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {i.attachments.map((a) => (
                    <li key={a.documentId}>
                      <button
                        type="button"
                        className="text-link underline"
                        onClick={() =>
                          void api.documents
                            .download(a.documentId)
                            .then((link) => window.open(link.url, '_blank', 'noopener'))
                        }
                      >
                        {a.fileName}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className={card} aria-labelledby="inv-lines">
            <h2 id="inv-lines" className="mb-3 font-display text-xl font-bold text-heading">
              Line Items
            </h2>
            {!i ? (
              <p className={quiet}>No line items to show.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-canvas text-xs text-heading">
                    <tr>
                      <th className="p-2">Description</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Rate</th>
                      <th className="p-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {i.lines.map((l) => (
                      <tr key={l.id} className="border-b border-divider">
                        <td className="p-2 wrap-anywhere">{l.description}</td>
                        <td className="p-2 text-right">{l.quantity}</td>
                        <td className="p-2 text-right">{money(l.unitAmountCents, i.currency)}</td>
                        <td className="p-2 text-right">{money(l.amountCents, i.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={card} aria-labelledby="payments-title" id="payments">
            <h2 id="payments-title" className="mb-3 font-display text-xl font-bold text-heading">
              Payments
            </h2>
            {!i || (i.payments.length === 0 && i.offlinePayments.length === 0) ? (
              <p className={quiet}>No payments yet.</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="invoice-payments">
                {i.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-divider p-3 text-sm"
                  >
                    <span>
                      <span className="font-semibold text-heading">
                        {money(p.amountCents, p.currency)}
                      </span>
                      {/* Q22: the client's tip, charged with it; it never pays the invoice. */}
                      {p.tipCents > 0 ? ` + ${money(p.tipCents, p.currency)} tip` : ''} · Online
                      (Stripe{methodText(p)}) · {PAYMENT_STATUS[p.status] ?? p.status} ·{' '}
                      {dayText(p.paidAt ?? p.createdAt)}
                      {p.refundedCents > 0
                        ? ` · Refunded ${money(p.refundedCents, p.currency)}`
                        : ''}
                      {p.refunds.some((r) => r.status === 'PENDING') ? ' · Refund pending' : ''}
                      {p.failureCode ? ` · ${p.failureCode}` : ''}
                      {/* Q23 (IP-041): the client disputed it with their bank; the invoice stays paid. */}
                      {p.disputed ? (
                        <span className="font-semibold text-danger" data-testid="payment-disputed">
                          {' '}
                          · Disputed
                        </span>
                      ) : null}
                    </span>
                    {p.status === 'SUCCEEDED' || p.status === 'REFUNDED' ? (
                      <ReceiptButton
                        invoiceId={i.id}
                        payment={{ paymentId: p.id }}
                        sentAt={p.receiptSentAt}
                      />
                    ) : null}
                    {p.refundableCents > 0 ? (
                      <RequireRole roles={['OWNER', 'ADMIN']}>
                        <button
                          type="button"
                          className={`${outlined} min-h-9!`}
                          onClick={() => setRefunding(p)}
                        >
                          Issue Refund
                        </button>
                      </RequireRole>
                    ) : null}
                  </li>
                ))}
                {i.offlinePayments.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-divider p-3 text-sm"
                  >
                    <span className={p.voidedAt ? 'text-muted line-through' : ''}>
                      <span className="font-semibold text-heading">
                        {money(p.amountCents, p.currency)}
                      </span>{' '}
                      · {OFFLINE_METHOD[p.method] ?? p.method}
                      {p.reference ? ` #${p.reference}` : ''} · {dayText(p.receivedOn)} · Recorded
                      by {p.recordedBy.name}
                      {p.depositAccount ? ` · Deposited to ${p.depositAccount.name}` : ''}
                    </span>
                    {p.voidedAt ? (
                      <span className="text-xs text-muted">Voided: {p.voidReason}</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <ReceiptButton
                          invoiceId={i.id}
                          payment={{ offlinePaymentId: p.id }}
                          sentAt={p.receiptSentAt}
                        />
                        <RequireRole roles={['OWNER', 'ADMIN']}>
                          <button
                            type="button"
                            className={`${outlined} min-h-9!`}
                            onClick={() => setVoiding(p)}
                          >
                            Void
                          </button>
                        </RequireRole>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* IP-F09: the firm's notes and logged activity. */}
          {i ? <InvoiceHistoryCard invoiceId={i.id} /> : null}
        </div>

        <aside
          className={`${card} h-fit`}
          aria-labelledby="inv-totals"
          data-testid="invoice-totals"
        >
          <h2 id="inv-totals" className="mb-3 font-display text-xl font-bold text-heading">
            Invoice Summary
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            {[
              ['Subtotal', i?.subtotalCents],
              ['Discount', i?.discountCents],
              ...(i?.tax
                ? [[`Tax (${i.tax.name} ${i.tax.rateBps / 100}%)`, i.tax.cents] as const]
                : []),
            ].map(([label, v]) => (
              <div key={String(label)} className="flex justify-between">
                <dt>{label}</dt>
                <dd>{typeof v === 'number' ? money(v, i?.currency) : '—'}</dd>
              </div>
            ))}
            <div className="flex justify-between rounded-lg bg-info-soft p-3 text-lg font-bold text-heading">
              <dt>Total</dt>
              <dd>{i ? money(i.totalCents, i.currency) : '—'}</dd>
            </div>
            <div className="flex justify-between px-3">
              <dt>Amount Paid</dt>
              <dd className="font-semibold text-success">
                {i ? money(i.amountPaidCents, i.currency) : '—'}
              </dd>
            </div>
            {i && i.refundedCents > 0 ? (
              <div className="flex justify-between px-3">
                <dt>Refunded</dt>
                <dd>{money(i.refundedCents, i.currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between rounded-lg bg-warning-soft p-3 text-lg font-bold text-heading">
              <dt>Balance Due</dt>
              <dd data-testid="invoice-balance">
                {i ? money(i.balanceDueCents, i.currency) : '—'}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
      {reminding && i ? (
        // Q24 (I-N03): the list's reminder composer, the same subject.
        <NewMessageDialog
          clientId={i.client.id}
          clientName={i.client.displayName}
          subject={`Reminder: invoice ${i.number}, ${money(i.balanceDueCents, i.currency)} due${
            i.dueOn ? ` ${dayText(i.dueOn)}` : ''
          }`}
          onClose={() => setReminding(false)}
          onSent={() => {
            setReminding(false);
            setFailure('');
            setNotice('Reminder sent.');
          }}
        />
      ) : null}
      {previewing && i ? (
        <InvoicePreviewDialog invoiceId={i.id} onClose={() => setPreviewing(false)} />
      ) : null}
      {canceling && i ? (
        <InvoiceCancelForm invoice={i} onClose={() => setCanceling(false)} />
      ) : null}
      {refunding && i ? (
        <ReasonDialog
          title={`Refund ${money(refunding.amountCents, refunding.currency)} payment`}
          label={
            bankPayment(refunding)
              ? 'Amount to refund'
              : `Amount to refund (at most ${money(refunding.refundableCents, refunding.currency)})`
          }
          initial={(refunding.refundableCents / 100).toFixed(2)}
          // Q23 (IP-041): a bank payment is refunded in full only, and takes a few business days.
          {...(bankPayment(refunding)
            ? {
                readOnly: true,
                hint: 'A bank payment can only be refunded in full. The money reaches the client’s bank in a few business days.',
              }
            : {})}
          action="Issue Refund"
          onClose={() => setRefunding(undefined)}
          onSubmit={async (value, key) => {
            const cents = toCents(value);
            if (Number.isNaN(cents)) throw new Error('Enter an amount like 125.50');
            await api.invoices.refund(i.id, refunding.id, {
              amountCents: cents,
              idempotencyKey: key,
            });
            await refresh();
          }}
        />
      ) : null}
      {voiding && i ? (
        <ReasonDialog
          title={`Void ${money(voiding.amountCents, voiding.currency)} payment`}
          label="Why is this payment voided?"
          initial=""
          action="Void Payment"
          onClose={() => setVoiding(undefined)}
          onSubmit={async (value) => {
            await api.invoices.voidPayment(i.id, voiding.id, { reason: value });
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** One field and one button: a refund's amount or a void's reason. Retries keep the same key. */
function ReasonDialog({
  title,
  label,
  initial,
  readOnly = false,
  hint,
  action,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  initial: string;
  /** The value cannot be changed (a bank payment's full refund). */
  readOnly?: boolean;
  hint?: string;
  action: string;
  onClose: () => void;
  onSubmit: (value: string, idempotencyKey: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) {
            setError('This is required');
            return;
          }
          setBusy(true);
          onSubmit(value.trim(), key)
            .then(onClose)
            .catch((err: unknown) => {
              setError(
                err instanceof Error && !('code' in err)
                  ? err.message
                  : errorMessage(err, INVOICE_ERRORS),
              );
              setBusy(false);
            });
        }}
      >
        <Input
          label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={readOnly}
          {...(hint ? { hint } : {})}
          error={error}
        />
        <Button type="submit" disabled={busy}>
          {action}
        </Button>
      </form>
    </Modal>
  );
}

/** IP-F05: "Every 3 weeks · next 11/18/2026", or where the schedule stands. */
function recurringText(r: InvoiceRecurrence): string {
  const state =
    r.status === 'PAUSED' && r.occurrences === 0
      ? 'starts when this invoice is sent'
      : r.status === 'ACTIVE'
        ? `next ${dayText(r.nextSendOn)}`
        : r.status === 'PAUSED'
          ? 'paused'
          : 'ended';
  return `${recurrenceLabel(r)} · ${state}`;
}
