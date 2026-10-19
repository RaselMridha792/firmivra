'use client';

import { Button, Checkbox, FormField, Modal, Textarea } from '@firmivra/ui';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  adminBilling,
  REFUND_METHODS,
  type BillingCreditNote,
  type RefundMethod,
} from '../../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { inputClass, SelectControl } from '../../_components/billing-fields';
import { formatMoney, moneyInput, parseMoney } from '../../_components/billing-format';
import { BILLING_ERRORS, optionsOf, REFUND_METHOD_LABELS } from '../../_components/billing-labels';

/**
 * The credit note dialogs the shared Billing ones don't cover (docx §13.2, §16): Refund
 * Remaining Balance and Void. Apply to Invoice is the shared Apply Credit Note dialog.
 */

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

function Buttons({
  formId,
  label,
  pending,
  onClose,
}: {
  formId: string;
  label: string;
  pending: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex justify-end gap-3">
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" form={formId} disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Refund Remaining Balance
// ---------------------------------------------------------------------------------------------

/** Pays out the credit left on a note (all of it by default). */
export function RefundCreditModal({
  open,
  note,
  onClose,
  onRefunded,
}: {
  open: boolean;
  note: BillingCreditNote | null;
  onClose: () => void;
  onRefunded?: (note: BillingCreditNote) => void;
}) {
  const formId = useId();
  return (
    <Modal
      open={open}
      title="Refund Remaining Balance"
      subtitle="Return the credit left on this note to the customer. This can't be undone."
      onClose={onClose}
    >
      {open && note ? (
        <RefundCreditForm
          formId={formId}
          note={note}
          onClose={onClose}
          onRefunded={(saved) => {
            onRefunded?.(saved);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function RefundCreditForm({
  formId,
  note,
  onClose,
  onRefunded,
}: {
  formId: string;
  note: BillingCreditNote;
  onClose: () => void;
  onRefunded: (note: BillingCreditNote) => void;
}) {
  const [amount, setAmount] = useState(() => moneyInput(note.remainingCents));
  const [method, setMethod] = useState<RefundMethod>('ORIGINAL');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const settings = useApiQuery(['admin-billing', 'settings'], () => adminBilling.settings());
  const refund = useApiMutation(
    (input: { amountCents: number; reason: string; method: RefundMethod }) =>
      adminBilling.refundCreditNote(note.id, input),
    { invalidate: ['admin-billing'] },
  );
  const reasonRequired = settings.data?.payments.requireRefundReason ?? true;
  const cents = parseMoney(amount);
  const c = note.currency;

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<string, string>> = {};
    if (cents === null || cents <= 0) next['amount'] = 'Enter an amount above 0';
    else if (cents > note.remainingCents)
      next['amount'] = `Enter at most ${formatMoney(note.remainingCents, c)}`;
    if (reasonRequired && !reason.trim()) next['reason'] = 'Enter a reason for the refund';
    if (!confirmed) next['confirmed'] = 'Tick the box to confirm the refund';
    setErrors(next);
    if (Object.keys(next).length || cents === null) return;
    refund.mutate({ amountCents: cents, reason, method }, { onSuccess: onRefunded });
  }

  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
      <Summary
        rows={[
          ['Credit Note', note.number],
          ['Customer', note.clientName],
          ['Remaining Credit', formatMoney(note.remainingCents, c)],
        ]}
      />
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
            value={amount}
            placeholder="0.00"
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={Boolean(errors['amount']) || undefined}
            className={inputClass(Boolean(errors['amount']))}
          />
        </FormField>
        <FormField label="Refund Method" htmlFor={`${formId}-method`} required>
          <SelectControl
            id={`${formId}-method`}
            value={method}
            options={optionsOf(REFUND_METHODS, REFUND_METHOD_LABELS)}
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
          placeholder="e.g. Customer asked for the balance back"
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(errors['reason']) || undefined}
          className={inputClass(Boolean(errors['reason']))}
        />
      </FormField>
      <Summary
        rows={[
          [
            'Credit Left After Refund',
            formatMoney(Math.max(0, note.remainingCents - (cents ?? 0)), c),
          ],
        ]}
      />
      <div>
        <Checkbox
          label={`I confirm the refund of ${formatMoney(cents ?? 0, c)} to ${note.clientName}.`}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {errors['confirmed'] ? <p className="text-xs text-danger">{errors['confirmed']}</p> : null}
      </div>
      <FormError error={refund.error} />
      <Buttons
        formId={formId}
        label="Confirm Refund"
        pending={refund.isPending}
        onClose={onClose}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------------------------

/** Void: states the effect, asks for the reason, keeps the number and history. */
export function VoidCreditModal({
  open,
  note,
  onClose,
  onVoided,
}: {
  open: boolean;
  note: BillingCreditNote | null;
  onClose: () => void;
  onVoided?: (note: BillingCreditNote) => void;
}) {
  const formId = useId();
  return (
    <Modal open={open} title="Void Credit Note" onClose={onClose}>
      {open && note ? (
        <VoidCreditForm
          formId={formId}
          note={note}
          onClose={onClose}
          onVoided={(saved) => {
            onVoided?.(saved);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function VoidCreditForm({
  formId,
  note,
  onClose,
  onVoided,
}: {
  formId: string;
  note: BillingCreditNote;
  onClose: () => void;
  onVoided: (note: BillingCreditNote) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const voidIt = useApiMutation(
    (text: string) => adminBilling.voidCreditNote(note.id, { reason: text }),
    { invalidate: ['admin-billing'] },
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
        Voiding {note.number} cancels its {formatMoney(note.totalCents, note.currency)} credit for{' '}
        {note.clientName}. Its number and history stay, and it can&apos;t be undone.
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
      <Buttons
        formId={formId}
        label="Void Credit Note"
        pending={voidIt.isPending}
        onClose={onClose}
      />
    </form>
  );
}
