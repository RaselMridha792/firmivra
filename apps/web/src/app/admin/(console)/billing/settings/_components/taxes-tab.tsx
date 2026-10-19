'use client';

import { Button, FormField } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import type { BillingSettings, FeeRule } from '../../../../../../mocks/admin-billing';
import { inputClass, SelectControl } from '../../_components/billing-fields';
import { newTaxRateId } from './settings-model';
import {
  MoneyControl,
  NumberControl,
  RadioGroup,
  SettingsCard,
  ToggleRow,
  type SettingsForm,
} from './settings-parts';

/**
 * Taxes & Fees (docx §15): tax-inclusive or exclusive prices, the platform tax rates, the
 * service fee and the late fee (flat or percentage, with a grace period), and whether firms may
 * set their own.
 */

type Taxes = BillingSettings['taxes'];
const FEE_TYPES = [
  { value: 'PERCENT', label: 'Percentage of the invoice' },
  { value: 'FLAT', label: 'Flat amount' },
];

export function TaxesTab({ form }: { form: SettingsForm | null }) {
  const rates = form?.value.taxes.rates ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title="Tax Calculation"
        description="Whether the prices on billing documents include tax or have it added."
      >
        {form ? (
          <RadioGroup
            legend="Tax behaviour"
            value={form.value.taxes.mode}
            options={[
              { value: 'EXCLUSIVE', label: 'Tax-exclusive: tax is added on top of prices' },
              { value: 'INCLUSIVE', label: 'Tax-inclusive: prices already include tax' },
            ]}
            onChange={(mode) => form.patch('taxes', { mode })}
          />
        ) : null}
      </SettingsCard>
      <SettingsCard
        title="Tax Rates"
        description="The rates firms can pick on invoice, estimate and credit note lines."
        testId="settings-tax-rates"
        action={
          form ? (
            <Button
              variant="outline"
              onClick={() =>
                form.patch('taxes', {
                  rates: [
                    ...rates,
                    { id: newTaxRateId(rates.map((rate) => rate.id)), name: '', ratePercent: 0 },
                  ],
                })
              }
            >
              <Plus aria-hidden weight="bold" className="size-5" />
              Add Tax Rate
            </Button>
          ) : null
        }
      >
        {form ? <TaxRates form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Service Fee"
        description="An optional fee added to invoices, such as a card processing fee."
      >
        {form ? (
          <FeeFields
            form={form}
            name="serviceFee"
            label="Service Fee"
            fee={form.value.taxes.serviceFee}
            onFee={(serviceFee) => form.patch('taxes', { serviceFee })}
          />
        ) : null}
      </SettingsCard>
      <SettingsCard
        title="Late Fee"
        description="Charged on overdue invoices after the grace period."
        testId="settings-late-fee"
      >
        {form ? <LateFee form={form} /> : null}
      </SettingsCard>
      <SettingsCard title="Firm Overrides" description="Who decides taxes and fees for a firm.">
        {form ? (
          <ToggleRow
            label="Firms May Override Taxes and Fees"
            description="Firms can set their own tax rates, service fee and late fee; these stay the defaults."
            checked={form.value.taxes.firmsMayOverride}
            onChange={(firmsMayOverride) => form.patch('taxes', { firmsMayOverride })}
          />
        ) : null}
      </SettingsCard>
    </div>
  );
}

