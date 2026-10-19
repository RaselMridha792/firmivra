'use client';

import { Button, Checkbox, FormField, Modal, Skeleton } from '@firmivra/ui';
import { ArrowLeft, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  computeTotals,
  CREDIT_REASONS,
  creditNoteErrors,
  hasErrors,
  type BillingClient,
  type BillingFirm,
  type BillingItem,
  type BillingSettings,
  type CreditMethod,
  type CreditReason,
  type LineErrors,
  type SaveCreditNote,
} from '../../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { DateControl, inputClass, SelectControl } from '../../_components/billing-fields';
import {
  formatMoney,
  moneyInput,
  parseMoney,
  parseQuantity,
  todayIso,
} from '../../_components/billing-format';
import {
  BILLING_ERRORS,
  CREDIT_REASON_LABELS,
  INVOICE_STATUS_LABELS,
  optionsOf,
} from '../../_components/billing-labels';
import { QuietLine, quietErrorText } from '../../_components/billing-parts';
import { BillingHeader, type Crumb } from '../../_components/billing-shell';
import { adminBilling } from '../../_components/billing-api';

/**
 * Create Credit Note (credit-note-creation-dashboard.jpg, docx §14): the details, the credit as
 * line items or one adjustment amount with live totals (recalculated by the mock on save), the
 * credit option, and Save as Draft or Issue Credit Note. The number is generated on save.
 */

const CRUMBS: Crumb[] = [
  { label: 'Billing', href: '/billing' },
  { label: 'Credit Notes', href: '/billing/credit-notes' },
  { label: 'Create Credit Note' },
];
const SUBTITLE = 'Issue a credit note to a customer for a refund or account credit.';
const LIST = '/billing/credit-notes';

let lineSeq = 0;
/** A key for a new line (never an index). */
const newKey = () => {
  lineSeq += 1;
  return `credit-line-${lineSeq}`;
};

interface LineDraft {
  key: string;
  itemId: string;
  description: string;
  quantity: string;
  price: string;
  taxRateId: string;
}
interface Draft {
  clientId: string;
  invoiceId: string;
  date: string;
  reason: CreditReason | '';
  method: CreditMethod;
  lines: LineDraft[];
  adjustment: string;
  keepAvailable: boolean;
  internalNote: string;
  customerNote: string;
}

const blankLine = (): LineDraft => ({
  key: newKey(),
  itemId: '',
  description: '',
  quantity: '1',
  price: '',
  taxRateId: '',
});

const blankDraft = (): Draft => ({
  clientId: '',
  invoiceId: '',
  date: todayIso(),
  reason: '',
  method: 'LINE_ITEMS',
  lines: [blankLine()],
  adjustment: '',
  keepAvailable: true,
  internalNote: '',
  customerNote: '',
});

function bodyOf(
  draft: Draft,
  items: BillingItem[],
  reason: CreditReason,
  issue: boolean,
): SaveCreditNote {
  return {
    clientId: draft.clientId,
    invoiceId: draft.invoiceId || null,
    date: draft.date,
    reason,
    method: draft.method,
    lines: draft.lines.map((line) => ({
      item: items.find((item) => item.id === line.itemId)?.name ?? '',
      description: line.description,
      quantity: parseQuantity(line.quantity),
      unitPriceCents: line.price.trim() ? (parseMoney(line.price) ?? Number.NaN) : Number.NaN,
      taxRateId: line.taxRateId || null,
    })),
    adjustmentCents: draft.adjustment.trim()
      ? (parseMoney(draft.adjustment) ?? Number.NaN)
      : Number.NaN,
    keepAvailable: draft.keepAvailable,
    internalNote: draft.internalNote,
    customerNote: draft.customerNote,
    issue,
  };
}

/** What Cancel compares against to know whether anything was entered. */
const signature = (draft: Draft) =>
  JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, ...line }) => line) });

/** "1. Credit Note Details": the grey band over each part of the form. */
function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="rounded-lg bg-table-head px-4 py-3 text-lg font-bold text-heading">
      {children}
    </h2>
  );
}

/** The page's title row, the same while loading. */
function Header() {
  return (
    <BillingHeader
      title="Create Credit Note"
      subtitle={SUBTITLE}
      breadcrumbs={CRUMBS}
      actions={
        <Link
          href="/billing"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-divider bg-surface px-4 py-2 text-sm font-medium text-action hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-5" />
          Back to Billing
        </Link>
      }
    />
  );
}

