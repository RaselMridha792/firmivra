'use client';

import {
  CreateInvoiceRequest,
  INVOICE_ERRORS,
  type Invoice,
  INVOICE_LIMITS,
  invoiceTotals,
  UpdateInvoiceRequest,
} from '@firmivra/types';
import { Input, Select, Textarea } from '@firmivra/ui';
import {
  Bank,
  Calculator,
  CreditCard,
  Info,
  Money,
  PaperPlaneTilt,
  Plus,
  FloppyDisk,
  Trash,
  FilePlus,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  card,
  INV_KEY,
  linkBtn,
  localToday,
  money,
  outlined,
  primary,
  quiet,
  toCents,
} from './inv-shared';

interface LineDraft {
  key: number;
  description: string;
  quantity: string;
  rate: string;
}
let nextKey = 1;
const blankLine = (): LineDraft => ({ key: nextKey++, description: '', quantity: '1', rate: '' });
const centsText = (cents: number) => (cents / 100).toFixed(2);

/**
 * /invoices/new (and ?from=<id> to start from a copy) and /invoices/[invoiceId]/edit: the
 * design's Create Invoice page. A draft is saved; Send Invoice saves it and sends it.
 */
export function InvoiceEditor({ invoiceId }: { invoiceId?: string }) {
  const params = useSearchParams();
  const from = invoiceId ?? params.get('from') ?? undefined;
  const source = useApiQuery([...INV_KEY, 'one', from], () =>
    from ? api.invoices.get(from) : Promise.resolve(null),
  );
  if (from && source.isError) {
    return (
      <p role="alert" className={quiet}>
        This invoice is not available.{' '}
        <Link href="/invoices" className="text-link">
          Back to invoices
        </Link>
      </p>
    );
  }
  if (from && !source.data) return <p className={quiet}>Loading the invoice…</p>;
  if (invoiceId && source.data && source.data.status !== 'DRAFT') {
    return (
      <p role="alert" className={quiet}>
        {source.data.number} has been sent, so it can no longer be changed.{' '}
        <Link href={`/invoices/${invoiceId}`} className="text-link">
          View the invoice
        </Link>
      </p>
    );
  }
  return <EditorForm key={from ?? 'new'} invoiceId={invoiceId} source={source.data ?? null} />;
}

