'use client';

import {
  ActionMenu,
  Button,
  Checkbox,
  FileDropzone,
  FormField,
  Modal,
  Skeleton,
  type FileRejection,
} from '@firmivra/ui';
import { ArrowSquareOut, Eye, FilePdf, Plus, Trash, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import {
  adminBilling,
  computeTotals,
  CURRENCIES,
  INVOICE_TYPES,
  invoiceErrors,
  hasErrors,
  nextOccurrence,
  PAYMENT_TERM_DAYS,
  PAYMENT_TERMS,
  type BillingAttachment,
  type BillingFirm,
  type BillingSettings,
  type Currency,
  type InvoiceDetail,
  type InvoiceType,
  type LineErrors,
  type NewAttachment,
  type PaymentTerms,
  type SaveInvoice,
} from '../../../../../../mocks/admin-billing';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { DateControl, inputClass, SelectControl } from '../../_components/billing-fields';
import {
  addDays,
  formatBytes,
  formatMoney,
  moneyInput,
  parseMoney,
  parseQuantity,
  todayIso,
} from '../../_components/billing-format';
import {
  BILLING_ERRORS,
  CURRENCY_LABELS,
  INVOICE_TYPE_LABELS,
  optionsOf,
  PAYMENT_TERMS_LABELS,
} from '../../_components/billing-labels';
import { BillingCard, QuietLine, quietErrorText } from '../../_components/billing-parts';
import { BillingHeader, type Crumb } from '../../_components/billing-shell';
import {
  DocumentViewer,
  InvoiceDocument,
  type InvoiceDocumentData,
} from '../../_components/invoice-document';
import { RecurringDrawer } from '../../_components/recurring-drawer';

/**
 * Create Invoice and Edit Invoice: one form (docx §7; firmivra-create-invoice-dashboard.jpg).
 * Edit mode loads the invoice and keeps its id, payments and history; `estimateId` converts an
 * estimate (docx §10.2). Totals update live and are recalculated by the mock on save.
 */

let lineSeq = 0;
/** A key for a new line or file row (never an index). */
const newKey = (prefix: string) => {
  lineSeq += 1;
  return `${prefix}-${lineSeq}`;
};

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  rate: string;
  taxRateId: string;
}
interface FileDraft extends NewAttachment {
  key: string;
}
interface Draft {
  firmId: string;
  clientId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  type: InvoiceType;
  currency: Currency;
  paymentTerms: PaymentTerms;
  reference: string;
  notes: string;
  lines: LineDraft[];
  discountCents: number;
  allowOnlinePayment: boolean;
  sendNow: boolean;
  recurring: boolean;
  estimateId: string | null;
  files: FileDraft[];
  kept: BillingAttachment[];
}

const blankLine = (): LineDraft => ({
  key: newKey('line'),
  description: '',
  quantity: '1',
  rate: '',
  taxRateId: '',
});

function draftFrom(
  body: SaveInvoice,
  options: { sendNow: boolean; recurring: boolean; kept: BillingAttachment[] },
): Draft {
  return {
    firmId: body.firmId,
    clientId: body.clientId,
    number: body.number,
    issueDate: body.issueDate,
    dueDate: body.dueDate,
    type: body.type,
    currency: body.currency,
    paymentTerms: body.paymentTerms,
    reference: body.reference,
    notes: body.notes,
    lines: body.lines.length
      ? body.lines.map((line) => ({
          key: newKey('line'),
          description: line.description,
          quantity: String(line.quantity),
          rate: moneyInput(line.rateCents),
          taxRateId: line.taxRateId ?? '',
        }))
      : [blankLine()],
    discountCents: body.discountCents,
    allowOnlinePayment: body.allowOnlinePayment,
    sendNow: options.sendNow,
    recurring: options.recurring,
    estimateId: body.estimateId,
    files: [],
    kept: options.kept,
  };
}

