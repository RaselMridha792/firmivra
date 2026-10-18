'use client';

import { INVOICE_ERRORS, type Invoice } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import {
  ArrowLeft,
  Invoice as InvoiceIcon,
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
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { InvoiceCancelForm } from './invoice-cancel-form';
import {
  card,
  dayText,
  INV_KEY,
  money,
  OFFLINE_METHOD,
  outlined,
  paidCents,
  primary,
  quiet,
  toCents,
  ViewPill,
} from './inv-shared';

const PAYMENT_STATUS: Record<string, string> = {
  PENDING: 'Pending',
  SUCCEEDED: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
};

/** /invoices/[invoiceId]: one invoice with its lines, totals and every payment. */
export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const qc = useQueryClient();
  const q = useApiQuery([...INV_KEY, 'one', invoiceId], () => api.invoices.get(invoiceId));
  const [canceling, setCanceling] = useState(false);
  const [refunding, setRefunding] = useState<Invoice['payments'][number]>();
  const [voiding, setVoiding] = useState<Invoice['offlinePayments'][number]>();
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const i = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: [...INV_KEY] });
  const send = async () => {
    setBusy(true);
    setFailure('');
    try {
      await api.invoices.send(invoiceId);
      await refresh();
    } catch (e) {
      setFailure(errorMessage(e, INVOICE_ERRORS));
    }
    setBusy(false);
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
          <RequireRole roles={['OWNER', 'ADMIN']}>
            <div className="flex flex-wrap gap-2">
              {i.status === 'DRAFT' ? (
                <>
                  <button
                    type="button"
                    className={primary}
                    disabled={busy}
                    onClick={() => void send()}
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-5" /> Send Invoice
                  </button>
                  <Link href={`/invoices/${i.id}/edit`} className={outlined}>
                    <PencilSimple aria-hidden weight="fill" className="size-5 text-action" /> Edit
                  </Link>
                </>
              ) : null}
              {i.status === 'OPEN' ? (
                <Link href={`/invoices/record-payment?invoice=${i.id}`} className={primary}>
                  <Receipt aria-hidden weight="fill" className="size-5" /> Record Payment
                </Link>
              ) : null}
              <Link href={`/invoices/new?from=${i.id}`} className={outlined}>
                <Copy aria-hidden weight="fill" className="size-5 text-action" /> Duplicate
              </Link>
              {(i.status === 'DRAFT' || i.status === 'SCHEDULED' || i.status === 'OPEN') &&
              paidCents(i) === 0 ? (
                <button type="button" className={outlined} onClick={() => setCanceling(true)}>
                  <Prohibit aria-hidden weight="fill" className="size-5 text-danger" /> Cancel
                  Invoice
                </button>
              ) : null}
            </div>
          </RequireRole>
        ) : null}
      </header>
      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {failure}
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
                ...(i?.scheduledFor ? [['Opens On', dayText(i.scheduledFor)] as const] : []),
                ...(i?.paidAt ? [['Paid On', dayText(i.paidAt)] as const] : []),
                ...(i?.canceledAt ? [['Canceled On', dayText(i.canceledAt)] as const] : []),
                ['Created By', i?.createdBy?.name ?? '—'],
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
                      </span>{' '}
                      · Online (Stripe) · {PAYMENT_STATUS[p.status] ?? p.status} ·{' '}
                      {dayText(p.paidAt ?? p.createdAt)}
                      {p.refundedCents > 0
                        ? ` · Refunded ${money(p.refundedCents, p.currency)}`
                        : ''}
                      {p.refunds.some((r) => r.status === 'PENDING') ? ' · Refund pending' : ''}
                      {p.failureCode ? ` · ${p.failureCode}` : ''}
                    </span>
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
                    </span>
                    {p.voidedAt ? (
                      <span className="text-xs text-muted">Voided: {p.voidReason}</span>
                    ) : (
                      <RequireRole roles={['OWNER', 'ADMIN']}>
                        <button
                          type="button"
                          className={`${outlined} min-h-9!`}
                          onClick={() => setVoiding(p)}
                        >
                          Void
                        </button>
                      </RequireRole>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
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
      {canceling && i ? (
        <InvoiceCancelForm invoice={i} onClose={() => setCanceling(false)} />
      ) : null}
      {refunding && i ? (
        <ReasonDialog
          title={`Refund ${money(refunding.amountCents, refunding.currency)} payment`}
          label={`Amount to refund (at most ${money(refunding.refundableCents, refunding.currency)})`}
          initial={(refunding.refundableCents / 100).toFixed(2)}
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
  action,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  initial: string;
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
          error={error}
        />
        <Button type="submit" disabled={busy}>
          {action}
        </Button>
      </form>
    </Modal>
  );
}
