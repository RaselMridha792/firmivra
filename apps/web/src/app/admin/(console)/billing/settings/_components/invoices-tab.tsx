'use client';

import { FormField } from '@firmivra/ui';
import {
  ESTIMATE_TEMPLATES,
  INVOICE_TYPES,
  PAYMENT_TERMS,
  type BillingSettings,
  type EstimateTemplate,
  type InvoiceType,
  type PaymentTerms,
} from '../../../../../../mocks/admin-billing';
import { SelectControl } from '../../_components/billing-fields';
import {
  ESTIMATE_TEMPLATE_LABELS,
  INVOICE_TYPE_LABELS,
  optionsOf,
  PAYMENT_TERMS_LABELS,
} from '../../_components/billing-labels';
import { validityOptions } from './general-tab';
import { ATTACHMENT_TYPES } from './settings-model';
import {
  CheckboxGroup,
  NumberControl,
  RadioGroup,
  SettingsCard,
  ToggleRow,
  type SettingsForm,
} from './settings-parts';

/**
 * Invoices & Estimates (docx §15): invoice due terms, estimate expiration, default tax and
 * discount behaviour, attachment rules, the online payment and send defaults, and how an
 * estimate converts to an invoice.
 */

type Invoices = BillingSettings['invoices'];

export function InvoicesTab({ form }: { form: SettingsForm | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title="Invoice Defaults"
        description="What a new invoice starts with on every firm, until the firm sets its own."
        testId="settings-invoice-defaults"
      >
        {form ? <InvoiceDefaults form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Draft and Send Defaults"
        description="The options a new invoice opens with on Create Invoice."
      >
        {form ? <SendDefaults form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Attachments"
        description="Which files can be attached to invoices, and how large they can be."
      >
        {form ? <Attachments form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Estimate Defaults"
        description="How long estimates stay valid and what happens when one becomes an invoice."
      >
        {form ? <EstimateDefaults form={form} /> : null}
      </SettingsCard>
    </div>
  );
}

function InvoiceDefaults({ form }: { form: SettingsForm }) {
  const v = form.value;
  const set = (value: Partial<Invoices>) => form.patch('invoices', value);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        label="Invoice Due Terms"
        htmlFor="settings-due-terms"
        hint="The same value as Default Invoice Terms on General."
      >
        <SelectControl
          id="settings-due-terms"
          value={v.general.invoiceTerms}
          options={optionsOf(PAYMENT_TERMS, PAYMENT_TERMS_LABELS)}
          onChange={(event) =>
            form.patch('general', { invoiceTerms: event.target.value as PaymentTerms })
          }
        />
      </FormField>
      <FormField label="Default Invoice Type" htmlFor="settings-invoice-type">
        <SelectControl
          id="settings-invoice-type"
          value={v.invoices.defaultInvoiceType}
          options={optionsOf(INVOICE_TYPES, INVOICE_TYPE_LABELS)}
          onChange={(event) => set({ defaultInvoiceType: event.target.value as InvoiceType })}
        />
      </FormField>
      <FormField
        label="Default Tax Rate"
        htmlFor="settings-default-tax"
        hint="Added to each new line; the rates are on Taxes & Fees."
        error={form.errors['invoices.defaultTaxRateId']}
      >
        <SelectControl
          id="settings-default-tax"
          value={v.invoices.defaultTaxRateId ?? ''}
          invalid={Boolean(form.errors['invoices.defaultTaxRateId'])}
          options={[
            { value: '', label: 'No default tax' },
            ...v.taxes.rates.map((rate) => ({
              value: rate.id,
              label: `${rate.name || 'Unnamed rate'} (${rate.ratePercent}%)`,
            })),
          ]}
          onChange={(event) => set({ defaultTaxRateId: event.target.value || null })}
        />
      </FormField>
      <RadioGroup
        legend="Discounts"
        value={v.invoices.discountBeforeTax ? 'before' : 'after'}
        options={[
          { value: 'before', label: 'Apply discounts before tax' },
          { value: 'after', label: 'Apply discounts after tax' },
        ]}
        onChange={(next) => set({ discountBeforeTax: next === 'before' })}
      />
    </div>
  );
}

function SendDefaults({ form }: { form: SettingsForm }) {
  const i = form.value.invoices;
  const set = (value: Partial<Invoices>) => form.patch('invoices', value);
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <ToggleRow
        label="Send to the Client When Saved"
        description="“Send invoice to client now” starts ticked; off saves without emailing."
        checked={i.sendNowDefault}
        onChange={(sendNowDefault) => set({ sendNowDefault })}
      />
      <ToggleRow
        label="Allow Online Payment by Default"
        description="New invoices can be paid online unless the firm turns it off."
        checked={i.onlinePaymentDefault}
        onChange={(onlinePaymentDefault) => set({ onlinePaymentDefault })}
      />
    </div>
  );
}

function Attachments({ form }: { form: SettingsForm }) {
  const i = form.value.invoices;
  const set = (value: Partial<Invoices>) => form.patch('invoices', value);
  const types = [...ATTACHMENT_TYPES, ...i.attachmentTypes.filter((t) => !isKnownType(t))];
  return (
    <div className="flex flex-col gap-4">
      <ToggleRow
        label="Allow Attachments"
        description="Firms can attach files such as agreements to invoices."
        checked={i.allowAttachments}
        onChange={(allowAttachments) => set({ allowAttachments })}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <FormField
          label="Largest File"
          htmlFor="settings-max-attachment"
          hint="1 to 25 MB per file."
          error={form.errors['invoices.maxAttachmentMb']}
        >
          <NumberControl
            id="settings-max-attachment"
            value={i.maxAttachmentMb}
            min={1}
            max={25}
            suffix="MB"
            disabled={!i.allowAttachments}
            invalid={Boolean(form.errors['invoices.maxAttachmentMb'])}
            onValue={(maxAttachmentMb) => set({ maxAttachmentMb })}
          />
        </FormField>
        <div className="min-w-0 lg:col-span-2">
          <CheckboxGroup
            legend="Allowed File Types"
            options={types.map((type) => ({ value: type, label: type.toUpperCase().slice(1) }))}
            value={i.attachmentTypes}
            disabled={!i.allowAttachments}
            error={form.errors['invoices.attachmentTypes']}
            hint={
              i.allowAttachments
                ? undefined
                : 'Attachments are off: Create Invoice hides the file upload for every firm.'
            }
            columns="grid-cols-2 sm:grid-cols-3 xl:grid-cols-5"
            onChange={(attachmentTypes) => set({ attachmentTypes })}
          />
        </div>
      </div>
    </div>
  );
}

const isKnownType = (type: string) => (ATTACHMENT_TYPES as readonly string[]).includes(type);

function EstimateDefaults({ form }: { form: SettingsForm }) {
  const v = form.value;
  const set = (value: Partial<Invoices>) => form.patch('invoices', value);
  return (
    <div className="flex flex-col gap-4">
      {v.general.enableEstimates ? null : (
        <p className="rounded-lg bg-warning-soft p-3 text-sm text-text">
          Estimates are turned off on General, so these defaults apply only when they are back on.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Estimate Expiration"
          htmlFor="settings-estimate-expiration"
          hint="The same value as Default Estimate Validity on General."
          error={form.errors['general.estimateValidityDays']}
        >
          <SelectControl
            id="settings-estimate-expiration"
            value={String(v.general.estimateValidityDays)}
            options={validityOptions(v.general.estimateValidityDays)}
            onChange={(event) =>
              form.patch('general', { estimateValidityDays: Number(event.target.value) })
            }
          />
        </FormField>
        <FormField label="Default Estimate Template" htmlFor="settings-estimate-template">
          <SelectControl
            id="settings-estimate-template"
            value={v.invoices.estimateTemplate}
            options={optionsOf(ESTIMATE_TEMPLATES, ESTIMATE_TEMPLATE_LABELS)}
            onChange={(event) => set({ estimateTemplate: event.target.value as EstimateTemplate })}
          />
        </FormField>
        <RadioGroup
          legend="Converting an Estimate to an Invoice"
          value={v.invoices.conversion}
          options={[
            { value: 'COPY_ALL', label: 'Copy the lines, notes and terms' },
            { value: 'LINES_ONLY', label: 'Copy the lines only' },
          ]}
          onChange={(conversion) => set({ conversion })}
        />
        <ToggleRow
          label="Allow Converting More Than Once"
          description="Off: an estimate becomes one invoice only, so it can't be invoiced twice."
          checked={v.invoices.allowDuplicateConversion}
          onChange={(allowDuplicateConversion) => set({ allowDuplicateConversion })}
        />
      </div>
    </div>
  );
}