function bodyOf(draft: Draft, send: boolean): SaveInvoice {
  return {
    firmId: draft.firmId,
    clientId: draft.clientId,
    number: draft.number,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    type: draft.type,
    currency: draft.currency,
    paymentTerms: draft.paymentTerms,
    reference: draft.reference,
    notes: draft.notes,
    lines: draft.lines.map((line) => ({
      description: line.description,
      quantity: parseQuantity(line.quantity),
      rateCents: line.rate.trim() ? (parseMoney(line.rate) ?? Number.NaN) : Number.NaN,
      taxRateId: line.taxRateId || null,
    })),
    discountCents: draft.discountCents,
    allowOnlinePayment: draft.allowOnlinePayment,
    send,
    emailClient: draft.sendNow,
    estimateId: draft.estimateId,
    attachments: draft.files.map(({ name, contentType, sizeBytes, file }) => ({
      name,
      contentType,
      sizeBytes,
      file,
    })),
    keepAttachmentIds: draft.kept.map((file) => file.id),
  };
}

/** What a save compares against to know whether anything changed. */
const signature = (draft: Draft) =>
  JSON.stringify({
    ...bodyOf(draft, false),
    lines: draft.lines.map(({ key: _key, ...line }) => line),
    attachments: draft.files.map((file) => file.name),
    recurring: draft.recurring,
    sendNow: draft.sendNow,
  });

/** The Create / Edit Invoice screen: loads what the form needs, then shows it. */
export function InvoiceEditor({
  mode,
  invoiceId,
  estimateId,
}: {
  mode: 'create' | 'edit';
  invoiceId?: string;
  estimateId?: string | null;
}) {
  const settings = useApiQuery(['admin-billing', 'settings'], () => adminBilling.settings());
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const source = useApiQuery(
    ['admin-billing', 'invoice-source', mode, invoiceId ?? '', estimateId ?? ''],
    async () => {
      if (mode === 'edit' && invoiceId)
        return { invoice: await adminBilling.invoice(invoiceId), body: null, number: '' };
      if (estimateId)
        return {
          invoice: null,
          body: await adminBilling.estimateToInvoice(estimateId),
          number: '',
        };
      return { invoice: null, body: null, number: await adminBilling.nextNumber('invoice') };
    },
  );
  const failed = settings.error ?? firms.error ?? source.error;

  // Wait for this visit's own fetch: a cached number or invoice may already be out of date.
  if (settings.data && firms.data && source.data && source.isFetchedAfterMount) {
    return (
      <InvoiceForm
        mode={mode}
        settings={settings.data}
        firms={firms.data}
        invoice={source.data.invoice}
        initial={source.data.body}
        suggestedNumber={source.data.number}
      />
    );
  }
  const loading = !failed;
  const quiet = failed ? <QuietLine testId="form-error">{quietErrorText(failed)}</QuietLine> : null;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title={mode === 'edit' ? 'Edit Invoice' : 'Create Invoice'}
        subtitle={
          mode === 'edit'
            ? 'Update the invoice details below. Totals are recalculated when you save.'
            : 'Create a new invoice for a client. Fill in the details below and preview before sending.'
        }
        breadcrumbs={crumbs(mode, null)}
        actions={
          <>
            <Button variant="secondary" disabled>
              Cancel
            </Button>
            <Button variant="outline" disabled>
              Save as Draft
            </Button>
            <Button disabled>Save &amp; Send</Button>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-5">
        <BillingCard title="Invoice Details" titleSize="xl" className="xl:col-span-3">
          {loading ? <FormSkeleton /> : quiet}
        </BillingCard>
        <BillingCard title="Invoice Preview" titleSize="xl" className="self-start xl:col-span-2">
          {loading ? <FormSkeleton /> : quiet}
        </BillingCard>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      {['a', 'b', 'c', 'd'].map((key) => (
        <Skeleton key={key} className="h-10" />
      ))}
    </div>
  );
}

