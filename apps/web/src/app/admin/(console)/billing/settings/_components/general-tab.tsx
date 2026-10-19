'use client';

import { FormField } from '@firmivra/ui';
import {
  CURRENCIES,
  PAYMENT_TERMS,
  type BillingSettings,
  type Currency,
  type PaymentTerms,
} from '../../../../../../mocks/admin-billing';
import { inputClass, SelectControl } from '../../_components/billing-fields';
import { optionsOf, PAYMENT_TERMS_LABELS } from '../../_components/billing-labels';
import {
  CURRENCY_NAMES,
  DATE_FORMATS,
  LANGUAGES,
  PRECISIONS,
  ROUNDING_LABELS,
  roundingStep,
  TIME_ZONES,
  VALIDITY_DAYS,
  withCurrent,
} from './settings-model';
import { SettingsCard, ToggleRow, type SettingsForm } from './settings-parts';

/**
 * General (firmivra-billing-settings-dashboard.jpg; docx §15): Platform Billing Defaults, Date
 * and Time Settings, Rounding and Precision, Global Billing Options and Default Notes.
 */

type General = BillingSettings['general'];
const NOTE_MAX = 1000;
const ROUNDINGS: General['rounding'][] = ['STANDARD', 'UP', 'DOWN'];

/** The estimate validity choices ("30 days"), plus the saved value when it is not one of them. */
export function validityOptions(current: number): { value: string; label: string }[] {
  const days: number[] = [...VALIDITY_DAYS];
  if (!Number.isNaN(current) && !days.includes(current)) days.push(current);
  return days.sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} days` }));
}

export function GeneralTab({ form }: { form: SettingsForm | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title="Platform Billing Defaults"
        description="Set default values that will apply to all firms. Individual firms can override these settings in their own portal."
        testId="settings-platform-defaults"
      >
        {form ? <PlatformDefaults form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Date and Time Settings"
        description="Configure how dates and times are displayed across all billing documents."
      >
        {form ? <DateAndTime form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Rounding and Precision"
        description="Set how amounts are rounded on invoices, estimates, and credit notes."
      >
        {form ? <Rounding form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Global Billing Options"
        description="Control optional features for the billing module across all firms."
        testId="settings-global-options"
      >
        {form ? <GlobalOptions form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Default Notes"
        description="Set default notes that will appear on billing documents (firms can edit)."
      >
        {form ? <DefaultNotes form={form} /> : null}
      </SettingsCard>
    </div>
  );
}

function PlatformDefaults({ form }: { form: SettingsForm }) {
  const g = form.value.general;
  const set = (value: Partial<General>) => form.patch('general', value);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <FormField label="Default Currency" htmlFor="settings-currency">
        <SelectControl
          id="settings-currency"
          value={g.currency}
          options={optionsOf(CURRENCIES, CURRENCY_NAMES)}
          onChange={(event) => set({ currency: event.target.value as Currency })}
        />
      </FormField>
      <FormField label="Default Language" htmlFor="settings-language">
        <SelectControl
          id="settings-language"
          value={g.language}
          options={withCurrent(LANGUAGES, g.language)}
          onChange={(event) => set({ language: event.target.value })}
        />
      </FormField>
      <FormField label="Default Invoice Terms" htmlFor="settings-invoice-terms">
        <SelectControl
          id="settings-invoice-terms"
          value={g.invoiceTerms}
          options={optionsOf(PAYMENT_TERMS, PAYMENT_TERMS_LABELS)}
          onChange={(event) => set({ invoiceTerms: event.target.value as PaymentTerms })}
        />
      </FormField>
      <FormField
        label="Default Estimate Validity"
        htmlFor="settings-estimate-validity"
        error={form.errors['general.estimateValidityDays']}
      >
        <SelectControl
          id="settings-estimate-validity"
          value={String(g.estimateValidityDays)}
          invalid={Boolean(form.errors['general.estimateValidityDays'])}
          options={validityOptions(g.estimateValidityDays)}
          onChange={(event) => set({ estimateValidityDays: Number(event.target.value) })}
        />
      </FormField>
    </div>
  );
}

function DateAndTime({ form }: { form: SettingsForm }) {
  const g = form.value.general;
  const set = (value: Partial<General>) => form.patch('general', value);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField label="Default Time Zone" htmlFor="settings-time-zone">
        <SelectControl
          id="settings-time-zone"
          value={g.timeZone}
          options={withCurrent(TIME_ZONES, g.timeZone)}
          onChange={(event) => set({ timeZone: event.target.value })}
        />
      </FormField>
      <FormField label="Date Format" htmlFor="settings-date-format">
        <SelectControl
          id="settings-date-format"
          value={g.dateFormat}
          options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
          onChange={(event) => set({ dateFormat: event.target.value as General['dateFormat'] })}
        />
      </FormField>
    </div>
  );
}

function Rounding({ form }: { form: SettingsForm }) {
  const g = form.value.general;
  const set = (value: Partial<General>) => form.patch('general', value);
  const step = roundingStep(g.decimalPrecision);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        label="Decimal Precision"
        htmlFor="settings-precision"
        error={form.errors['general.decimalPrecision']}
      >
        <SelectControl
          id="settings-precision"
          value={String(g.decimalPrecision)}
          invalid={Boolean(form.errors['general.decimalPrecision'])}
          options={PRECISIONS.map((places) => ({
            value: String(places),
            label: `${places} decimal places`,
          }))}
          onChange={(event) => set({ decimalPrecision: Number(event.target.value) })}
        />
      </FormField>
      <FormField label="Rounding Method" htmlFor="settings-rounding">
        <SelectControl
          id="settings-rounding"
          value={g.rounding}
          options={ROUNDINGS.map((rounding) => ({
            value: rounding,
            label: `${ROUNDING_LABELS[rounding]} (${step})`,
          }))}
          onChange={(event) => set({ rounding: event.target.value as General['rounding'] })}
        />
      </FormField>
    </div>
  );
}

function GlobalOptions({ form }: { form: SettingsForm }) {
  const g = form.value.general;
  const set = (value: Partial<General>) => form.patch('general', value);
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <ToggleRow
        label="Enable Credit Notes"
        description="Allow firms to create and manage credit notes."
        checked={g.enableCreditNotes}
        onChange={(enableCreditNotes) => set({ enableCreditNotes })}
      />
      <ToggleRow
        label="Enable Estimates"
        description="Allow firms to create and manage estimates."
        checked={g.enableEstimates}
        onChange={(enableEstimates) => set({ enableEstimates })}
      />
      <ToggleRow
        label="Enable Partial Payments"
        description="Allow customers to make partial payments."
        checked={g.enablePartialPayments}
        onChange={(enablePartialPayments) => set({ enablePartialPayments })}
      />
      <ToggleRow
        label="Enable Late Fees"
        description="Allow firms to charge late fees on overdue invoices."
        checked={g.enableLateFees}
        onChange={(enableLateFees) => set({ enableLateFees })}
      />
      <ToggleRow
        label="Require Purchase Order Number"
        description="Require a PO number on all invoices (firms can override)."
        checked={g.requirePurchaseOrder}
        onChange={(requirePurchaseOrder) => set({ requirePurchaseOrder })}
      />
      <ToggleRow
        label="Require Tax on Invoices"
        description="Require a tax rate on all invoices (firms can override)."
        checked={g.requireTax}
        onChange={(requireTax) => set({ requireTax })}
      />
    </div>
  );
}

function DefaultNotes({ form }: { form: SettingsForm }) {
  const g = form.value.general;
  const set = (value: Partial<General>) => form.patch('general', value);
  const notes = [
    {
      id: 'settings-terms',
      key: 'termsAndConditions',
      label: 'Default Terms & Conditions',
      placeholder: 'Terms that appear on every invoice and estimate...',
      patch: (text: string): Partial<General> => ({ termsAndConditions: text }),
    },
    {
      id: 'settings-footer',
      key: 'footerNote',
      label: 'Default Footer Note',
      placeholder: 'A line at the bottom of every billing document...',
      patch: (text: string): Partial<General> => ({ footerNote: text }),
    },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {notes.map((note) => (
          <FormField
            key={note.id}
            label={note.label}
            htmlFor={note.id}
            error={form.errors[`general.${note.key}`]}
            counter={`${g[note.key].length}/${NOTE_MAX}`}
          >
            <textarea
              id={note.id}
              rows={1}
              maxLength={NOTE_MAX}
              value={g[note.key]}
              placeholder={note.placeholder}
              aria-invalid={Boolean(form.errors[`general.${note.key}`]) || undefined}
              onChange={(event) => set(note.patch(event.target.value))}
              className={`${inputClass(Boolean(form.errors[`general.${note.key}`]))} max-h-40 resize-y field-sizing-content`}
            />
          </FormField>
        ))}
      </div>
      <FormField
        label="Platform Notes (internal)"
        htmlFor="settings-platform-notes"
        hint="Only the Firmivra team sees these notes; they never appear on documents."
        error={form.errors['general.platformNotes']}
        counter={`${g.platformNotes.length}/${NOTE_MAX}`}
      >
        <textarea
          id="settings-platform-notes"
          rows={1}
          maxLength={NOTE_MAX}
          value={g.platformNotes}
          placeholder="Notes for the Firmivra team about these defaults..."
          aria-invalid={Boolean(form.errors['general.platformNotes']) || undefined}
          onChange={(event) => set({ platformNotes: event.target.value })}
          className={`${inputClass(Boolean(form.errors['general.platformNotes']))} max-h-40 resize-y field-sizing-content`}
        />
      </FormField>
    </div>
  );
}
