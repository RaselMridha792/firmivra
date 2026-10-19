'use client';

import { Button, Checkbox, Drawer, FormField, Toggle } from '@firmivra/ui';
import { useId, useState, type FormEvent } from 'react';
import {
  hasErrors,
  nextOccurrence,
  RECURRING_FREQUENCIES,
  RECURRING_STATUSES,
  recurringErrors,
  type BillingRecurring,
  type RecurringFrequency,
  type RecurringStatus,
  type SaveRecurring,
} from '../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { DateControl, inputClass, SelectControl } from './billing-fields';
import { moneyInput, parseMoney, todayIso } from './billing-format';
import {
  BILLING_ERRORS,
  optionsOf,
  RECURRING_FREQUENCY_LABELS,
  RECURRING_STATUS_LABELS,
} from './billing-labels';
import { adminBilling } from './billing-api';

/**
 * The one recurring invoice form (docx §9.2, §16 "Recurring Create/Edit"): the Recurring page's
 * side panel and Create Invoice's "Set up as recurring invoice" both use it.
 * "Template / Description" is one box as drawn: its first line is the template, the rest the
 * description.
 */

/** The form's starting values for a new schedule (Create Invoice passes the client and amount). */
export type RecurringDefaults = Partial<SaveRecurring>;

const splitTemplate = (text: string) => {
  const [first = '', ...rest] = text.split('\n');
  return { template: first.trim(), description: rest.join(' ').trim() };
};

