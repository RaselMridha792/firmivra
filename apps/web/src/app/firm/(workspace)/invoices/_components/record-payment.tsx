'use client';

import { INVOICE_ERRORS, OfflinePaymentMethod, RecordOfflinePaymentRequest } from '@firmivra/types';
import { Input, Select, Textarea } from '@firmivra/ui';
import {
  Buildings,
  CalendarBlank,
  Calculator,
  CheckCircle,
  ClockCounterClockwise,
  Eye,
  Receipt,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  card,
  dayText,
  INV_KEY,
  localToday,
  money,
  OFFLINE_METHOD,
  outlined,
  primary,
  quiet,
  toCents,
  useAllInvoices,
  ViewPill,
} from './inv-shared';

/** /invoices/record-payment[?invoice=<id>]: the design's Record Payment page (check, cash, ACH…). */
export function RecordPayment() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { firm } = useFirm();
  const all = useAllInvoices();
  const open = (all.data?.items ?? []).filter((i) => i.status === 'OPEN');
  const [invoiceId, setInvoiceId] = useState(() => params.get('invoice') ?? '');
  const detail = useApiQuery([...INV_KEY, 'one', invoiceId], () =>
    invoiceId ? api.invoices.get(invoiceId) : Promise.resolve(null),
  );
  const inv = detail.data ?? null;
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(localToday);
  const [method, setMethod] = useState<OfflinePaymentMethod>('CHECK');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  // One key per page visit, sent again on a retry: the API records the payment once.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const due = inv?.balanceDueCents ?? 0;
  const cents = amount ? toCents(amount) : 0;
  const received = Number.isNaN(cents) ? 0 : cents;
  const remaining = Math.max(0, due - received);
  const recent = inv?.offlinePayments ?? [];

  const choose = (id: string) => {
    setInvoiceId(id);
    setAmount('');
    setErrors({});
    setFailure('');
    setIdempotencyKey(crypto.randomUUID());
  };

  const submit = async () => {
    setFailure('');
    const next: Record<string, string> = {};
    if (!inv) next['invoice'] = 'Choose an invoice';
    if (!amount || Number.isNaN(cents)) next['amountCents'] = 'Enter an amount like 125.50';
    else if (inv && cents > due) next['amountCents'] = `Enter at most ${money(due, inv.currency)}`;
    if (receivedOn > localToday()) next['receivedOn'] = 'The day cannot be in the future';
    const body = {
      method,
      amountCents: received,
      reference: reference.trim() || undefined,
      receivedOn,
      note: note.trim() || undefined,
      idempotencyKey,
    };
    const check = RecordOfflinePaymentRequest.safeParse(body);
    if (!check.success) {
      for (const issue of check.error.issues)
        next[String(issue.path[0] ?? 'form')] ??= issue.message;
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !inv) return;
    setBusy(true);
    try {
      await api.invoices.recordPayment(inv.id, body);
      await qc.invalidateQueries({ queryKey: [...INV_KEY] });
      router.push(`/invoices/${inv.id}#payments`);
    } catch (e) {
      setFailure(errorMessage(e, INVOICE_ERRORS));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="record-payment">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <Receipt weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
            >
              Record Payment
            </h1>
            <p className="text-base text-link">Apply and log a payment for an invoice.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={inv ? `/invoices/${inv.id}` : '/invoices'} className={outlined}>
            Cancel
          </Link>
          <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>
            <CheckCircle aria-hidden weight="fill" className="size-5" /> Record Payment
          </button>
        </div>
      </header>

      <section className={card} aria-labelledby="rp-selected" data-testid="selected-invoice">
        <h2 id="rp-selected" className="mb-3 font-display text-xl font-bold text-heading">
          Selected Invoice
        </h2>
        {!inv ? (
          <p className={quiet}>
            {detail.isError ? 'This invoice is not available.' : 'Choose an open invoice below.'}
          </p>
        ) : (
          <dl className="grid gap-3 rounded-lg border border-divider p-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="text-muted">Invoice Number</dt>
              <dd className="font-semibold text-heading">{inv.number}</dd>
            </div>
            <div>
              <dt className="text-muted">Client</dt>
              <dd>
                <Link
                  href={`/clients/${inv.client.id}`}
                  className="inline-flex items-center gap-1 font-semibold text-link"
                >
                  <Buildings aria-hidden weight="fill" className="size-4" />{' '}
                  {inv.client.displayName}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Original Amount</dt>
              <dd className="font-semibold text-heading">{money(inv.totalCents, inv.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted">Balance Due</dt>
              <dd className="font-bold text-gold">{money(inv.balanceDueCents, inv.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted">Due Date</dt>
              <dd className="inline-flex items-center gap-1 font-semibold text-heading">
                <CalendarBlank aria-hidden weight="fill" className="size-4 text-action" />
                {dayText(inv.dueOn)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Status</dt>
              <dd>
                <ViewPill invoice={inv} />
              </dd>
            </div>
          </dl>
        )}
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className={card} aria-labelledby="rp-details">
          <h2 id="rp-details" className="mb-3 font-display text-xl font-bold text-heading">
            Payment Details
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Invoice *"
              value={invoiceId}
              error={errors['invoice']}
              onChange={(e) => choose(e.target.value)}
              options={[
                {
                  value: '',
                  label: all.isPending ? 'Loading invoices…' : 'Select an open invoice…',
                },
                ...(inv && !open.some((o) => o.id === inv.id)
                  ? [{ value: inv.id, label: `${inv.number} – ${inv.client.displayName}` }]
                  : []),
                ...open.map((o) => ({
                  value: o.id,
                  label: `${o.number} – ${o.client.displayName}`,
                })),
              ]}
            />
            <Input label="Client" value={inv?.client.displayName ?? ''} readOnly disabled />
            <Input
              label="Amount Received ($) *"
              inputMode="decimal"
              placeholder={inv ? (due / 100).toFixed(2) : '0.00'}
              value={amount}
              error={errors['amountCents']}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              label="Payment Date *"
              type="date"
              max={localToday()}
              value={receivedOn}
              error={errors['receivedOn']}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
            <Select
              label="Payment Method *"
              value={method}
              onChange={(e) => setMethod(OfflinePaymentMethod.parse(e.target.value))}
              options={Object.entries(OFFLINE_METHOD).map(([value, label]) => ({ value, label }))}
            />
            <Input
              label={method === 'CHECK' ? 'Check Number *' : 'Reference / Transaction ID'}
              value={reference}
              maxLength={20}
              error={errors['reference']}
              onChange={(e) => setReference(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="Notes (for the firm only)"
                rows={3}
                maxLength={500}
                value={note}
                error={errors['note']}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="text-right text-xs text-muted">{note.length}/500</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            The invoice turns Paid once the money received covers its total.
          </p>
          {failure ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {failure}
            </p>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-col gap-5" aria-label="Payment summary">
          <section className={card} aria-labelledby="rp-summary" data-testid="payment-summary">
            <h2
              id="rp-summary"
              className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-heading"
            >
              <Calculator aria-hidden weight="fill" className="size-6 text-action" /> Payment
              Summary
            </h2>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt>Original Invoice Amount</dt>
                <dd>{inv ? money(inv.totalCents, inv.currency) : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Amount Due (Current)</dt>
                <dd>{inv ? money(due, inv.currency) : '—'}</dd>
              </div>
              <div className="flex justify-between border-t border-divider pt-2">
                <dt>Amount Received</dt>
                <dd>{money(received)}</dd>
              </div>
              <div className="flex justify-between rounded-lg bg-success-soft p-3 text-lg font-bold text-success">
                <dt>Remaining Balance</dt>
                <dd data-testid="remaining-balance">
                  {inv ? money(remaining, inv.currency) : '—'}
                </dd>
              </div>
            </dl>
          </section>
          <section className={card} aria-labelledby="rp-receipt">
            <h2
              id="rp-receipt"
              className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-heading"
            >
              <Eye aria-hidden weight="fill" className="size-6 text-action" /> Receipt Preview
            </h2>
            <div className="rounded-lg border border-divider p-3 text-sm">
              <p className="mb-2 flex justify-between gap-2 border-b border-divider pb-2">
                <span className="font-display font-bold text-heading">{firm.name}</span>
                <span className="font-semibold text-heading">Payment Receipt</span>
              </p>
              <dl className="flex flex-col gap-1">
                {[
                  ['Client', inv?.client.displayName ?? '—'],
                  ['Invoice Number', inv?.number ?? '—'],
                  ['Payment Date', dayText(receivedOn)],
                  ['Payment Method', OFFLINE_METHOD[method] ?? method],
                  ['Reference ID', reference || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt>{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 flex justify-between rounded-lg bg-info-soft p-2 font-bold text-heading">
                <span>Payment Amount</span>
                <span>{money(received)}</span>
              </p>
            </div>
          </section>
        </aside>
      </div>

      <section className={card} aria-labelledby="rp-recent">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2
            id="rp-recent"
            className="flex items-center gap-2 font-display text-xl font-bold text-heading"
          >
            <ClockCounterClockwise aria-hidden weight="bold" className="size-6 text-action" />{' '}
            Recent Payments
          </h2>
          {inv ? (
            <Link href={`/invoices/${inv.id}#payments`} className={`${outlined} min-h-9!`}>
              View All Payments
            </Link>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <p className={quiet}>No payments recorded on this invoice yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-xs text-heading">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Amount</th>
                  <th className="p-2">Payment Method</th>
                  <th className="p-2">Reference ID</th>
                  <th className="p-2">Notes</th>
                  <th className="p-2">Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-divider ${p.voidedAt ? 'text-muted line-through' : ''}`}
                  >
                    <td className="p-2">{dayText(p.receivedOn)}</td>
                    <td className="p-2">{money(p.amountCents, p.currency)}</td>
                    <td className="p-2">{OFFLINE_METHOD[p.method] ?? p.method}</td>
                    <td className="p-2">{p.reference ?? '—'}</td>
                    <td className="p-2 wrap-anywhere">{p.note ?? '—'}</td>
                    <td className="p-2">{p.recordedBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