function TaxRates({ form }: { form: SettingsForm }) {
  const rates = form.value.taxes.rates;
  const setRates = (next: Taxes['rates']) => form.patch('taxes', { rates: next });
  if (rates.length === 0)
    return (
      <p data-testid="tax-rates-empty" className="py-2 text-sm text-muted">
        No tax rates yet. Add one so firms can tax their lines.
      </p>
    );
  return (
    <div className="rounded-lg border border-divider">
      <div
        aria-hidden
        className="hidden grid-cols-12 gap-3 rounded-t-lg bg-table-head px-3 py-3 text-sm font-semibold text-heading sm:grid"
      >
        <span className="col-span-7">Name</span>
        <span className="col-span-4">Rate</span>
      </div>
      <ul className="flex flex-col divide-y divide-divider">
        {rates.map((rate, index) => {
          const nameError = form.errors[`taxes.rates.${index}.name`];
          const rateError = form.errors[`taxes.rates.${index}.ratePercent`];
          const n = index + 1;
          const label = rate.name.trim() || `tax rate ${n}`;
          return (
            <li key={rate.id} data-testid="tax-rate" className="flex flex-col gap-1 p-3">
              <div className="grid grid-cols-12 items-center gap-3">
                <input
                  aria-label={`Tax rate ${n} name`}
                  value={rate.name}
                  maxLength={40}
                  placeholder="e.g. State Sales Tax"
                  aria-invalid={Boolean(nameError) || undefined}
                  onChange={(event) =>
                    setRates(
                      rates.map((row) =>
                        row.id === rate.id ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                  className={`${inputClass(Boolean(nameError))} col-span-12 sm:col-span-7`}
                />
                <NumberControl
                  aria-label={`Tax rate ${n} percent`}
                  value={rate.ratePercent}
                  min={0}
                  max={100}
                  step="any"
                  suffix="%"
                  invalid={Boolean(rateError)}
                  className="col-span-9 sm:col-span-4"
                  onValue={(ratePercent) =>
                    setRates(
                      rates.map((row) => (row.id === rate.id ? { ...row, ratePercent } : row)),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  title="Remove tax rate"
                  onClick={() => setRates(rates.filter((row) => row.id !== rate.id))}
                  className="col-span-3 inline-flex size-10 items-center justify-center justify-self-end rounded-lg text-heading hover:bg-canvas disabled:cursor-not-allowed disabled:text-disabled-text sm:col-span-1"
                >
                  <Trash aria-hidden weight="fill" className="size-5" />
                </button>
              </div>
              {nameError || rateError ? (
                <p className="text-xs text-danger">
                  {[nameError, rateError].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Enabled, flat or percentage, and the amount (cents when flat, a percent when not). */
function FeeFields({
  form,
  name,
  label,
  fee,
  onFee,
  disabled,
}: {
  form: SettingsForm;
  name: 'serviceFee' | 'lateFee';
  label: string;
  fee: FeeRule;
  onFee: (fee: FeeRule) => void;
  disabled?: boolean;
}) {
  const amountError = form.errors[`taxes.${name}.amount`];
  const id = `settings-${name}`;
  return (
    <div className="flex flex-col gap-4">
      <ToggleRow
        label={`Charge a ${label}`}
        checked={fee.enabled}
        disabled={disabled}
        onChange={(enabled) => onFee({ ...fee, enabled })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label={`${label} Type`} htmlFor={`${id}-type`}>
          <SelectControl
            id={`${id}-type`}
            value={fee.type}
            disabled={disabled || !fee.enabled}
            options={FEE_TYPES}
            onChange={(event) => {
              const type = event.target.value as FeeRule['type'];
              // The amount means cents or a percent: start the other kind at 0.
              onFee({ ...fee, type, amount: type === fee.type ? fee.amount : 0 });
            }}
          />
        </FormField>
        <FormField
          label={fee.type === 'FLAT' ? `${label} Amount` : `${label} Percent`}
          htmlFor={`${id}-amount`}
          error={amountError}
        >
          {fee.type === 'FLAT' ? (
            <MoneyControl
              id={`${id}-amount`}
              cents={fee.amount}
              invalid={Boolean(amountError)}
              disabled={disabled || !fee.enabled}
              onCents={(amount) => onFee({ ...fee, amount })}
            />
          ) : (
            <NumberControl
              id={`${id}-amount`}
              value={fee.amount}
              min={0}
              max={100}
              step="any"
              suffix="%"
              invalid={Boolean(amountError)}
              disabled={disabled || !fee.enabled}
              onValue={(amount) => onFee({ ...fee, amount })}
            />
          )}
        </FormField>
      </div>
    </div>
  );
}

function LateFee({ form }: { form: SettingsForm }) {
  const fee = form.value.taxes.lateFee;
  const off = !form.value.general.enableLateFees;
  const graceError = form.errors['taxes.lateFee.graceDays'];
  return (
    <div className="flex flex-col gap-4">
      {off ? (
        <p className="rounded-lg bg-warning-soft p-3 text-sm text-text">
          Late fees are turned off on General (Enable Late Fees), so no firm charges one.
        </p>
      ) : null}
      <FeeFields
        form={form}
        name="lateFee"
        label="Late Fee"
        fee={fee}
        disabled={off}
        onFee={(next) => form.patch('taxes', { lateFee: { ...fee, ...next } })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Grace Period"
          htmlFor="settings-late-grace"
          hint="Days after the due date before the fee is added (0 to 90)."
          error={graceError}
        >
          <NumberControl
            id="settings-late-grace"
            value={fee.graceDays}
            min={0}
            max={90}
            suffix="days"
            invalid={Boolean(graceError)}
            disabled={off || !fee.enabled}
            onValue={(graceDays) => form.patch('taxes', { lateFee: { ...fee, graceDays } })}
          />
        </FormField>
      </div>
    </div>
  );
}
