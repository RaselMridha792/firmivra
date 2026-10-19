'use client';

import { Button, Checkbox, FormField, Modal, Radio, Textarea, Toggle } from '@firmivra/ui';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  adminBilling,
  REFUND_METHODS,
  type BillingCreditNote,
  type BillingInvoice,
  type BillingPayment,
  type PaymentMethod,
  type RefundMethod,
} from '../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { DateControl, inputClass, SelectControl } from './billing-fields';
import { formatDate, formatMoney, moneyInput, parseMoney, todayIso } from './billing-format';
import {
  BILLING_ERRORS,
  CREDIT_NOTE_STATUS_LABELS,
  optionsOf,
  PAYMENT_METHOD_LABELS,
  REFUND_METHOD_LABELS,
} from './billing-labels';
import { quietErrorText } from './billing-parts';

/**
 * The supporting Billing dialogs (docx §16–17), reused wherever their action appears:
 * Record Payment, Issue Refund, Apply Credit Note and Void Invoice. Each is a kit Modal whose
 * form resets every time it opens; every change goes through the mock and refreshes all
 * ['admin-billing'] queries.
 */

const OPEN_STATUSES: BillingInvoice['status'][] = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];
/** True when an invoice can take a payment or a credit. */
export const isOpenInvoice = (invoice: Pick<BillingInvoice, 'status' | 'balanceCents'>) =>
  OPEN_STATUSES.includes(invoice.status) && invoice.balanceCents > 0;

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
      {errorMessage(error, BILLING_ERRORS)}
    </p>
  );
}