/** Loads what the form needs; until then each part shows its frame with a skeleton. */
export function CreditNoteEditor() {
  const settings = useApiQuery(['admin-billing', 'settings'], () => adminBilling.settings());
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', 'all'], () => adminBilling.clients());
  const items = useApiQuery(['admin-billing', 'items'], () => adminBilling.items());
  if (settings.data && firms.data && clients.data && items.data)
    return (
      <CreditNoteForm
        settings={settings.data}
        firms={firms.data}
        clients={clients.data}
        items={items.data}
      />
    );
  const failed = settings.error ?? firms.error ?? clients.error ?? items.error;
  const body = failed ? (
    <QuietLine testId="form-error">{quietErrorText(failed)}</QuietLine>
  ) : (
    <div role="status" aria-label="Loading" className="grid gap-4 md:grid-cols-3">
      {['a', 'b', 'c'].map((key) => (
        <Skeleton key={key} className="h-11" />
      ))}
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Header />
      <div className="flex flex-col gap-6 rounded-xl bg-surface p-4 shadow-sm md:p-5">
        {[
          ['loading-details', '1. Credit Note Details'],
          ['loading-amount', '2. Credit Amount'],
          ['loading-options', '3. Credit Options'],
        ].map(([id = '', title]) => (
          <section key={id} aria-labelledby={id} className="flex flex-col gap-4">
            <SectionTitle id={id}>{title}</SectionTitle>
            {body}
          </section>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" disabled>
          Cancel
        </Button>
        <Button variant="outline" disabled>
          Save as Draft
        </Button>
        <Button disabled>Issue Credit Note</Button>
      </div>
    </div>
  );
}

/** One of the two "Credit Amount" choices: a bordered card with a radio, title and help. */
function MethodCard({
  value,
  checked,
  title,
  text,
  onPick,
}: {
  value: CreditMethod;
  checked: boolean;
  title: string;
  text: string;
  onPick: (value: CreditMethod) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 focus-within:outline-2 focus-within:outline-focus ${checked ? 'border-action bg-info-soft' : 'border-divider bg-surface hover:bg-canvas'}`}
    >
      <input
        type="radio"
        name="credit-method"
        value={value}
        checked={checked}
        onChange={() => onPick(value)}
        className="size-5 shrink-0 accent-action"
      />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-heading">{title}</span>
        <span className="text-sm text-muted">{text}</span>
      </span>
    </label>
  );
}

function CreditNoteForm({
  settings,
  firms,
  clients,
  items,
}: {
  settings: BillingSettings;
  firms: BillingFirm[];
  clients: BillingClient[];
  items: BillingItem[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [baseline] = useState(() => signature(draft));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([]);
  const [leaving, setLeaving] = useState(false);
  const invoices = useApiQuery(
    ['admin-billing', 'credit-invoices', draft.clientId || 'none'],
    () =>
      draft.clientId
        ? adminBilling
            .invoices({ clientId: draft.clientId, pageSize: 100 })
            .then((page) =>
              page.items.filter((row) => row.status !== 'DRAFT' && row.status !== 'VOIDED'),
            )
        : Promise.resolve([]),
  );
  const save = useApiMutation((body: SaveCreditNote) => adminBilling.createCreditNote(body), {
    invalidate: ['admin-billing'],
  });

  const set = (patch: Partial<Draft>) => setDraft((now) => ({ ...now, ...patch }));
  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setDraft((now) => ({
      ...now,
      lines: now.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));

  const firmName = (id: string) => firms.find((firm) => firm.id === id)?.name ?? '';
  const active = new Set(firms.filter((firm) => firm.status === 'ACTIVE').map((firm) => firm.id));
  const customerOptions = clients
    .filter((client) => active.has(client.firmId))
    .map((client) => ({ value: client.id, label: `${client.name} (${firmName(client.firmId)})` }));
  const client = clients.find((row) => row.id === draft.clientId) ?? null;
  const invoice = (invoices.data ?? []).find((row) => row.id === draft.invoiceId) ?? null;
  const currency =
    invoice?.currency ??
    firms.find((firm) => firm.id === client?.firmId)?.currency ??
    settings.general.currency;
  const rates = settings.taxes.rates;
  const percentOf = (taxRateId: string) =>
    rates.find((rate) => rate.id === taxRateId)?.ratePercent ?? 0;
  const lineTotals = computeTotals(
    draft.lines.map((line) => ({
      quantity: parseQuantity(line.quantity) || 0,
      rateCents: parseMoney(line.price) ?? 0,
      taxPercent: percentOf(line.taxRateId),
    })),
  );
  const adjustmentCents = parseMoney(draft.adjustment) ?? 0;
  const totals =
    draft.method === 'ADJUSTMENT'
      ? { subtotalCents: adjustmentCents, taxCents: 0, totalCents: adjustmentCents }
      : lineTotals;
  const dirty = signature(draft) !== baseline;
  const disabled = !settings.general.enableCreditNotes;

  function submit(issue: boolean) {
    const reason = CREDIT_REASONS.find((value) => value === draft.reason);
    const body = bodyOf(draft, items, reason ?? 'OTHER', issue);
    const found = creditNoteErrors(body);
    const fields = { ...found.fields, ...(reason ? {} : { reason: 'Select a reason' }) };
    setFieldErrors(fields);
    setLineErrors(found.lines);
    if (hasErrors({ fields, lines: found.lines })) return;
    save.mutate(body, {
      onSuccess: (saved) =>
        router.push(`${LIST}?note=${saved.id}&saved=${issue ? 'issued' : 'draft'}`),
    });
  }

  function pickItem(line: LineDraft, itemId: string) {
    const item = items.find((row) => row.id === itemId);
    setLine(line.key, {
      itemId,
      ...(item
        ? {
            description: line.description.trim() ? line.description : item.description,
            price: moneyInput(item.unitPriceCents),
          }
        : {}),
    });
  }

  const rateOptions = [
    { value: '', label: 'No Tax' },
    ...rates.map((rate) => ({ value: rate.id, label: `${rate.name} (${rate.ratePercent}%)` })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Header />
      {disabled ? (
        <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-text">
          Credit notes are turned off in Billing Settings, so a new one can&apos;t be saved.
        </p>
      ) : null}

      <form
        id="credit-note-form"
        noValidate
        onSubmit={(event) => event.preventDefault()}
        aria-label="Create credit note"
        className="flex min-w-0 flex-col gap-6 rounded-xl bg-surface p-4 shadow-sm md:p-5"
      >
        <section aria-labelledby="credit-details-title" className="flex flex-col gap-4">
          <SectionTitle id="credit-details-title">1. Credit Note Details</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormField
              label="Customer"
              htmlFor="credit-customer"
              required
              error={fieldErrors['clientId']}
            >
              <SelectControl
                id="credit-customer"
                value={draft.clientId}
                placeholder="Select a customer"
                invalid={Boolean(fieldErrors['clientId'])}
                options={customerOptions}
                onChange={(event) => set({ clientId: event.target.value, invoiceId: '' })}
              />
            </FormField>
            <FormField
              label="Related Invoice (Optional)"
              htmlFor="credit-invoice"
              hint={
                draft.clientId && invoices.data?.length === 0
                  ? 'This customer has no issued invoices.'
                  : undefined
              }
            >
              <SelectControl
                id="credit-invoice"
                value={draft.invoiceId}
                disabled={!draft.clientId}
                placeholder="Select an invoice"
                options={(invoices.data ?? []).map((row) => ({
                  value: row.id,
                  label: `${row.number} · ${formatMoney(row.totalCents, row.currency)} · ${INVOICE_STATUS_LABELS[row.status]}`,
                }))}
                onChange={(event) => set({ invoiceId: event.target.value })}
              />
            </FormField>
            <FormField
              label="Credit Note Date"
              htmlFor="credit-date"
              required
              error={fieldErrors['date']}
            >
              <DateControl
                id="credit-date"
                value={draft.date}
                invalid={Boolean(fieldErrors['date'])}
                onChange={(event) => set({ date: event.target.value })}
              />
            </FormField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Reason for Credit"
              htmlFor="credit-reason"
              required
              error={fieldErrors['reason']}
            >
              <SelectControl
                id="credit-reason"
                value={draft.reason}
                placeholder="Select a reason"
                invalid={Boolean(fieldErrors['reason'])}
                options={optionsOf(CREDIT_REASONS, CREDIT_REASON_LABELS)}
                onChange={(event) =>
                  set({
                    reason: CREDIT_REASONS.find((value) => value === event.target.value) ?? '',
                  })
                }
              />
            </FormField>
            <FormField label="Reference / Credit Note Number" htmlFor="credit-number">
              <input
                id="credit-number"
                readOnly
                value=""
                placeholder="Will be generated automatically"
                className={inputClass()}
              />
            </FormField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Internal Note (Optional)"
              htmlFor="credit-internal"
              error={fieldErrors['internalNote']}
            >
              <textarea
                id="credit-internal"
                rows={3}
                maxLength={1000}
                value={draft.internalNote}
                placeholder="Notes for your team (not visible to customer)"
                onChange={(event) => set({ internalNote: event.target.value })}
                className={inputClass(Boolean(fieldErrors['internalNote']))}
              />
            </FormField>
            <FormField
              label="Customer Note (Optional)"
              htmlFor="credit-customer-note"
              error={fieldErrors['customerNote']}
            >
              <textarea
                id="credit-customer-note"
                rows={3}
                maxLength={1000}
                value={draft.customerNote}
                placeholder="Message to show on the credit note"
                onChange={(event) => set({ customerNote: event.target.value })}
                className={inputClass(Boolean(fieldErrors['customerNote']))}
              />
            </FormField>
          </div>
        </section>

        <section aria-labelledby="credit-amount-title" className="flex flex-col gap-4">
          <SectionTitle id="credit-amount-title">2. Credit Amount</SectionTitle>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2 lg:w-2/3">
              <legend className="sr-only">How to enter the credit</legend>
              <MethodCard
                value="LINE_ITEMS"
                checked={draft.method === 'LINE_ITEMS'}
                title="Line Items"
                text="Add specific items or services"
                onPick={(method) => set({ method })}
              />
              <MethodCard
                value="ADJUSTMENT"
                checked={draft.method === 'ADJUSTMENT'}
                title="Adjustment Amount"
                text="Enter a single credit amount"
                onPick={(method) => set({ method })}
              />
            </fieldset>
            {draft.method === 'LINE_ITEMS' ? (
              <Button
                variant="outline"
                className="lg:ml-auto"
                onClick={() => set({ lines: [...draft.lines, blankLine()] })}
              >
                <Plus aria-hidden weight="bold" className="size-5" />
                Add Line Item
              </Button>
            ) : null}
          </div>
          {fieldErrors['lines'] ? (
            <p className="text-sm text-danger">{fieldErrors['lines']}</p>
          ) : null}

          {draft.method === 'LINE_ITEMS' ? (
            <div className="rounded-lg border border-divider">
              <div
                aria-hidden
                className="hidden gap-3 rounded-t-lg bg-table-head px-3 py-3 text-sm font-semibold text-heading md:grid md:grid-cols-24"
              >
                <span className="col-span-5">Item / Service</span>
                <span className="col-span-7">Description</span>
                <span className="col-span-2">Quantity</span>
                <span className="col-span-3">Unit Price</span>
                <span className="col-span-3">Tax</span>
                <span className="col-span-3">Amount</span>
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
                      data-testid="credit-line"
                      className="flex flex-col gap-1 p-3"
                    >
                      <div className="grid grid-cols-2 items-center gap-3 md:grid-cols-24">
                        <div className="col-span-2 md:col-span-5">
                          <SelectControl
                            aria-label={`Item / Service, line ${n}`}
                            value={line.itemId}
                            placeholder="Select an item"
                            options={items.map((item) => ({ value: item.id, label: item.name }))}
                            onChange={(event) => pickItem(line, event.target.value)}
                          />
                        </div>
                        <input
                          aria-label={`Description, line ${n}`}
                          value={line.description}
                          maxLength={200}
                          placeholder="Enter description"
                          aria-invalid={Boolean(errors.description) || undefined}
                          onChange={(event) =>
                            setLine(line.key, { description: event.target.value })
                          }
                          className={`${inputClass(Boolean(errors.description))} col-span-2 md:col-span-7`}
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
                          aria-label={`Unit price, line ${n}`}
                          inputMode="decimal"
                          value={line.price}
                          placeholder="$0.00"
                          aria-invalid={Boolean(errors.rate) || undefined}
                          onChange={(event) => setLine(line.key, { price: event.target.value })}
                          className={`${inputClass(Boolean(errors.rate))} md:col-span-3`}
                        />
                        <div className="md:col-span-3">
                          <SelectControl
                            aria-label={`Tax, line ${n}`}
                            value={line.taxRateId}
                            options={rateOptions}
                            onChange={(event) =>
                              setLine(line.key, { taxRateId: event.target.value })
                            }
                          />
                        </div>
                        <div className="flex items-center gap-2 md:col-span-3">
                          <output
                            aria-label={`Amount, line ${n}`}
                            data-testid="line-amount"
                            className="flex min-h-11 min-w-0 flex-1 items-center justify-end rounded-control border border-border bg-surface px-3 text-base text-muted"
                          >
                            {formatMoney(lineTotals.lines[index]?.amountCents ?? 0, currency)}
                          </output>
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
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-divider text-heading hover:bg-canvas disabled:cursor-not-allowed disabled:text-disabled-text"
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
          ) : (
            <FormField
              label="Credit Amount"
              htmlFor="credit-adjustment"
              required
              error={fieldErrors['adjustmentCents']}
            >
              <div className="relative max-w-xs">
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text"
                >
                  $
                </span>
                <input
                  id="credit-adjustment"
                  inputMode="decimal"
                  value={draft.adjustment}
                  placeholder="0.00"
                  aria-invalid={Boolean(fieldErrors['adjustmentCents']) || undefined}
                  onChange={(event) => set({ adjustment: event.target.value })}
                  className={`${inputClass(Boolean(fieldErrors['adjustmentCents']))} pl-7`}
                />
              </div>
            </FormField>
          )}

          <dl
            data-testid="credit-totals"
            className="flex flex-col rounded-lg border border-divider text-base"
          >
            <div className="flex justify-end gap-6 px-4 py-2 md:gap-16">
              <dt className="text-text">Subtotal</dt>
              <dd className="w-28 text-right text-heading">
                {formatMoney(totals.subtotalCents, currency)}
              </dd>
            </div>
            <div className="flex justify-end gap-6 px-4 py-2 md:gap-16">
              <dt className="text-text">Tax</dt>
              <dd className="w-28 text-right text-heading">
                {formatMoney(totals.taxCents, currency)}
              </dd>
            </div>
            <div className="flex justify-end gap-6 rounded-b-lg bg-info-soft px-4 py-3 font-bold text-action md:gap-16">
              <dt>Total Credit Amount</dt>
              <dd data-testid="credit-total" className="w-28 text-right">
                {formatMoney(totals.totalCents, currency)}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="credit-options-title" className="flex flex-col gap-3">
          <SectionTitle id="credit-options-title">3. Credit Options</SectionTitle>
          <div className="px-1">
            <Checkbox
              label="Keep remaining credit available on customer account"
              checked={draft.keepAvailable}
              onChange={(event) => set({ keepAvailable: event.target.checked })}
            />
            <p className="pl-8 text-sm text-muted">
              If not selected, the credit will be marked as refunded or closed after applying.
              {draft.keepAvailable
                ? ''
                : invoice
                  ? ` On issue it is applied to ${invoice.number} and any rest is refunded.`
                  : ' On issue the whole credit is refunded.'}
            </p>
          </div>
        </section>
      </form>

      {save.error ? (
        <p
          role="alert"
          data-testid="save-error"
          className="rounded-lg bg-danger-soft p-3 text-sm text-danger"
        >
          {errorMessage(save.error, BILLING_ERRORS)}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-divider bg-canvas py-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => (dirty ? setLeaving(true) : router.push(LIST))}>
          Cancel
        </Button>
        <Button
          variant="outline"
          disabled={save.isPending || disabled}
          onClick={() => submit(false)}
        >
          Save as Draft
        </Button>
        <Button disabled={save.isPending || disabled} onClick={() => submit(true)}>
          {save.isPending ? 'Saving…' : 'Issue Credit Note'}
        </Button>
      </div>

      <Modal
        open={leaving}
        title="Discard this credit note?"
        onClose={() => setLeaving(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaving(false)}>
              Keep Editing
            </Button>
            <Button onClick={() => router.push(LIST)}>Discard</Button>
          </>
        }
      >
        <p className="text-sm text-text">What you entered has not been saved.</p>
      </Modal>
    </div>
  );
}