/** The fields and the Cancel / Save Changes buttons; inline in a panel or inside the drawer. */
export function RecurringForm({
  schedule,
  defaults = {},
  lockClient,
  onCancel,
  onSaved,
}: {
  /** Edit this schedule; without it the form creates one. */
  schedule?: BillingRecurring | null;
  defaults?: RecurringDefaults;
  /** Keep the client fixed (Create Invoice). */
  lockClient?: boolean;
  onCancel: () => void;
  onSaved?: (schedule: BillingRecurring) => void;
}) {
  const id = useId();
  const today = todayIso();
  const [clientId, setClientId] = useState(schedule?.clientId ?? defaults.clientId ?? '');
  const [text, setText] = useState(
    schedule
      ? [schedule.template, schedule.description].filter(Boolean).join('\n')
      : [defaults.template ?? '', defaults.description ?? ''].filter(Boolean).join('\n'),
  );
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    schedule?.frequency ?? defaults.frequency ?? 'MONTHLY',
  );
  const [customDays, setCustomDays] = useState(() =>
    String(schedule?.customIntervalDays ?? defaults.customIntervalDays ?? 30),
  );
  const [amount, setAmount] = useState(() =>
    schedule
      ? moneyInput(schedule.amountCents)
      : defaults.amountCents
        ? moneyInput(defaults.amountCents)
        : '',
  );
  const [startDate, setStartDate] = useState(schedule?.startDate ?? defaults.startDate ?? today);
  const [nextDate, setNextDate] = useState(
    () =>
      schedule?.nextInvoiceDate ??
      defaults.nextInvoiceDate ??
      nextOccurrence(defaults.startDate ?? today, defaults.frequency ?? 'MONTHLY', null),
  );
  const [endDate, setEndDate] = useState(schedule?.endDate ?? defaults.endDate ?? '');
  const [autoSend, setAutoSend] = useState(schedule?.autoSend ?? defaults.autoSend ?? true);
  const [online, setOnline] = useState(
    schedule?.allowOnlinePayment ?? defaults.allowOnlinePayment ?? true,
  );
  const [status, setStatus] = useState<RecurringStatus>(
    schedule?.status ?? defaults.status ?? 'ACTIVE',
  );
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const clients = useApiQuery(['admin-billing', 'clients', 'all'], () => adminBilling.clients());
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const save = useApiMutation(
    (body: SaveRecurring) =>
      schedule
        ? adminBilling.updateRecurring(schedule.id, body)
        : adminBilling.createRecurring(body),
    { invalidate: ['admin-billing'] },
  );
  const activeFirms = new Set(
    (firms.data ?? []).filter((firm) => firm.status === 'ACTIVE').map((firm) => firm.id),
  );
  const clientOptions = (clients.data ?? [])
    .filter((client) => client.id === clientId || activeFirms.has(client.firmId))
    .map((client) => ({ value: client.id, label: `${client.name} (Client #${client.number})` }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const { template, description } = splitTemplate(text);
    const days = Number(customDays);
    const body: SaveRecurring = {
      clientId,
      template,
      description,
      frequency,
      customIntervalDays:
        frequency === 'CUSTOM' ? (Number.isInteger(days) ? days : Number.NaN) : null,
      amountCents: parseMoney(amount) ?? 0,
      startDate,
      nextInvoiceDate: nextDate,
      endDate: endDate || null,
      autoSend,
      allowOnlinePayment: online,
      status,
      sourceInvoiceId: schedule ? null : (defaults.sourceInvoiceId ?? null),
    };
    const found = recurringErrors(body);
    setErrors(found.fields);
    if (hasErrors(found)) return;
    save.mutate(body, { onSuccess: (saved) => onSaved?.(saved) });
  }

  return (
    <form noValidate onSubmit={submit} data-testid="recurring-form" className="flex flex-col gap-4">
      <FormField label="Client" htmlFor={`${id}-client`} required error={errors['clientId']}>
        <SelectControl
          id={`${id}-client`}
          value={clientId}
          disabled={lockClient}
          invalid={Boolean(errors['clientId'])}
          placeholder="Select a client..."
          options={clientOptions}
          onChange={(event) => setClientId(event.target.value)}
        />
      </FormField>
      <FormField
        label="Template / Description"
        htmlFor={`${id}-template`}
        required
        error={errors['template'] ?? errors['description']}
        hint="First line: the template name. Then a short description."
      >
        <textarea
          id={`${id}-template`}
          rows={3}
          maxLength={420}
          value={text}
          placeholder={'Premium Plan\nMonthly subscription for premium services'}
          aria-invalid={Boolean(errors['template']) || undefined}
          onChange={(event) => setText(event.target.value)}
          className={inputClass(Boolean(errors['template']))}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Frequency"
          htmlFor={`${id}-frequency`}
          required
          error={errors['frequency']}
        >
          <SelectControl
            id={`${id}-frequency`}
            value={frequency}
            options={optionsOf(RECURRING_FREQUENCIES, RECURRING_FREQUENCY_LABELS)}
            onChange={(event) => setFrequency(event.target.value as RecurringFrequency)}
          />
        </FormField>
        <FormField label="Amount" htmlFor={`${id}-amount`} required error={errors['amountCents']}>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text"
            >
              $
            </span>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              aria-invalid={Boolean(errors['amountCents']) || undefined}
              onChange={(event) => setAmount(event.target.value)}
              className={`${inputClass(Boolean(errors['amountCents']))} pl-7`}
            />
          </div>
        </FormField>
        {frequency === 'CUSTOM' ? (
          <FormField
            label="Every (days)"
            htmlFor={`${id}-days`}
            required
            error={errors['customIntervalDays']}
          >
            <input
              id={`${id}-days`}
              inputMode="numeric"
              value={customDays}
              onChange={(event) => setCustomDays(event.target.value)}
              className={inputClass(Boolean(errors['customIntervalDays']))}
            />
          </FormField>
        ) : null}
        <FormField label="Start Date" htmlFor={`${id}-start`} required error={errors['startDate']}>
          <DateControl
            id={`${id}-start`}
            value={startDate}
            invalid={Boolean(errors['startDate'])}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </FormField>
        <FormField
          label="Next Invoice Date"
          htmlFor={`${id}-next`}
          error={errors['nextInvoiceDate']}
        >
          <DateControl
            id={`${id}-next`}
            value={nextDate}
            min={startDate || undefined}
            invalid={Boolean(errors['nextInvoiceDate'])}
            onChange={(event) => setNextDate(event.target.value)}
          />
        </FormField>
      </div>
      <FormField label="End Date (Optional)" htmlFor={`${id}-end`} error={errors['endDate']}>
        <DateControl
          id={`${id}-end`}
          value={endDate}
          min={startDate || undefined}
          invalid={Boolean(errors['endDate'])}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </FormField>
      <div className="flex items-start gap-3">
        <Toggle checked={autoSend} onChange={setAutoSend} label="Auto-send invoice to client" />
        <div className="text-sm">
          <p className="font-medium text-text">Auto-send invoice to client</p>
          <p className="text-muted">Invoice will be automatically sent on the scheduled date.</p>
        </div>
      </div>
      <div>
        <Checkbox
          label="Allow online payment (AutoPay)"
          checked={online}
          onChange={(event) => setOnline(event.target.checked)}
        />
        <p className="pl-8 text-sm text-muted">Clients can pay this invoice online.</p>
      </div>
      <FormField label="Status" htmlFor={`${id}-status`}>
        <SelectControl
          id={`${id}-status`}
          value={status}
          options={optionsOf(RECURRING_STATUSES, RECURRING_STATUS_LABELS)}
          onChange={(event) => setStatus(event.target.value as RecurringStatus)}
        />
      </FormField>
      {save.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {errorMessage(save.error, BILLING_ERRORS)}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : schedule ? 'Save Changes' : 'Save Schedule'}
        </Button>
      </div>
    </form>
  );
}

/** The recurring form in the kit's right-side Drawer ("Recurring Invoice Details"). */
export function RecurringDrawer({
  open,
  schedule,
  defaults,
  lockClient,
  onClose,
  onSaved,
}: {
  open: boolean;
  schedule?: BillingRecurring | null;
  defaults?: RecurringDefaults;
  lockClient?: boolean;
  onClose: () => void;
  onSaved?: (schedule: BillingRecurring) => void;
}) {
  return (
    <Drawer open={open} title="Recurring Invoice Details" onClose={onClose}>
      {open ? (
        <RecurringForm
          schedule={schedule}
          defaults={defaults}
          lockClient={lockClient}
          onCancel={onClose}
          onSaved={(saved) => {
            onSaved?.(saved);
            onClose();
          }}
        />
      ) : null}
    </Drawer>
  );
}