/** The form, filled from the draft being edited or the invoice being copied (`source`). */
function EditorForm({ invoiceId, source }: { invoiceId?: string; source: Invoice | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const clients = useApiQuery(['clients', 'invoice-picker'], () =>
    api.clients.list({ limit: 100 }),
  );
  const payments = useApiQuery([...INV_KEY, 'payments-enabled'], () =>
    api.invoices.list({ limit: 1 }),
  );
  const editing = invoiceId ? source : null;
  const [clientId, setClientId] = useState(source?.client.id ?? '');
  const [engagementId, setEngagementId] = useState(editing?.service?.id ?? '');
  const [scheduledFor, setScheduledFor] = useState(editing?.scheduledFor ?? '');
  const [dueOn, setDueOn] = useState(editing?.dueOn ?? '');
  const [lines, setLines] = useState<LineDraft[]>(() =>
    source
      ? source.lines.map((l) => ({
          key: nextKey++,
          description: l.description,
          quantity: String(l.quantity),
          rate: centsText(l.unitAmountCents),
        }))
      : [blankLine()],
  );
  const [discountKind, setDiscountKind] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [discount, setDiscount] = useState(() =>
    source?.discountCents ? centsText(source.discountCents) : '',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const services = useApiQuery(['engagements', clientId], () =>
    clientId ? api.engagements.listForClient(clientId) : Promise.resolve([]),
  );

  const parsed = lines.map((l) => ({
    description: l.description.trim(),
    quantity: Number(l.quantity),
    unitAmountCents: toCents(l.rate || '0'),
  }));
  const valid = parsed.map((l) => ({
    quantity: Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 0,
    unitAmountCents: Number.isNaN(l.unitAmountCents) ? 0 : l.unitAmountCents,
  }));
  const { lineAmountsCents, subtotalCents } = invoiceTotals({ lines: valid });
  const discountCents =
    discountKind === 'PERCENT'
      ? Math.round((subtotalCents * (Number(discount) || 0)) / 100)
      : Number.isNaN(toCents(discount || '0'))
        ? 0
        : toCents(discount || '0');
  const totalCents = subtotalCents - discountCents;

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async (andSend: boolean) => {
    setFailure('');
    const next: Record<string, string> = {};
    if (!invoiceId && !clientId) next['client'] = 'Choose a client';
    parsed.forEach((l, i) => {
      if (Number.isNaN(l.unitAmountCents)) next[`rate${i}`] = 'Enter an amount like 125.50';
      if (!(l.quantity > 0)) next[`qty${i}`] = 'Enter a quantity greater than zero';
    });
    if (!dueOn) next['dueOn'] = 'Choose a due date';
    else if (!invoiceId && dueOn < localToday()) next['dueOn'] = 'Choose today or a future date';
    const body = {
      engagementId: engagementId || null,
      lines: parsed,
      discountCents,
      dueOn,
      scheduledFor: scheduledFor || null,
    };
    const check = invoiceId
      ? UpdateInvoiceRequest.safeParse(body)
      : CreateInvoiceRequest.safeParse({ clientId, ...body });
    if (!check.success) {
      for (const issue of check.error.issues) {
        const [field, index, sub] = issue.path;
        const key =
          field === 'lines' && typeof index === 'number'
            ? `${sub === 'description' ? 'desc' : sub === 'quantity' ? 'qty' : 'rate'}${index}`
            : String(field ?? 'form');
        next[key === 'lines' ? 'form' : key] ??= issue.message;
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const saved = invoiceId
        ? await api.invoices.update(invoiceId, body)
        : await api.invoices.create({ clientId, ...body });
      if (andSend) await api.invoices.send(saved.id);
      await qc.invalidateQueries({ queryKey: [...INV_KEY] });
      router.push(`/invoices/${saved.id}`);
    } catch (e) {
      setFailure(errorMessage(e, INVOICE_ERRORS));
      setBusy(false);
    }
  };

  const clientName = editing
    ? editing.client.displayName
    : (clients.data?.items.find((c) => c.id === clientId)?.displayName ?? '');

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="invoice-editor">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <FilePlus weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
            >
              {invoiceId ? 'Edit Invoice' : 'Create Invoice'}
            </h1>
            <p className="text-base text-link">Build and send a professional invoice in minutes.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-info-soft p-3">
          <Info aria-hidden weight="fill" className="size-8 text-action" />
          <span className="text-sm">
            <span className="block font-semibold text-heading">
              Need to add or update services?
            </span>
            <span className="text-muted">Manage them in Services &amp; Pricing.</span>
          </span>
          <Link href="/services-pricing" className={`${outlined} min-h-9!`}>
            Go to Services &amp; Pricing
          </Link>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className={card} aria-labelledby="inv-details">
            <h2 id="inv-details" className="mb-3 font-display text-xl font-bold text-heading">
              Client &amp; Invoice Details
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {invoiceId ? (
                <Input label="Client" value={clientName} readOnly />
              ) : (
                <Select
                  label="Client *"
                  value={clientId}
                  error={errors['client']}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setEngagementId('');
                  }}
                  options={[
                    {
                      value: '',
                      label: clients.isPending ? 'Loading clients…' : 'Select a client…',
                    },
                    ...(clients.data?.items ?? []).map((c) => ({
                      value: c.id,
                      label: c.displayName,
                    })),
                  ]}
                />
              )}
              <Select
                label="Service"
                value={engagementId}
                disabled={!clientId}
                onChange={(e) => setEngagementId(e.target.value)}
                options={[
                  { value: '', label: 'No service' },
                  ...(services.data ?? []).map((s) => ({ value: s.id, label: s.title })),
                ]}
              />
              <Input
                label="Invoice Number"
                value={editing ? editing.number : 'Given when saved'}
                readOnly
              />
              <Input
                label="Send On"
                type="date"
                value={scheduledFor}
                min={localToday()}
                error={errors['scheduledFor']}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
              <Input
                label="Due Date *"
                type="date"
                value={dueOn}
                min={localToday()}
                error={errors['dueOn']}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              Leave Send On empty to send it as soon as you press Send Invoice; a later day
              schedules it.
            </p>
          </section>

          <section className={card} aria-labelledby="inv-lines">
            <h2 id="inv-lines" className="mb-3 font-display text-xl font-bold text-heading">
              Line Items
            </h2>
            <ol className="flex flex-col gap-3">
              {lines.map((l, i) => (
                <li
                  key={l.key}
                  className="grid gap-3 rounded-lg border border-divider p-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_7rem_auto] sm:items-start"
                  data-testid="invoice-line"
                >
                  <Textarea
                    label={`Description ${i + 1} *`}
                    rows={2}
                    value={l.description}
                    error={errors[`desc${i}`]}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                  />
                  <Input
                    label={`Qty ${i + 1} *`}
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={l.quantity}
                    error={errors[`qty${i}`]}
                    onChange={(e) => update(l.key, { quantity: e.target.value })}
                  />
                  <Input
                    label={`Rate ${i + 1} *`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={l.rate}
                    error={errors[`rate${i}`]}
                    onChange={(e) => update(l.key, { rate: e.target.value })}
                  />
                  <p className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-text">Amount</span>
                    <span className="min-h-11 py-2.5 font-semibold text-heading">
                      {money(lineAmountsCents[i] ?? 0)}
                    </span>
                  </p>
                  <button
                    type="button"
                    className="mt-7 inline-flex size-10 items-center justify-center rounded-control text-danger hover:bg-danger-soft disabled:opacity-40"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <Trash aria-hidden weight="fill" className="size-5" />
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={`${outlined} mt-3 border-action! text-action!`}
              disabled={lines.length >= INVOICE_LIMITS.maxLines}
              onClick={() => setLines((ls) => [...ls, blankLine()])}
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Add Line Item
            </button>
            {errors['form'] ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {errors['form']}
              </p>
            ) : null}
            <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
              <Select
                label="Discount"
                value={discountKind}
                onChange={(e) =>
                  setDiscountKind(e.target.value === 'PERCENT' ? 'PERCENT' : 'AMOUNT')
                }
                options={[
                  { value: 'AMOUNT', label: 'Amount ($)' },
                  { value: 'PERCENT', label: 'Percentage (%)' },
                ]}
              />
              <Input
                label={discountKind === 'PERCENT' ? 'Discount (%)' : 'Discount ($)'}
                inputMode="decimal"
                placeholder="0"
                value={discount}
                error={errors['discountCents']}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </section>

          <section className={card} aria-labelledby="inv-options">
            <h2 id="inv-options" className="mb-1 font-display text-xl font-bold text-heading">
              Payment Options
            </h2>
            <p className="mb-3 text-sm text-muted">How the client can pay this invoice.</p>
            <ul className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  icon: CreditCard,
                  title: 'Credit/Debit Card',
                  text: 'Through Stripe on the client portal.',
                  on: payments.data?.paymentsEnabled,
                },
                {
                  icon: Bank,
                  title: 'ACH Bank Transfer',
                  text: 'Through Stripe on the client portal.',
                  on: payments.data?.paymentsEnabled,
                },
                {
                  icon: Money,
                  title: 'Manual Payment',
                  text: 'Check, cash or transfer you record here.',
                  on: true,
                },
              ].map((o) => (
                <li key={o.title} className="flex gap-3 rounded-lg border border-divider p-3">
                  <o.icon aria-hidden weight="fill" className="size-7 shrink-0 text-action" />
                  <span className="text-sm">
                    <span className="block font-semibold text-heading">{o.title}</span>
                    <span className="block text-xs text-muted">{o.text}</span>
                    <span
                      className={`mt-1 inline-block text-xs font-semibold ${o.on ? 'text-success' : 'text-muted'}`}
                    >
                      {o.on ? 'Available' : payments.isPending ? '…' : 'Set up in Payment Settings'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-5" aria-label="Invoice summary">
          <section className={card} aria-labelledby="inv-summary" data-testid="invoice-summary">
            <h2
              id="inv-summary"
              className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-heading"
            >
              <Calculator aria-hidden weight="fill" className="size-6 text-action" /> Invoice
              Summary
            </h2>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>{money(subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Discount{discountKind === 'PERCENT' && discount ? ` (${discount}%)` : ''}</dt>
                <dd>{money(discountCents)}</dd>
              </div>
              <div className="flex justify-between rounded-lg bg-info-soft p-3 text-lg font-bold text-heading">
                <dt>Total</dt>
                <dd data-testid="invoice-total">{money(totalCents)}</dd>
              </div>
              <div className="flex justify-between px-3">
                <dt>Amount Paid</dt>
                <dd className="font-semibold text-success">{money(0)}</dd>
              </div>
              <div className="flex justify-between rounded-lg bg-warning-soft p-3 text-lg font-bold text-heading">
                <dt>Balance Due</dt>
                <dd>{money(Math.max(0, totalCents))}</dd>
              </div>
            </dl>
            {failure ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {failure}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                className={`${primary} w-full`}
                disabled={busy}
                onClick={() => void save(true)}
              >
                <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
                {scheduledFor && scheduledFor > localToday() ? 'Schedule Invoice' : 'Send Invoice'}
              </button>
              <button
                type="button"
                className={`${outlined} w-full`}
                disabled={busy}
                onClick={() => void save(false)}
              >
                <FloppyDisk aria-hidden weight="fill" className="size-5 text-action" /> Save Draft
              </button>
              <Link
                href={invoiceId ? `/invoices/${invoiceId}` : '/invoices'}
                className={`${linkBtn} justify-center py-2`}
              >
                Cancel
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
