'use client';

import {
  CreateInvoiceRequest,
  INVOICE_ERRORS,
  type Invoice,
  INVOICE_LIMITS,
  invoiceTotals,
  UpdateInvoiceRequest,
  offeredPaymentTerms,
  PaymentTerm,
  paymentTermDays,
  paymentTermLabel,
} from '@firmivra/types';
import { Input, Modal, Select, Textarea } from '@firmivra/ui';
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
  FileText,
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
  dayText,
  INV_KEY,
  linkBtn,
  localToday,
  money,
  outlined,
  primary,
  quiet,
  toCents,
} from './inv-shared';
import { InvoiceAttachments } from './invoice-attachments';
import { RecurringCard, recurringBody, recurringDraftOf, upcomingDays } from './recurring-card';

interface LineDraft {
  key: number;
  description: string;
  quantity: string;
  rate: string;
  /** The Services & Pricing offering the line came from; '' for a custom one-time item. */
  serviceId: string;
  /** IP-F03: the invoice's tax rate applies to this line. */
  taxable: boolean;
}
let nextKey = 1;
const blankLine = (): LineDraft => ({
  key: nextKey++,
  description: '',
  quantity: '1',
  rate: '',
  serviceId: '',
  taxable: false,
});
/** 825 basis points: "8.25%". */
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
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
          serviceId: '',
          taxable: l.taxable,
        }))
      : [blankLine()],
  );
  const [discountKind, setDiscountKind] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [discount, setDiscount] = useState(() =>
    source?.discountCents ? centsText(source.discountCents) : '',
  );
  // IP-F03: the firm's own tax rates, staff and templates (never fixed ones), and the files.
  const taxRates = useApiQuery(['invoice-tax-rates'], () => api.paymentPreferences.taxRates());
  const templates = useApiQuery(['invoice-templates'], () => api.paymentPreferences.templates());
  const team = useApiQuery(['team', 'invoice-staff'], () => api.team.list());
  const [taxRateId, setTaxRateId] = useState<string | null>(editing ? editing.taxRateId : null);
  const [templateId, setTemplateId] = useState<string | null>(
    editing ? (editing.template?.id ?? '') : null,
  );
  const [assignedUserId, setAssignedUserId] = useState(editing?.assignedTo?.userId ?? '');
  const [documentIds, setDocumentIds] = useState<string[]>(
    () => editing?.attachments.map((a) => a.documentId) ?? [],
  );
  // A new invoice starts from the firm's default rate and template.
  const rateId = taxRateId ?? taxRates.data?.items.find((r) => r.isDefault)?.id ?? '';
  const chosenRate = taxRates.data?.items.find((r) => r.id === rateId) ?? null;
  const keptRate = editing?.tax && editing.taxRateId === rateId ? editing.tax : null;
  const rateBps = chosenRate?.rateBps ?? keptRate?.rateBps ?? 0;
  const rateName = chosenRate?.name ?? keptRate?.name ?? '';
  const template = templateId ?? templates.data?.items.find((t) => t.isDefault)?.id ?? '';
  const chosenTemplate = templates.data?.items.find((t) => t.id === template) ?? null;
  const staff = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  // IP-F02: the terms (the due date follows them unless typed), the note to the client and the
  // firm's internal note, which never reaches the client.
  const prefs = useApiQuery(['payment-preferences'], () => api.paymentPreferences.get());
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm | ''>(editing?.paymentTerms ?? '');
  const terms = paymentTerms || prefs.data?.invoiceDefaults.defaultTerms || 'net_14';
  // The four standard terms and the firm's own; a draft keeps terms the firm has since removed.
  const offered = offeredPaymentTerms(prefs.data?.invoiceDefaults.customTermDays ?? []);
  const termOptions = offered.includes(terms) ? offered : [...offered, terms];
  const [notesToClient, setNotesToClient] = useState(editing?.notesToClient ?? '');
  const [internalNote, setInternalNote] = useState(editing?.internalNote ?? '');
  const [previewing, setPreviewing] = useState(false);
  // IP-F05: off keeps a one-time invoice; on, the schedule starts the day the invoice opens.
  const [recurring, setRecurring] = useState(() => recurringDraftOf(editing?.recurring));
  const startOn = scheduledFor && scheduledFor > localToday() ? scheduledFor : localToday();
  const chooseTerms = (next: PaymentTerm) => {
    setPaymentTerms(next);
    const from = scheduledFor && scheduledFor > localToday() ? scheduledFor : localToday();
    const due = new Date(`${from}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + (paymentTermDays(next) ?? 0));
    setDueOn(due.toISOString().slice(0, 10));
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const services = useApiQuery(['engagements', clientId], () =>
    clientId ? api.engagements.listForClient(clientId) : Promise.resolve([]),
  );
  // IP-F01: every active offering the member may see in Services & Pricing, for any client; the
  // client's assigned ones first and marked. A member without Services & Pricing gets custom
  // lines only.
  const catalog = useApiQuery(['catalog-services', 'invoice-lines'], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100, sort: 'name' }),
  );
  const [categoryId, setCategoryId] = useState('');
  const assigned = new Set((services.data ?? []).map((s) => s.service.id));
  const offerings = [...(catalog.data?.items ?? [])].sort(
    (a, b) => Number(assigned.has(b.id)) - Number(assigned.has(a.id)),
  );
  const categories = [
    ...new Map(
      offerings.flatMap((o) => (o.category ? [[o.category.id, o.category.name] as const] : [])),
    ),
  ];
  const pickable = offerings.filter((o) => !categoryId || o.category?.id === categoryId);
  /** Fills the line from the offering: its name and short description, and its price. */
  const pick = (key: number, serviceId: string) => {
    const o = offerings.find((x) => x.id === serviceId);
    update(key, {
      serviceId,
      ...(o
        ? {
            description: o.shortDescription ? `${o.name} — ${o.shortDescription}` : o.name,
            ...(o.price.amountCents === null ? {} : { rate: centsText(o.price.amountCents) }),
          }
        : {}),
    });
  };

  const parsed = lines.map((l) => ({
    description: l.description.trim(),
    quantity: Number(l.quantity),
    unitAmountCents: toCents(l.rate || '0'),
    taxable: l.taxable,
  }));
  const valid = parsed.map((l) => ({
    quantity: Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 0,
    unitAmountCents: Number.isNaN(l.unitAmountCents) ? 0 : l.unitAmountCents,
    taxable: l.taxable,
  }));
  const { lineAmountsCents, subtotalCents } = invoiceTotals({ lines: valid });
  const discountCents =
    discountKind === 'PERCENT'
      ? Math.round((subtotalCents * (Number(discount) || 0)) / 100)
      : Number.isNaN(toCents(discount || '0'))
        ? 0
        : toCents(discount || '0');
  const { taxableSubtotalCents, taxCents, totalCents } = invoiceTotals({
    lines: valid,
    discountCents,
    taxRateBps: rateBps,
  });

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
    if (recurring.on && recurring.ends === 'ON') {
      const second = upcomingDays(recurring, startOn, 1)[0];
      if (!recurring.endOn) next['recurring.endOn'] = 'Choose an end date';
      else if (second && recurring.endOn < second) {
        next['recurring.endOn'] = `End on or after the next invoice, ${dayText(second)}`;
      }
    }
    const body = {
      engagementId: engagementId || null,
      lines: parsed,
      discountCents,
      dueOn,
      scheduledFor: scheduledFor || null,
      paymentTerms: terms,
      notesToClient: notesToClient || null,
      internalNote: internalNote || null,
      recurring: recurringBody(recurring),
      taxRateId: rateId || null,
      assignedUserId: assignedUserId || null,
      templateId: template || null,
      documentIds,
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
            : field === 'recurring'
              ? `recurring.${String(index)}`
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
              <Select
                label="Payment Terms"
                value={terms}
                onChange={(e) => chooseTerms(PaymentTerm.parse(e.target.value))}
                options={termOptions.map((t) => ({ value: t, label: paymentTermLabel(t) }))}
              />
              <Input
                label="Due Date *"
                type="date"
                value={dueOn}
                min={localToday()}
                error={errors['dueOn']}
                onChange={(e) => setDueOn(e.target.value)}
              />
              <Select
                label="Assigned Staff"
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
                options={[
                  { value: '', label: team.isPending ? 'Loading staff…' : 'Unassigned' },
                  ...staff.map((m) => ({ value: m.user.id, label: m.user.name })),
                  // A member who has since left stays shown on their draft.
                  ...(editing?.assignedTo && !staff.some((m) => m.user.id === assignedUserId)
                    ? [{ value: editing.assignedTo.userId, label: editing.assignedTo.name }]
                    : []),
                ]}
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
            {catalog.isError ? (
              <p className="mb-3 text-sm text-muted">
                Services & Pricing isn&apos;t available to you: type each item.
              </p>
            ) : (
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <div className="w-56">
                  <Select
                    label="Service category"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    options={[
                      { value: '', label: 'All categories' },
                      ...categories.map(([id, name]) => ({ value: id, label: name })),
                    ]}
                  />
                </div>
                <p className="max-w-xl text-xs text-muted">
                  Pick a service to fill a line with its details and price, or type a custom item. A
                  custom item is for this invoice only; add lasting services in Services & Pricing.
                </p>
              </div>
            )}
            <ol className="flex flex-col gap-3">
              {lines.map((l, i) => (
                <li
                  key={l.key}
                  className="grid gap-3 rounded-lg border border-divider p-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_9rem_7rem_auto] sm:items-start"
                  data-testid="invoice-line"
                >
                  {catalog.isError ? null : (
                    <div className="sm:col-span-6">
                      <Select
                        label={`Service ${i + 1}`}
                        value={l.serviceId}
                        onChange={(e) => pick(l.key, e.target.value)}
                        options={[
                          { value: '', label: 'Custom item' },
                          ...pickable.map((o) => ({
                            value: o.id,
                            label: `${o.name}${assigned.has(o.id) ? ' (assigned to this client)' : ''}${
                              o.price.amountCents === null ? ' · custom quote' : ''
                            }`,
                          })),
                        ]}
                      />
                    </div>
                  )}
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
                  <Select
                    label={`Tax ${i + 1}`}
                    value={l.taxable ? 'TAXABLE' : 'NON'}
                    onChange={(e) => update(l.key, { taxable: e.target.value === 'TAXABLE' })}
                    options={[
                      { value: 'NON', label: 'Non-taxable' },
                      { value: 'TAXABLE', label: 'Taxable' },
                    ]}
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
            <div className="mt-3 max-w-md">
              {taxRates.isError ? null : (taxRates.data?.items.length ?? 0) === 0 && !keptRate ? (
                <p className="text-sm text-muted">
                  No tax rates yet.{' '}
                  <Link href="/settings/payments" className="text-link">
                    Add your firm&apos;s rates in Settings &gt; Payments
                  </Link>{' '}
                  to tax lines.
                </p>
              ) : (
                <Select
                  label="Tax rate"
                  value={rateId}
                  error={errors['taxRateId']}
                  onChange={(e) => setTaxRateId(e.target.value)}
                  options={[
                    { value: '', label: 'No tax' },
                    ...(taxRates.data?.items ?? []).map((r) => ({
                      value: r.id,
                      label: `${r.name} (${pct(r.rateBps)})`,
                    })),
                    ...(keptRate && !chosenRate
                      ? [{ value: rateId, label: `${keptRate.name} (${pct(keptRate.rateBps)})` }]
                      : []),
                  ]}
                />
              )}
            </div>
          </section>

          <section className={card} aria-labelledby="inv-notes">
            <h2 id="inv-notes" className="mb-3 font-display text-xl font-bold text-heading">
              Notes
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              <Textarea
                label="Notes to Client"
                rows={3}
                maxLength={1000}
                value={notesToClient}
                error={errors['notesToClient']}
                onChange={(e) => setNotesToClient(e.target.value)}
              />
              <div>
                <Textarea
                  label="Internal Note"
                  rows={3}
                  maxLength={1000}
                  value={internalNote}
                  error={errors['internalNote']}
                  onChange={(e) => setInternalNote(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted">
                  Only your firm sees this. It never appears on the client&apos;s invoice, PDF,
                  email or portal.
                </p>
              </div>
            </div>
            <div className="mt-3">
              <InvoiceAttachments
                clientId={clientId}
                services={(services.data ?? []).map((sv) => ({ id: sv.id, title: sv.title }))}
                engagementId={engagementId}
                value={documentIds}
                onChange={setDocumentIds}
              />
              {errors['documentIds'] ? (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {errors['documentIds']}
                </p>
              ) : null}
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
              <div className="flex justify-between" data-testid="invoice-tax">
                <dt>{rateBps > 0 ? `Tax (${rateName} ${pct(rateBps)})` : 'Tax'}</dt>
                <dd>{money(taxCents)}</dd>
              </div>
              {rateBps > 0 && taxableSubtotalCents === 0 ? (
                <p className="text-xs text-muted">Mark lines Taxable to apply the rate.</p>
              ) : null}
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
                onClick={() => setPreviewing(true)}
              >
                Preview Invoice
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
          <section className={card} aria-labelledby="inv-template">
            <h2
              id="inv-template"
              className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-heading"
            >
              <FileText aria-hidden weight="fill" className="size-6 text-action" /> Invoice Template
            </h2>
            {templates.isError ? (
              <p className="text-sm text-muted">Templates aren&apos;t available right now.</p>
            ) : (templates.data?.items.length ?? 0) === 0 && !editing?.template ? (
              <p className="text-sm text-muted">
                No templates yet: the invoice uses your firm&apos;s branding.{' '}
                <Link href="/settings/payments" className="text-link">
                  Create one in Settings &gt; Payments
                </Link>
                .
              </p>
            ) : (
              <>
                <Select
                  label="Template"
                  value={template}
                  onChange={(e) => setTemplateId(e.target.value)}
                  options={[
                    { value: '', label: "Your firm's branding" },
                    ...(templates.data?.items ?? []).map((t) => ({ value: t.id, label: t.name })),
                    ...(editing?.template && !chosenTemplate && template === editing.template.id
                      ? [{ value: editing.template.id, label: editing.template.name }]
                      : []),
                  ]}
                />
                <button
                  type="button"
                  className={`${linkBtn} mt-2`}
                  onClick={() => setPreviewing(true)}
                >
                  Preview Template
                </button>
              </>
            )}
          </section>
          <RecurringCard
            value={recurring}
            onChange={setRecurring}
            startOn={startOn}
            errors={errors}
          />
        </aside>
      </div>
      <Modal
        open={previewing}
        title="Invoice preview"
        subtitle="What your client sees. Nothing is saved or sent."
        onClose={() => setPreviewing(false)}
      >
        <div data-testid="invoice-preview" className="flex flex-col gap-3 text-sm text-text">
          <div className="flex flex-wrap justify-between gap-2">
            <p>
              <span className="block text-xs text-muted">Bill to</span>
              <span className="font-semibold text-heading">
                {clients.data?.items.find((c) => c.id === clientId)?.displayName ??
                  source?.client.displayName ??
                  'No client chosen yet'}
              </span>
            </p>
            <p className="text-right">
              <span className="block text-xs text-muted">Invoice</span>
              <span className="font-semibold text-heading">
                {editing ? editing.number : 'Numbered when saved'}
              </span>
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2">
            <div>
              <dt className="text-xs text-muted">Issued</dt>
              <dd>{scheduledFor || localToday()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Terms</dt>
              <dd>{paymentTermLabel(terms)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Due</dt>
              <dd>{dueOn || 'Not chosen yet'}</dd>
            </div>
          </dl>
          <table className="w-full text-left">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Description</th>
                <th className="py-1 text-right font-medium">Qty</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((l, i) => (
                <tr key={lines[i]?.key ?? i} className="border-t border-divider">
                  <td className="py-1">{l.description || 'No description yet'}</td>
                  <td className="py-1 text-right">
                    {Number.isFinite(l.quantity) ? l.quantity : ''}
                  </td>
                  <td className="py-1 text-right">{money(lineAmountsCents[i] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto grid w-56 grid-cols-2 gap-1">
            <dt>Subtotal</dt>
            <dd className="text-right">{money(subtotalCents)}</dd>
            {discountCents > 0 ? (
              <>
                <dt>Discount</dt>
                <dd className="text-right">-{money(discountCents)}</dd>
              </>
            ) : null}
            {taxCents > 0 ? (
              <>
                <dt>Tax ({pct(rateBps)})</dt>
                <dd className="text-right">{money(taxCents)}</dd>
              </>
            ) : null}
            <dt className="font-semibold text-heading">Total</dt>
            <dd className="text-right font-semibold text-heading">{money(totalCents)}</dd>
          </dl>
          {notesToClient.trim() ? (
            <p className="rounded-lg bg-canvas p-3">
              <span className="block text-xs text-muted">Notes</span>
              <span className="whitespace-pre-line">{notesToClient}</span>
            </p>
          ) : null}
          {chosenTemplate?.memo ? (
            <p className="whitespace-pre-line">{chosenTemplate.memo}</p>
          ) : null}
          {documentIds.length > 0 ? (
            <p className="text-xs text-muted">
              {documentIds.length === 1
                ? '1 file attached'
                : `${documentIds.length} files attached`}
            </p>
          ) : null}
          {chosenTemplate?.footer ? (
            <p className="border-t border-divider pt-2 text-xs whitespace-pre-line text-muted">
              {chosenTemplate.footer}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