function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col gap-1 rounded-lg bg-canvas p-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-muted">{label}</dt>
          <dd className="font-semibold text-heading">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Footer({
  formId,
  label,
  pending,
  disabled,
  onClose,
}: {
  formId: string;
  label: string;
  pending: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" form={formId} disabled={pending || disabled}>
        {pending ? 'Saving…' : label}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Record Payment (docx §17.1)
// ---------------------------------------------------------------------------------------------

/**
 * Record Payment. With `invoiceId` the firm, client and invoice are fixed (Invoice Details, a
 * row's menu); without it the user picks them (Payments' "Record Payment").
 */
export function RecordPaymentModal({
  open,
  invoiceId,
  onClose,
  onRecorded,
}: {
  open: boolean;
  invoiceId?: string | null;
  onClose: () => void;
  onRecorded?: (payment: BillingPayment) => void;
}) {
  const formId = useId();
  return (
    <Modal
      open={open}
      title="Record Payment"
      subtitle="Record money received against an invoice. The invoice balance updates on save."
      onClose={onClose}
    >
      {open ? (
        <RecordPaymentForm
          formId={formId}
          fixedInvoiceId={invoiceId ?? null}
          onClose={onClose}
          onRecorded={(payment) => {
            onRecorded?.(payment);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function RecordPaymentForm({
  formId,
  fixedInvoiceId,
  onClose,
  onRecorded,
}: {
  formId: string;
  fixedInvoiceId: string | null;
  onClose: () => void;
  onRecorded: (payment: BillingPayment) => void;
}) {
  const [firmId, setFirmId] = useState('');
  const [clientId, setClientId] = useState('');
  const [pickedInvoice, setPickedInvoice] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso);
  const [method, setMethod] = useState<PaymentMethod>('CREDIT_CARD');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const settings = useApiQuery(['admin-billing', 'settings'], () => adminBilling.settings());
  const fixed = useApiQuery(['admin-billing', 'invoice', fixedInvoiceId ?? 'none'], () =>
    fixedInvoiceId ? adminBilling.invoice(fixedInvoiceId) : Promise.resolve(null),
  );
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', firmId || 'none'], () =>
    firmId ? adminBilling.clients({ firmId }) : Promise.resolve([]),
  );
  const openInvoices = useApiQuery(['admin-billing', 'open-invoices', clientId], () =>
    clientId
      ? adminBilling
          .invoices({ clientId, pageSize: 100 })
          .then((page) => page.items.filter(isOpenInvoice))
      : Promise.resolve([]),
  );
  const invoice: BillingInvoice | null = fixedInvoiceId
    ? (fixed.data ?? null)
    : (openInvoices.data?.find((row) => row.id === pickedInvoice) ?? null);
  const record = useApiMutation(
    (input: Parameters<typeof adminBilling.recordPayment>[0]) => adminBilling.recordPayment(input),
    { invalidate: ['admin-billing'] },
  );
  const methods = settings.data?.payments.methods ?? [];
  const cents = parseMoney(amount);
  const balance = invoice?.balanceCents ?? 0;
  const currency = invoice?.currency ?? 'USD';

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<string, string>> = {};
    if (!invoice) next['invoice'] = 'Select an invoice with a balance';
    if (cents === null || cents <= 0) next['amount'] = 'Enter an amount above 0';
    else if (invoice && cents > balance && !settings.data?.payments.allowOverpayments)
      next['amount'] = `Enter at most ${formatMoney(balance, currency)}`;
    if (!paidOn || paidOn > todayIso()) next['paidOn'] = 'Enter a date that is not in the future';
    setErrors(next);
    if (Object.keys(next).length || !invoice || cents === null) return;
    record.mutate(
      {
        invoiceId: invoice.id,
        amountCents: cents,
        paidOn,
        method: methods.includes(method) ? method : (methods[0] ?? method),
        reference,
        notes,
        sendReceipt,
      },
      { onSuccess: onRecorded },
    );
  }

  const loadError = settings.error ?? fixed.error ?? firms.error;
  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
      {loadError ? <p className="text-sm text-muted">{quietErrorText(loadError)}</p> : null}
      {fixedInvoiceId ? (
        <Summary
          rows={[
            ['Firm', invoice?.firmName ?? '…'],
            ['Client', invoice?.clientName ?? '…'],
            ['Invoice', invoice ? `${invoice.number} · due ${formatDate(invoice.dueDate)}` : '…'],
          ]}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Firm" htmlFor={`${formId}-firm`} required>
            <SelectControl
              id={`${formId}-firm`}
              value={firmId}
              placeholder="Select a firm..."
              options={(firms.data ?? []).map((firm) => ({ value: firm.id, label: firm.name }))}
              onChange={(event) => {
                setFirmId(event.target.value);
                setClientId('');
                setPickedInvoice('');
              }}
            />
          </FormField>
          <FormField label="Client" htmlFor={`${formId}-client`} required>
            <SelectControl
              id={`${formId}-client`}
              value={clientId}
              disabled={!firmId}
              placeholder="Select a client..."
              options={(clients.data ?? []).map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              onChange={(event) => {
                setClientId(event.target.value);
                setPickedInvoice('');
              }}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              label="Invoice"
              htmlFor={`${formId}-invoice`}
              required
              error={errors['invoice']}
              hint={
                clientId && openInvoices.data?.length === 0
                  ? 'This client has no open invoices.'
                  : undefined
              }
            >
              <SelectControl
                id={`${formId}-invoice`}
                value={pickedInvoice}
                disabled={!clientId}
                invalid={Boolean(errors['invoice'])}
                placeholder="Select an invoice..."
                options={(openInvoices.data ?? []).map((row) => ({
                  value: row.id,
                  label: `${row.number} · ${formatMoney(row.balanceCents, row.currency)} due`,
                }))}
                onChange={(event) => setPickedInvoice(event.target.value)}
              />
            </FormField>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Payment Amount"
          htmlFor={`${formId}-amount`}
          required
          error={errors['amount']}
        >
          <input
            id={`${formId}-amount`}
            inputMode="decimal"
            value={amount}
            placeholder={invoice ? moneyInput(balance) : '0.00'}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={Boolean(errors['amount']) || undefined}
            className={inputClass(Boolean(errors['amount']))}
          />
        </FormField>
        <FormField
          label="Payment Date"
          htmlFor={`${formId}-date`}
          required
          error={errors['paidOn']}
        >
          <DateControl
            id={`${formId}-date`}
            value={paidOn}
            max={todayIso()}
            invalid={Boolean(errors['paidOn'])}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </FormField>
        <FormField label="Payment Method" htmlFor={`${formId}-method`} required>
          <SelectControl
            id={`${formId}-method`}
            value={method}
            options={optionsOf(methods, PAYMENT_METHOD_LABELS)}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          />
        </FormField>
        <FormField label="Transaction / Reference ID" htmlFor={`${formId}-reference`}>
          <input
            id={`${formId}-reference`}
            value={reference}
            maxLength={100}
            placeholder="e.g. check number"
            onChange={(event) => setReference(event.target.value)}
            className={inputClass()}
          />
        </FormField>
      </div>
      <Textarea
        label="Notes"
        rows={2}
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div className="flex items-center justify-between gap-4">
        <span id={`${formId}-receipt`} className="text-sm font-medium text-text">
          Send receipt to the client
        </span>
        <Toggle
          checked={sendReceipt}
          onChange={setSendReceipt}
          label="Send receipt to the client"
        />
      </div>
      <Summary
        rows={[
          ['Outstanding Balance', formatMoney(balance, currency)],
          ['Remaining Balance', formatMoney(Math.max(0, balance - (cents ?? 0)), currency)],
        ]}
      />
      <FormError error={record.error} />
      <div className="flex justify-end gap-3">
        <Footer
          formId={formId}
          label="Record Payment"
          pending={record.isPending}
          disabled={
            settings.isLoading || Boolean(loadError) || (fixedInvoiceId !== null && !invoice)
          }
          onClose={onClose}
        />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Issue Refund (docx §17.2)
// ---------------------------------------------------------------------------------------------

/** Issue Refund: for one payment (`paymentId`), or one of an invoice's refundable payments. */
export function RefundModal({
  open,
  paymentId,
  invoiceId,
  onClose,
  onRefunded,
}: {
  open: boolean;
  paymentId?: string | null;
  invoiceId?: string | null;
  onClose: () => void;
  onRefunded?: (payment: BillingPayment) => void;
}) {
  const formId = useId();
  return (
    <Modal
      open={open}
      title="Issue Refund"
      subtitle="Return money from a completed payment. This can't be undone."
      onClose={onClose}
    >
      {open ? (
        <RefundForm
          formId={formId}
          paymentId={paymentId ?? null}
          invoiceId={invoiceId ?? null}
          onClose={onClose}
          onRefunded={(payment) => {
            onRefunded?.(payment);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function RefundForm({
  formId,
  paymentId,
  invoiceId,
  onClose,
  onRefunded,
}: {
  formId: string;
  paymentId: string | null;
  invoiceId: string | null;
  onClose: () => void;
  onRefunded: (payment: BillingPayment) => void;
}) {
  const [picked, setPicked] = useState(paymentId ?? '');
  const [type, setType] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<RefundMethod>('ORIGINAL');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const payments = useApiQuery(
    ['admin-billing', 'refundable', paymentId ?? '', invoiceId ?? ''],
    async () => {
      if (paymentId) return [await adminBilling.payment(paymentId)];
      if (invoiceId) return (await adminBilling.invoice(invoiceId)).payments;
      return [];
    },
  );
  const settings = useApiQuery(['admin-billing', 'settings'], () => adminBilling.settings());
  const refundable = (payments.data ?? []).filter((row) => row.refundableCents > 0);
  const payment =
    refundable.find((row) => row.id === picked) ??
    (refundable.length === 1 ? refundable[0] : undefined);
  const refund = useApiMutation(
    (input: Parameters<typeof adminBilling.refundPayment>[0]) => adminBilling.refundPayment(input),
    { invalidate: ['admin-billing'] },
  );
  const max = payment?.refundableCents ?? 0;
  const currency = payment?.currency ?? 'USD';
  const cents = type === 'FULL' ? max : parseMoney(amount);
  const reasonRequired = settings.data?.payments.requireRefundReason ?? true;

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<string, string>> = {};
    if (!payment) next['payment'] = 'Select the payment to refund';
    if (cents === null || cents <= 0) next['amount'] = 'Enter an amount above 0';
    else if (cents > max) next['amount'] = `Enter at most ${formatMoney(max, currency)}`;
    if (reasonRequired && !reason.trim()) next['reason'] = 'Enter a reason for the refund';
    if (!confirmed) next['confirmed'] = 'Tick the box to confirm the refund';
    setErrors(next);
    if (Object.keys(next).length || !payment || cents === null) return;
    refund.mutate(
      { paymentId: payment.id, type, amountCents: cents, reason, notes, method, confirmed },
      { onSuccess: onRefunded },
    );
  }

  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
      {payments.error ? (
        <p className="text-sm text-muted">{quietErrorText(payments.error)}</p>
      ) : null}
      {!payments.isLoading && refundable.length === 0 ? (
        <p className="text-sm text-muted">There is no completed payment left to refund.</p>
      ) : null}
      <FormField
        label="Original Payment"
        htmlFor={`${formId}-payment`}
        required
        error={errors['payment']}
      >
        <SelectControl
          id={`${formId}-payment`}
          value={payment?.id ?? ''}
          disabled={Boolean(paymentId) || refundable.length === 0}
          placeholder={refundable.length === 1 ? undefined : 'Select a payment...'}
          options={refundable.map((row) => ({
            value: row.id,
            label: `${row.number} · ${formatDate(row.paidOn)} · ${PAYMENT_METHOD_LABELS[row.method]} · ${formatMoney(row.refundableCents, row.currency)} refundable`,
          }))}
          onChange={(event) => setPicked(event.target.value)}
        />
      </FormField>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-text">Refund Type</legend>
        <div className="flex flex-wrap gap-6">
          <Radio
            name={`${formId}-type`}
            label="Full refund"
            checked={type === 'FULL'}
            onChange={() => setType('FULL')}
          />
          <Radio
            name={`${formId}-type`}
            label="Partial refund"
            checked={type === 'PARTIAL'}
            onChange={() => setType('PARTIAL')}
          />
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Refund Amount"
          htmlFor={`${formId}-amount`}
          required
          error={errors['amount']}
        >
          <input
            id={`${formId}-amount`}
            inputMode="decimal"
            value={type === 'FULL' ? moneyInput(max) : amount}
            readOnly={type === 'FULL'}
            placeholder="0.00"
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={Boolean(errors['amount']) || undefined}
            className={inputClass(Boolean(errors['amount']))}
          />
        </FormField>
        <FormField label="Refund Method / Processor" htmlFor={`${formId}-method`} required>
          <SelectControl
            id={`${formId}-method`}
            value={method}
            options={optionsOf(REFUND_METHODS, {
              ...REFUND_METHOD_LABELS,
              ORIGINAL: payment
                ? `Original method (${payment.processor})`
                : REFUND_METHOD_LABELS.ORIGINAL,
            })}
            onChange={(event) => setMethod(event.target.value as RefundMethod)}
          />
        </FormField>
      </div>
      <FormField
        label="Refund Reason"
        htmlFor={`${formId}-reason`}
        required={reasonRequired}
        error={errors['reason']}
      >
        <input
          id={`${formId}-reason`}
          value={reason}
          maxLength={300}
          placeholder="e.g. Service canceled by the client"
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(errors['reason']) || undefined}
          className={inputClass(Boolean(errors['reason']))}
        />
      </FormField>
      <Textarea
        label="Internal Notes"
        rows={2}
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div>
        <Checkbox
          label={`I confirm the refund of ${formatMoney(cents ?? 0, currency)} to the client.`}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {errors['confirmed'] ? <p className="text-xs text-danger">{errors['confirmed']}</p> : null}
      </div>
      <FormError error={refund.error} />
      <div className="flex justify-end gap-3">
        <Footer
          formId={formId}
          label="Confirm Refund"
          pending={refund.isPending}
          disabled={refundable.length === 0}
          onClose={onClose}
        />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Apply Credit Note (docx §17.3)
// ---------------------------------------------------------------------------------------------

/**
 * Apply Credit Note. From an invoice (`invoiceId`: pick one of the client's credits) or from a
 * credit note (`creditNoteId`: pick one of the customer's open invoices).
 */
export function ApplyCreditModal({
  open,
  invoiceId,
  creditNoteId,
  onClose,
  onApplied,
}: {
  open: boolean;
  invoiceId?: string | null;
  creditNoteId?: string | null;
  onClose: () => void;
  onApplied?: (note: BillingCreditNote) => void;
}) {
  const formId = useId();
  return (
    <Modal
      open={open}
      title="Apply Credit Note"
      subtitle="Use a customer's available credit to lower an invoice's balance."
      onClose={onClose}
    >
      {open ? (
        <ApplyCreditForm
          formId={formId}
          invoiceId={invoiceId ?? null}
          creditNoteId={creditNoteId ?? null}
          onClose={onClose}
          onApplied={(note) => {
            onApplied?.(note);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function ApplyCreditForm({
  formId,
  invoiceId,
  creditNoteId,
  onClose,
  onApplied,
}: {
  formId: string;
  invoiceId: string | null;
  creditNoteId: string | null;
  onClose: () => void;
  onApplied: (note: BillingCreditNote) => void;
}) {
  const [pickedNote, setPickedNote] = useState(creditNoteId ?? '');
  const [pickedInvoice, setPickedInvoice] = useState(invoiceId ?? '');
  const [amount, setAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const fixedInvoice = useApiQuery(['admin-billing', 'invoice', invoiceId ?? 'none'], () =>
    invoiceId ? adminBilling.invoice(invoiceId) : Promise.resolve(null),
  );
  const fixedNote = useApiQuery(['admin-billing', 'credit-note', creditNoteId ?? 'none'], () =>
    creditNoteId ? adminBilling.creditNote(creditNoteId) : Promise.resolve(null),
  );
  const clientId = fixedInvoice.data?.clientId ?? fixedNote.data?.clientId ?? '';
  const credits = useApiQuery(['admin-billing', 'available-credits', clientId], () =>
    clientId ? adminBilling.availableCredits(clientId) : Promise.resolve([]),
  );
  const invoices = useApiQuery(['admin-billing', 'open-invoices', clientId], () =>
    clientId
      ? adminBilling
          .invoices({ clientId, pageSize: 100 })
          .then((page) => page.items.filter(isOpenInvoice))
      : Promise.resolve([]),
  );
  const note = creditNoteId
    ? (fixedNote.data ?? null)
    : ((credits.data ?? []).find((row) => row.id === pickedNote) ?? null);
  const invoice: BillingInvoice | null = invoiceId
    ? (fixedInvoice.data ?? null)
    : ((invoices.data ?? []).find((row) => row.id === pickedInvoice) ?? null);
  const apply = useApiMutation(
    (input: Parameters<typeof adminBilling.applyCredit>[0]) => adminBilling.applyCredit(input),
    { invalidate: ['admin-billing'] },
  );
  const available = note?.remainingCents ?? 0;
  const balance = invoice?.balanceCents ?? 0;
  const suggested = Math.min(available, balance);
  const cents = amount.trim() ? parseMoney(amount) : suggested;
  const currency = invoice?.currency ?? note?.currency ?? 'USD';
  const customer = fixedInvoice.data?.clientName ?? fixedNote.data?.clientName ?? '…';

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<string, string>> = {};
    if (!note) next['note'] = 'Select a credit note';
    if (!invoice) next['invoice'] = 'Select an invoice';
    if (cents === null || cents <= 0) next['amount'] = 'Enter an amount above 0';
    else if (cents > available)
      next['amount'] = `The credit has ${formatMoney(available, currency)} left`;
    else if (cents > balance)
      next['amount'] = `The invoice balance is ${formatMoney(balance, currency)}`;
    if (!confirmed) next['confirmed'] = 'Tick the box to confirm';
    setErrors(next);
    if (Object.keys(next).length || !note || !invoice || cents === null) return;
    apply.mutate(
      { invoiceId: invoice.id, creditNoteId: note.id, amountCents: cents, confirmed },
      { onSuccess: onApplied },
    );
  }

  const loadError = fixedInvoice.error ?? fixedNote.error ?? credits.error;
  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
      {loadError ? <p className="text-sm text-muted">{quietErrorText(loadError)}</p> : null}
      <Summary rows={[['Customer', customer]]} />
      {invoiceId ? (
        <Summary
          rows={[
            ['Eligible Invoice', invoice?.number ?? '…'],
            ['Invoice Balance', formatMoney(balance, currency)],
          ]}
        />
      ) : (
        <FormField
          label="Eligible Invoice"
          htmlFor={`${formId}-invoice`}
          required
          error={errors['invoice']}
        >
          <SelectControl
            id={`${formId}-invoice`}
            value={pickedInvoice}
            placeholder="Select an invoice..."
            invalid={Boolean(errors['invoice'])}
            options={(invoices.data ?? []).map((row) => ({
              value: row.id,
              label: `${row.number} · ${formatMoney(row.balanceCents, row.currency)} due`,
            }))}
            onChange={(event) => setPickedInvoice(event.target.value)}
          />
        </FormField>
      )}
      {creditNoteId ? (
        <Summary rows={[['Selected Credit Note', note?.number ?? '…']]} />
      ) : (
        <FormField
          label="Available Credit Notes"
          htmlFor={`${formId}-note`}
          required
          error={errors['note']}
          hint={
            clientId && credits.data?.length === 0
              ? 'This customer has no available credit.'
              : undefined
          }
        >
          <SelectControl
            id={`${formId}-note`}
            value={pickedNote}
            placeholder="Select a credit note..."
            invalid={Boolean(errors['note'])}
            options={(credits.data ?? []).map((row) => ({
              value: row.id,
              label: `${row.number} · ${formatMoney(row.remainingCents, row.currency)} ${CREDIT_NOTE_STATUS_LABELS[row.status].toLowerCase()}`,
            }))}
            onChange={(event) => setPickedNote(event.target.value)}
          />
        </FormField>
      )}
      <FormField
        label="Amount to Apply"
        htmlFor={`${formId}-amount`}
        required
        error={errors['amount']}
      >
        <input
          id={`${formId}-amount`}
          inputMode="decimal"
          value={amount}
          placeholder={moneyInput(suggested)}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={Boolean(errors['amount']) || undefined}
          className={inputClass(Boolean(errors['amount']))}
        />
      </FormField>
      <Summary
        rows={[
          ['Available Credit', formatMoney(available, currency)],
          [
            'Remaining Credit After Application',
            formatMoney(Math.max(0, available - (cents ?? 0)), currency),
          ],
          ['Invoice Balance After', formatMoney(Math.max(0, balance - (cents ?? 0)), currency)],
        ]}
      />
      <div>
        <Checkbox
          label="I confirm applying this credit to the invoice."
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {errors['confirmed'] ? <p className="text-xs text-danger">{errors['confirmed']}</p> : null}
      </div>
      <FormError error={apply.error} />
      <div className="flex justify-end gap-3">
        <Footer formId={formId} label="Apply Credit" pending={apply.isPending} onClose={onClose} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Void Invoice
// ---------------------------------------------------------------------------------------------

/** Void Invoice: states the effect, asks for the reason, keeps the number and history. */
export function VoidInvoiceModal({
  open,
  invoice,
  onClose,
  onVoided,
}: {
  open: boolean;
  invoice: Pick<BillingInvoice, 'id' | 'number'> | null;
  onClose: () => void;
  onVoided?: () => void;
}) {
  const formId = useId();
  return (
    <Modal open={open} title="Void Invoice" onClose={onClose}>
      {open && invoice ? (
        <VoidForm
          formId={formId}
          invoice={invoice}
          onClose={onClose}
          onVoided={() => {
            onVoided?.();
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function VoidForm({
  formId,
  invoice,
  onClose,
  onVoided,
}: {
  formId: string;
  invoice: Pick<BillingInvoice, 'id' | 'number'>;
  onClose: () => void;
  onVoided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const voidIt = useApiMutation(
    (text: string) => adminBilling.voidInvoice(invoice.id, { reason: text }),
    {
      invalidate: ['admin-billing'],
    },
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setError('Enter a reason for voiding');
      return;
    }
    setError('');
    voidIt.mutate(reason, { onSuccess: onVoided });
  }
  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-text">
        Voiding {invoice.number} cancels it for the client. Its number and history stay, and it
        can&apos;t be undone.
      </p>
      <Textarea
        label="Reason for voiding"
        rows={3}
        maxLength={500}
        value={reason}
        error={error || undefined}
        onChange={(event) => setReason(event.target.value)}
      />
      <FormError error={voidIt.error} />
      <div className="flex justify-end gap-3">
        <Footer formId={formId} label="Void Invoice" pending={voidIt.isPending} onClose={onClose} />
      </div>
    </form>
  );
}