function crumbs(mode: 'create' | 'edit', invoice: InvoiceDetail | null): Crumb[] {
  if (mode === 'create')
    return [
      { label: 'Billing', href: '/billing' },
      { label: 'Invoices', href: '/billing' },
      { label: 'Create Invoice' },
    ];
  return [
    { label: 'Billing', href: '/billing' },
    { label: 'Invoices', href: '/billing' },
    ...(invoice ? [{ label: invoice.number, href: `/billing/invoices/${invoice.id}` }] : []),
    { label: 'Edit' },
  ];
}

function InvoiceForm({
  mode,
  settings,
  firms,
  invoice,
  initial,
  suggestedNumber,
}: {
  mode: 'create' | 'edit';
  settings: BillingSettings;
  firms: BillingFirm[];
  invoice: InvoiceDetail | null;
  initial: SaveInvoice | null;
  suggestedNumber: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => {
    if (invoice)
      return draftFrom(
        {
          firmId: invoice.firmId,
          clientId: invoice.clientId,
          number: invoice.number,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          type: invoice.type,
          currency: invoice.currency,
          paymentTerms: invoice.paymentTerms,
          reference: invoice.reference,
          notes: invoice.notes,
          lines: invoice.lines,
          discountCents: invoice.discountCents,
          allowOnlinePayment: invoice.allowOnlinePayment,
          send: false,
          estimateId: invoice.estimateId,
          attachments: [],
          keepAttachmentIds: [],
        },
        {
          sendNow: true,
          recurring: Boolean(invoice.recurringScheduleId),
          kept: invoice.attachments,
        },
      );
    const today = todayIso();
    const terms = settings.general.invoiceTerms;
    return draftFrom(
      initial ?? {
        firmId: '',
        clientId: '',
        number: suggestedNumber,
        issueDate: today,
        dueDate: addDays(today, PAYMENT_TERM_DAYS[terms]),
        type: settings.invoices.defaultInvoiceType,
        currency: settings.general.currency,
        paymentTerms: terms,
        reference: '',
        notes: '',
        lines: [],
        discountCents: 0,
        allowOnlinePayment: settings.invoices.onlinePaymentDefault,
        send: false,
        estimateId: null,
        attachments: [],
        keepAttachmentIds: [],
      },
      { sendNow: settings.invoices.sendNowDefault, recurring: false, kept: [] },
    );
  });
  const [baseline] = useState(() => signature(draft));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([]);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [recurringFor, setRecurringFor] = useState<{ saved: InvoiceDetail; kind: string } | null>(
    null,
  );
  const scheduledRef = useRef(false);
  const clients = useApiQuery(['admin-billing', 'clients', draft.firmId || 'none'], () =>
    draft.firmId ? adminBilling.clients({ firmId: draft.firmId }) : Promise.resolve([]),
  );
  const save = useApiMutation(
    (body: SaveInvoice) =>
      mode === 'edit' && invoice
        ? adminBilling.updateInvoice(invoice.id, body)
        : adminBilling.createInvoice(body),
    { invalidate: ['admin-billing'] },
  );

  const firm = firms.find((row) => row.id === draft.firmId) ?? null;
  const client = (clients.data ?? []).find((row) => row.id === draft.clientId) ?? null;
  const firmOptions = firms
    .filter((row) => row.status === 'ACTIVE' || row.id === draft.firmId)
    .map((row) => ({ value: row.id, label: row.name }));
  const rates = settings.taxes.rates;
  const percentOf = (taxRateId: string) =>
    rates.find((rate) => rate.id === taxRateId)?.ratePercent ?? 0;
  const totals = computeTotals(
    draft.lines.map((line) => ({
      quantity: parseQuantity(line.quantity) || 0,
      rateCents: parseMoney(line.rate) ?? 0,
      taxPercent: percentOf(line.taxRateId),
    })),
    draft.discountCents,
  );
  const previewData: InvoiceDocumentData = {
    number: draft.number,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    paymentTerms: draft.paymentTerms,
    type: draft.type,
    reference: draft.reference,
    notes: draft.notes,
    currency: draft.currency,
    lines: draft.lines.map((line, index) => ({
      id: line.key,
      description: line.description,
      quantity: parseQuantity(line.quantity) || 0,
      rateCents: parseMoney(line.rate) ?? 0,
      amountCents: totals.lines[index]?.amountCents ?? 0,
      taxPercent: percentOf(line.taxRateId),
    })),
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  };
  const issued = Boolean(invoice?.issuedAt);
  const voided = invoice?.status === 'VOIDED';
  const dirty = signature(draft) !== baseline;
  const set = (patch: Partial<Draft>) => setDraft((now) => ({ ...now, ...patch }));
  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setDraft((now) => ({
      ...now,
      lines: now.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  const backHref = invoice ? `/billing/invoices/${invoice.id}` : '/billing';

  function finish(saved: InvoiceDetail, kind: string) {
    router.push(`/billing/invoices/${saved.id}?saved=${kind}`);
  }

  function submit(send: boolean) {
    // An issued invoice's primary button always resends it.
    const email = issued || draft.sendNow;
    const body = { ...bodyOf(draft, send), emailClient: email };
    const found = invoiceErrors(body);
    setFieldErrors(found.fields);
    setLineErrors(found.lines);
    if (hasErrors(found)) return;
    const kind = send ? (email ? 'sent' : 'issued') : mode === 'edit' ? 'updated' : 'draft';
    save.mutate(body, {
      onSuccess: (saved) => {
        if (draft.recurring && !saved.recurringScheduleId) setRecurringFor({ saved, kind });
        else finish(saved, kind);
      },
      onError: (error) => {
        if (errorCode(error) === 'DUPLICATE_NUMBER')
          setFieldErrors((now) => ({ ...now, number: BILLING_ERRORS['DUPLICATE_NUMBER'] }));
      },
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(true);
  }

  function rejectFiles(rejections: FileRejection[]) {
    const first = rejections[0];
    if (!first) return;
    setFileError(
      first.reason === 'size'
        ? `${first.file.name} is larger than ${settings.invoices.maxAttachmentMb}MB.`
        : `${first.file.name} is not a supported file type.`,
    );
  }

  const sendLabel = issued ? 'Save & Resend' : draft.sendNow ? 'Save & Send' : 'Save & Issue';
  const draftLabel = mode === 'edit' && issued ? 'Save Changes' : 'Save as Draft';
  const formId = 'invoice-form';

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title={mode === 'edit' && invoice ? `Edit Invoice ${invoice.number}` : 'Create Invoice'}
        subtitle={
          mode === 'edit'
            ? 'Update the invoice details below. Totals are recalculated when you save.'
            : 'Create a new invoice for a client. Fill in the details below and preview before sending.'
        }
        breadcrumbs={crumbs(mode, invoice)}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => (dirty ? setLeaving(true) : router.push(backHref))}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={save.isPending || voided}
              onClick={() => submit(false)}
            >
              {draftLabel}
            </Button>
            <div className="inline-flex h-11 items-stretch rounded-control bg-action text-on-action">
              <button
                type="submit"
                form={formId}
                disabled={save.isPending || voided}
                className="inline-flex items-center rounded-l-control px-4 text-sm font-medium hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
              >
                {save.isPending ? 'Saving…' : sendLabel}
              </button>
              <span aria-hidden className="my-2.5 w-px bg-on-action/40" />
              <ActionMenu
                label="More save options"
                align="right"
                trigger={<span className="sr-only">More save options</span>}
                sections={[
                  {
                    items: [
                      { label: 'Preview Invoice', icon: Eye, onSelect: () => setPreview(true) },
                    ],
                  },
                ]}
                className="flex [&>button]:h-full [&>button]:rounded-l-none [&>button]:rounded-r-control [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-on-action [&>button]:hover:bg-action-hover"
              />
            </div>
          </>
        }
      />
      {voided ? (
        <p role="status" className="rounded-lg bg-disabled p-3 text-sm text-text">
          This invoice is voided, so it can&apos;t be changed.
        </p>
      ) : null}
      {save.error ? (
        <p
          role="alert"
          data-testid="save-error"
          className="rounded-lg bg-danger-soft p-3 text-sm text-danger"
        >
          {errorMessage(save.error, BILLING_ERRORS)}
        </p>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <form
          id={formId}
          noValidate
          onSubmit={onSubmit}
          aria-label={mode === 'edit' ? 'Edit invoice' : 'Create invoice'}
          className="flex min-w-0 flex-col gap-6 rounded-xl bg-surface p-5 shadow-sm md:p-6 xl:col-span-3"
        >
          <section aria-labelledby="invoice-details-title" className="flex flex-col gap-4">
            <h2 id="invoice-details-title" className="text-xl font-bold text-heading">
              Invoice Details
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Firm" htmlFor="invoice-firm" required error={fieldErrors['firmId']}>
                <SelectControl
                  id="invoice-firm"
                  value={draft.firmId}
                  placeholder="Select a firm..."
                  invalid={Boolean(fieldErrors['firmId'])}
                  disabled={
                    mode === 'edit' && (invoice?.paidCents ?? 0) + (invoice?.creditedCents ?? 0) > 0
                  }
                  options={firmOptions}
                  onChange={(event) => {
                    const next = firms.find((row) => row.id === event.target.value);
                    set({
                      firmId: event.target.value,
                      clientId: '',
                      ...(next && mode === 'create'
                        ? {
                            currency: next.currency,
                            paymentTerms: next.paymentTerms,
                            dueDate: addDays(
                              draft.issueDate || todayIso(),
                              PAYMENT_TERM_DAYS[next.paymentTerms],
                            ),
                          }
                        : {}),
                    });
                  }}
                />
              </FormField>
              <FormField
                label="Client"
                htmlFor="invoice-client"
                required
                error={fieldErrors['clientId']}
              >
                <SelectControl
                  id="invoice-client"
                  value={draft.clientId}
                  placeholder={draft.firmId ? 'Select a client...' : 'Select a firm first...'}
                  invalid={Boolean(fieldErrors['clientId'])}
                  disabled={
                    !draft.firmId ||
                    (mode === 'edit' &&
                      (invoice?.paidCents ?? 0) + (invoice?.creditedCents ?? 0) > 0)
                  }
                  options={(clients.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
                  onChange={(event) => set({ clientId: event.target.value })}
                />
              </FormField>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField
                label="Invoice Number"
                htmlFor="invoice-number"
                required
                error={fieldErrors['number']}
              >
                <input
                  id="invoice-number"
                  value={draft.number}
                  maxLength={40}
                  aria-invalid={Boolean(fieldErrors['number']) || undefined}
                  onChange={(event) => set({ number: event.target.value })}
                  className={inputClass(Boolean(fieldErrors['number']))}
                />
              </FormField>
              <FormField
                label="Invoice Date"
                htmlFor="invoice-date"
                required
                error={fieldErrors['issueDate']}
              >
                <DateControl
                  id="invoice-date"
                  value={draft.issueDate}
                  invalid={Boolean(fieldErrors['issueDate'])}
                  onChange={(event) => {
                    const issueDate = event.target.value;
                    set({
                      issueDate,
                      ...(issueDate
                        ? { dueDate: addDays(issueDate, PAYMENT_TERM_DAYS[draft.paymentTerms]) }
                        : {}),
                    });
                  }}
                />
              </FormField>
              <FormField
                label="Due Date"
                htmlFor="invoice-due"
                required
                error={fieldErrors['dueDate']}
              >
                <DateControl
                  id="invoice-due"
                  value={draft.dueDate}
                  min={draft.issueDate || undefined}
                  invalid={Boolean(fieldErrors['dueDate'])}
                  onChange={(event) => set({ dueDate: event.target.value })}
                />
              </FormField>
              <FormField label="Invoice Type" htmlFor="invoice-type">
                <SelectControl
                  id="invoice-type"
                  value={draft.type}
                  options={optionsOf(INVOICE_TYPES, INVOICE_TYPE_LABELS)}
                  onChange={(event) => set({ type: event.target.value as InvoiceType })}
                />
              </FormField>
              <FormField label="Currency" htmlFor="invoice-currency">
                <SelectControl
                  id="invoice-currency"
                  value={draft.currency}
                  options={optionsOf(CURRENCIES, CURRENCY_LABELS)}
                  onChange={(event) => set({ currency: event.target.value as Currency })}
                />
              </FormField>
              <FormField label="Payment Terms" htmlFor="invoice-terms">
                <SelectControl
                  id="invoice-terms"
                  value={draft.paymentTerms}
                  options={optionsOf(PAYMENT_TERMS, PAYMENT_TERMS_LABELS)}
                  onChange={(event) => {
                    const paymentTerms = event.target.value as PaymentTerms;
                    set({
                      paymentTerms,
                      ...(draft.issueDate
                        ? { dueDate: addDays(draft.issueDate, PAYMENT_TERM_DAYS[paymentTerms]) }
                        : {}),
                    });
                  }}
                />
              </FormField>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label="Reference (Optional)"
                htmlFor="invoice-reference"
                error={fieldErrors['reference']}
              >
                <textarea
                  id="invoice-reference"
                  rows={3}
                  maxLength={120}
                  value={draft.reference}
                  placeholder="e.g. PO number, contract number"
                  onChange={(event) => set({ reference: event.target.value })}
                  className={inputClass(Boolean(fieldErrors['reference']))}
                />
              </FormField>
              <FormField
                label="Notes (Optional)"
                htmlFor="invoice-notes"
                error={fieldErrors['notes']}
              >
                <textarea
                  id="invoice-notes"
                  rows={3}
                  maxLength={1000}
                  value={draft.notes}
                  placeholder="Add any notes to appear on the invoice..."
                  onChange={(event) => set({ notes: event.target.value })}
                  className={inputClass(Boolean(fieldErrors['notes']))}
                />
              </FormField>
            </div>
          </section>

          <section
            aria-labelledby="invoice-lines-title"
            className="flex flex-col gap-4 border-t border-divider pt-6"
          >
            <h2 id="invoice-lines-title" className="text-xl font-bold text-heading">
              Line Items
            </h2>
            {fieldErrors['lines'] ? (
              <p className="text-sm text-danger">{fieldErrors['lines']}</p>
            ) : null}
            <div className="rounded-lg border border-divider">
              <div
                aria-hidden
                className="hidden grid-cols-12 gap-3 rounded-t-lg bg-table-head px-3 py-3 text-sm font-semibold text-heading md:grid"
              >
                <span className="col-span-4">
                  Description <span className="text-danger">*</span>
                </span>
                <span className="col-span-2">
                  Qty <span className="text-danger">*</span>
                </span>
                <span className="col-span-2">
                  Rate <span className="text-danger">*</span>
                </span>
                <span className="col-span-2">Tax</span>
                <span className="col-span-2">Amount</span>
              </div>
              <ul className="flex flex-col divide-y divide-divider">
                {draft.lines.map((line, index) => {
                  const errors = lineErrors[index] ?? {};
                  const messages = [errors.description, errors.quantity, errors.rate].filter(
                    Boolean,
                  );
                  const n = index + 1;
                  return (
                    <li
                      key={line.key}
                      data-testid="invoice-line"
                      className="flex flex-col gap-1 p-3"
                    >
                      <div className="grid grid-cols-2 items-center gap-3 md:grid-cols-12">
                        <input
                          aria-label={`Description, line ${n}`}
                          value={line.description}
                          maxLength={200}
                          placeholder="Enter description..."
                          aria-invalid={Boolean(errors.description) || undefined}
                          onChange={(event) =>
                            setLine(line.key, { description: event.target.value })
                          }
                          className={`${inputClass(Boolean(errors.description))} col-span-2 md:col-span-4`}
                        />
                        <input
                          aria-label={`Quantity, line ${n}`}
                          inputMode="decimal"
                          value={line.quantity}
                          placeholder="1"
                          aria-invalid={Boolean(errors.quantity) || undefined}
                          onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                          className={`${inputClass(Boolean(errors.quantity))} md:col-span-2`}
                        />
                        <input
                          aria-label={`Rate, line ${n}`}
                          inputMode="decimal"
                          value={line.rate}
                          placeholder="0.00"
                          aria-invalid={Boolean(errors.rate) || undefined}
                          onChange={(event) => setLine(line.key, { rate: event.target.value })}
                          className={`${inputClass(Boolean(errors.rate))} md:col-span-2`}
                        />
                        <div className="md:col-span-2">
                          <SelectControl
                            aria-label={`Tax, line ${n}`}
                            value={line.taxRateId}
                            options={[
                              { value: '', label: 'None' },
                              ...rates.map((rate) => ({
                                value: rate.id,
                                label: `${rate.name} (${rate.ratePercent}%)`,
                              })),
                            ]}
                            onChange={(event) =>
                              setLine(line.key, { taxRateId: event.target.value })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 md:col-span-2">
                          <span data-testid="line-amount" className="text-base text-text">
                            {formatMoney(totals.lines[index]?.amountCents ?? 0, draft.currency)}
                          </span>
                          <button
                            type="button"
                            aria-label={`Delete line ${n}`}
                            title="Delete line"
                            disabled={draft.lines.length === 1}
                            onClick={() =>
                              setDraft((now) => ({
                                ...now,
                                lines: now.lines.filter((row) => row.key !== line.key),
                              }))
                            }
                            className="inline-flex size-10 items-center justify-center rounded-lg text-heading hover:bg-canvas disabled:cursor-not-allowed disabled:text-disabled-text"
                          >
                            <Trash aria-hidden weight="fill" className="size-5" />
                          </button>
                        </div>
                      </div>
                      {messages.length ? (
                        <p className="text-xs text-danger">{messages.join(' · ')}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <Button
                variant="outline"
                onClick={() => set({ lines: [...draft.lines, blankLine()] })}
              >
                <Plus aria-hidden weight="bold" className="size-5" />
                Add Line Item
              </Button>
            </div>
          </section>

          <section
            aria-labelledby="invoice-options-title"
            className="grid gap-6 border-t border-divider pt-6 md:grid-cols-2"
          >
            <div className="flex flex-col gap-1">
              <h2 id="invoice-options-title" className="mb-2 text-xl font-bold text-heading">
                Additional Options
              </h2>
              <Checkbox
                label="Send invoice to client now"
                checked={draft.sendNow}
                onChange={(event) => set({ sendNow: event.target.checked })}
              />
              <Checkbox
                label="Allow online payment (AutoPay)"
                checked={draft.allowOnlinePayment}
                onChange={(event) => set({ allowOnlinePayment: event.target.checked })}
              />
              <Checkbox
                label="Set up as recurring invoice"
                checked={draft.recurring}
                disabled={Boolean(invoice?.recurringScheduleId)}
                onChange={(event) => set({ recurring: event.target.checked })}
              />
              {draft.recurring && !invoice?.recurringScheduleId ? (
                <p className="text-sm text-muted">After you save, choose how often it repeats.</p>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-2 md:pt-11">
              <p className="text-base font-medium text-action">Attach Files (Optional)</p>
              {settings.invoices.allowAttachments ? (
                <>
                  <FileDropzone
                    label="Attach files"
                    title="Drag and drop files here or click to browse"
                    accept={settings.invoices.attachmentTypes}
                    maxBytes={settings.invoices.maxAttachmentMb * 1024 * 1024}
                    onFiles={(files) => {
                      setFileError('');
                      set({
                        files: [
                          ...draft.files,
                          ...files.map((file) => ({
                            key: newKey('file'),
                            name: file.name,
                            contentType: file.type,
                            sizeBytes: file.size,
                            file,
                          })),
                        ],
                      });
                    }}
                    onReject={rejectFiles}
                  />
                  <p className="text-xs text-muted">
                    Max file size {settings.invoices.maxAttachmentMb}MB. Supported files:{' '}
                    {settings.invoices.attachmentTypes
                      .map((type) => type.replace('.', '').toUpperCase())
                      .join(', ')}
                    .
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  Attachments are turned off in Billing Settings.
                </p>
              )}
              {fileError ? (
                <p role="alert" className="text-xs text-danger">
                  {fileError}
                </p>
              ) : null}
              {draft.kept.length + draft.files.length ? (
                <ul aria-label="Attached files" className="flex flex-col gap-2">
                  {[
                    ...draft.kept.map((file) => ({
                      key: file.id,
                      name: file.name,
                      size: file.sizeBytes,
                      kept: true,
                    })),
                    ...draft.files.map((file) => ({
                      key: file.key,
                      name: file.name,
                      size: file.sizeBytes,
                      kept: false,
                    })),
                  ].map((file) => (
                    <li
                      key={file.key}
                      className="flex items-center gap-3 rounded-lg border border-divider px-3 py-2 text-sm"
                    >
                      <FilePdf aria-hidden weight="fill" className="size-5 shrink-0 text-danger" />
                      <span className="min-w-0 flex-1 wrap-anywhere text-text">{file.name}</span>
                      <span className="text-muted">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          set(
                            file.kept
                              ? { kept: draft.kept.filter((row) => row.id !== file.key) }
                              : { files: draft.files.filter((row) => row.key !== file.key) },
                          )
                        }
                        className="inline-flex size-8 items-center justify-center rounded-md text-heading hover:bg-canvas"
                      >
                        <X aria-hidden weight="bold" className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        </form>

        <BillingCard
          title="Invoice Preview"
          titleSize="xl"
          className="min-w-0 xl:col-span-2"
          action={
            <button
              type="button"
              onClick={() => setPreview(true)}
              className="inline-flex items-center gap-2 text-base font-medium text-action hover:underline"
            >
              View Full Size
              <ArrowSquareOut aria-hidden weight="bold" className="size-5" />
            </button>
          }
        >
          <InvoiceDocument data={previewData} firm={firm} client={client} variant="preview" />
        </BillingCard>
      </div>

      <DocumentViewer
        open={preview}
        title={`Invoice ${draft.number || 'preview'}`}
        onClose={() => setPreview(false)}
      >
        <InvoiceDocument data={previewData} firm={firm} client={client} />
      </DocumentViewer>

      <Modal
        open={leaving}
        title="Discard changes?"
        onClose={() => setLeaving(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaving(false)}>
              Keep Editing
            </Button>
            <Button onClick={() => router.push(backHref)}>Discard Changes</Button>
          </>
        }
      >
        <p className="text-sm text-text">Your changes to this invoice have not been saved.</p>
      </Modal>

      <RecurringDrawer
        open={recurringFor !== null}
        lockClient
        defaults={
          recurringFor
            ? {
                clientId: recurringFor.saved.clientId,
                template:
                  recurringFor.saved.lines[0]?.description ??
                  `Invoice ${recurringFor.saved.number}`,
                description: recurringFor.saved.reference,
                amountCents: recurringFor.saved.totalCents,
                startDate: recurringFor.saved.issueDate,
                frequency: 'MONTHLY',
                nextInvoiceDate: nextOccurrence(recurringFor.saved.issueDate, 'MONTHLY', null),
                autoSend: draft.sendNow,
                allowOnlinePayment: recurringFor.saved.allowOnlinePayment,
                sourceInvoiceId: recurringFor.saved.id,
              }
            : undefined
        }
        onSaved={() => {
          scheduledRef.current = true;
          if (recurringFor) finish(recurringFor.saved, 'recurring');
        }}
        onClose={() => {
          // Cancel keeps the saved invoice without a schedule; Save already moved on.
          if (recurringFor && !scheduledRef.current) finish(recurringFor.saved, recurringFor.kind);
        }}
      />
    </div>
  );
}
