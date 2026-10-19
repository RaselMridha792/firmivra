import {
  BILLING_CAPABILITIES,
  type AdminRole,
  type BillingSettings,
  type Currency,
  type TemplateKind,
} from '../../../../../../mocks/admin-billing';
import {
  BILLING_CAPABILITY_LABELS,
  CURRENCY_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../../_components/billing-labels';

/** Billing Settings' tabs, choices and the rules behind Save, Cancel and Reset (docx §15). */

/** The eight tabs, in the design's order; each one edits the settings section of the same id. */
export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'invoices', label: 'Invoices & Estimates' },
  { id: 'payments', label: 'Payments' },
  { id: 'taxes', label: 'Taxes & Fees' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'templates', label: 'Templates' },
  { id: 'numbering', label: 'Numbering' },
  { id: 'permissions', label: 'Permissions' },
] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export const tabLabel = (id: SettingsTabId): string =>
  SETTINGS_TABS.find((tab) => tab.id === id)?.label ?? id;

/** The tab a field message belongs to: its path starts with the section ("taxes.rates.0.name"). */
export function tabOfPath(path: string): SettingsTabId | null {
  const section = path.split('.')[0];
  return SETTINGS_TABS.find((tab) => tab.id === section)?.id ?? null;
}

/** The tabs with a message, in tab order. */
export function tabsWithErrors(fields: Partial<Record<string, string>>): SettingsTabId[] {
  const found = new Set(
    Object.entries(fields)
      .filter(([, message]) => Boolean(message))
      .map(([path]) => tabOfPath(path)),
  );
  return SETTINGS_TABS.map((tab) => tab.id).filter((id) => found.has(id));
}

/** The sections of the settings object a form can change. */
export type SectionKey = Exclude<keyof BillingSettings, 'updatedAt' | 'updatedBy'>;

/**
 * One tab's settings back to the platform defaults, in the unsaved draft. Numbering keeps its
 * counters (a counter moved back would only skip to the next free number), and resetting the
 * tax rates drops a default tax rate that no longer exists.
 */
export function resetTab(
  tab: SettingsTabId,
  draft: BillingSettings,
  defaults: BillingSettings,
): BillingSettings {
  const copy = structuredClone(defaults);
  switch (tab) {
    case 'general':
      return { ...draft, general: copy.general };
    case 'invoices':
      return { ...draft, invoices: copy.invoices };
    case 'payments':
      return { ...draft, payments: copy.payments };
    case 'reminders':
      return { ...draft, reminders: copy.reminders };
    case 'templates':
      return { ...draft, templates: copy.templates };
    case 'permissions':
      return { ...draft, permissions: copy.permissions };
    case 'numbering':
      return {
        ...draft,
        numbering: {
          ...copy.numbering,
          invoice: { ...copy.numbering.invoice, next: draft.numbering.invoice.next },
          estimate: { ...copy.numbering.estimate, next: draft.numbering.estimate.next },
          creditNote: { ...copy.numbering.creditNote, next: draft.numbering.creditNote.next },
        },
      };
    case 'taxes': {
      const kept = copy.taxes.rates.some((rate) => rate.id === draft.invoices.defaultTaxRateId);
      return {
        ...draft,
        taxes: copy.taxes,
        invoices: kept ? draft.invoices : { ...draft.invoices, defaultTaxRateId: null },
      };
    }
  }
}

/** Two settings objects hold the same values (the save stamp aside). */
export function sameSettings(a: BillingSettings, b: BillingSettings): boolean {
  const strip = ({ updatedAt: _at, updatedBy: _by, ...rest }: BillingSettings) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * The high-impact changes a save asks to confirm first (master guide: "confirm high-impact
 * change"): features turned off or made mandatory for every firm, money and tax rules, numbering
 * and who may do what. Empty when the save needs no confirmation.
 */
export function highImpactChanges(
  before: BillingSettings,
  after: BillingSettings,
  myRole: AdminRole | null,
): string[] {
  const changes: string[] = [];
  const off = (was: boolean, now: boolean, text: string) => {
    if (was && !now) changes.push(text);
  };
  const on = (was: boolean, now: boolean, text: string) => {
    if (!was && now) changes.push(text);
  };
  const g0 = before.general;
  const g1 = after.general;
  off(g0.enableCreditNotes, g1.enableCreditNotes, 'Credit notes are turned off for every firm.');
  off(g0.enableEstimates, g1.enableEstimates, 'Estimates are turned off for every firm.');
  off(g0.enablePartialPayments, g1.enablePartialPayments, 'Partial payments are turned off.');
  off(g0.enableLateFees, g1.enableLateFees, 'Late fees are turned off for every firm.');
  on(
    g0.requirePurchaseOrder,
    g1.requirePurchaseOrder,
    'Every new invoice needs a PO number (firms can override).',
  );
  on(g0.requireTax, g1.requireTax, 'Every invoice line needs a tax rate (firms can override).');
  if (g0.currency !== g1.currency)
    changes.push(
      `The default currency changes from ${currencyName(g0.currency)} to ${currencyName(g1.currency)}.`,
    );
  if (g0.decimalPrecision !== g1.decimalPrecision || g0.rounding !== g1.rounding)
    changes.push('Amounts are rounded differently on new documents.');

  const removedMethods = before.payments.methods.filter(
    (method) => !after.payments.methods.includes(method),
  );
  if (removedMethods.length)
    changes.push(
      `Payment methods turned off: ${removedMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(', ')}.`,
    );
  on(
    before.payments.allowOverpayments,
    after.payments.allowOverpayments,
    'Payments above the balance are allowed.',
  );

  if (before.taxes.mode !== after.taxes.mode)
    changes.push(
      after.taxes.mode === 'INCLUSIVE'
        ? 'Prices now include tax (tax-inclusive).'
        : 'Tax is now added on top of prices (tax-exclusive).',
    );
  const removedRates = before.taxes.rates.filter(
    (rate) => !after.taxes.rates.some((row) => row.id === rate.id),
  );
  if (removedRates.length)
    changes.push(`Tax rates removed: ${removedRates.map((rate) => rate.name).join(', ')}.`);
  const changedRates = before.taxes.rates.filter((rate) =>
    after.taxes.rates.some((row) => row.id === rate.id && row.ratePercent !== rate.ratePercent),
  );
  if (changedRates.length)
    changes.push(
      `Tax rates change for new documents: ${changedRates.map((rate) => rate.name).join(', ')}.`,
    );

  const numberNames = { invoice: 'Invoice', estimate: 'Estimate', creditNote: 'Credit note' };
  for (const key of ['invoice', 'estimate', 'creditNote'] as const) {
    const was = before.numbering[key];
    const now = after.numbering[key];
    if (was.format !== now.format)
      changes.push(`${numberNames[key]} numbers change from ${was.format} to ${now.format}.`);
    if (was.next !== now.next)
      changes.push(`${numberNames[key]} numbering continues from ${now.next}.`);
  }
  if (before.numbering.resetRule !== after.numbering.resetRule)
    changes.push(
      after.numbering.resetRule === 'YEARLY'
        ? 'Counters restart at 1 every year.'
        : 'Counters no longer restart every year.',
    );
  if (before.numbering.perFirm !== after.numbering.perFirm)
    changes.push(
      after.numbering.perFirm
        ? 'Each firm gets its own number sequence.'
        : 'Numbers become unique across all firms.',
    );

  const changedCapabilities = BILLING_CAPABILITIES.filter(
    (capability) =>
      [...before.permissions[capability]].sort().join() !==
      [...after.permissions[capability]].sort().join(),
  );
  if (changedCapabilities.length)
    changes.push(
      `Permissions change for: ${changedCapabilities.map((c) => BILLING_CAPABILITY_LABELS[c]).join(', ')}.`,
    );
  if (
    myRole &&
    before.permissions.EDIT_SETTINGS.includes(myRole) &&
    !after.permissions.EDIT_SETTINGS.includes(myRole)
  )
    changes.push('You will no longer be able to edit Billing Settings.');
  return changes;
}

// Choices -------------------------------------------------------------------------------------

/** "USD - US Dollar ($)", as drawn. */
export const CURRENCY_NAMES: Record<Currency, string> = {
  USD: 'USD - US Dollar ($)',
  CAD: 'CAD - Canadian Dollar ($)',
  EUR: 'EUR - Euro (€)',
  GBP: 'GBP - British Pound (£)',
};
const currencyName = (currency: Currency) => CURRENCY_LABELS[currency];

export const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-US', label: 'Spanish (US)' },
  { value: 'fr-CA', label: 'French (Canada)' },
];

export const TIME_ZONES = [
  { value: 'America/New_York', label: '(GMT-05:00) Eastern Time (US & Canada)' },
  { value: 'America/Chicago', label: '(GMT-06:00) Central Time (US & Canada)' },
  { value: 'America/Denver', label: '(GMT-07:00) Mountain Time (US & Canada)' },
  { value: 'America/Phoenix', label: '(GMT-07:00) Arizona' },
  { value: 'America/Los_Angeles', label: '(GMT-08:00) Pacific Time (US & Canada)' },
  { value: 'America/Anchorage', label: '(GMT-09:00) Alaska' },
  { value: 'Pacific/Honolulu', label: '(GMT-10:00) Hawaii' },
  { value: 'UTC', label: '(GMT+00:00) Coordinated Universal Time' },
];

export const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;

export const PRECISIONS = [0, 2, 3] as const;

/** The smallest step amounts are rounded to: 2 places → "0.01". */
export const roundingStep = (precision: number): string =>
  precision > 0 ? `0.${'1'.padStart(precision, '0')}` : '1';

export const ROUNDING_LABELS: Record<BillingSettings['general']['rounding'], string> = {
  STANDARD: 'Standard Rounding',
  UP: 'Always Round Up',
  DOWN: 'Always Round Down',
};

/** The estimate validity choices; a saved value outside them is added to the list. */
export const VALIDITY_DAYS = [7, 14, 15, 30, 45, 60, 90] as const;

/** Adds the current value to a list of choices when it is not one of them. */
export function withCurrent(
  options: { value: string; label: string }[],
  current: string,
): { value: string; label: string }[] {
  return options.some((option) => option.value === current)
    ? options
    : [...options, { value: current, label: current }];
}

/** The file types an invoice attachment may have (the saved list may add others). */
export const ATTACHMENT_TYPES = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
] as const;

/** The placeholders each template may use, and the sample values its preview shows. */
export const TEMPLATE_PLACEHOLDERS: Record<TemplateKind, string[]> = {
  INVOICE: ['client_name', 'firm_name', 'invoice_number', 'amount', 'due_date'],
  ESTIMATE: ['client_name', 'firm_name', 'estimate_number', 'amount'],
  RECEIPT: ['client_name', 'firm_name', 'invoice_number', 'amount'],
  CREDIT_NOTE: ['client_name', 'firm_name', 'credit_note_number', 'amount'],
  PAYMENT_REMINDER: ['client_name', 'firm_name', 'invoice_number', 'amount', 'due_date'],
  REFUND_CONFIRMATION: ['client_name', 'firm_name', 'amount'],
};
const SAMPLE_VALUES: Record<string, string> = {
  client_name: 'Sample Client',
  firm_name: 'Sample Riverside Tax Co',
  invoice_number: 'INV-0001',
  estimate_number: 'EST-0001',
  credit_note_number: 'CN-2026-0001',
  amount: '$250.00',
  due_date: '11/17/2026',
};
/** A template's text with the sample values in place of its placeholders. */
export const fillSample = (text: string): string =>
  text.replace(/\{([a-z_]+)\}/g, (match, name: string) => SAMPLE_VALUES[name] ?? match);

/** A uuid-shaped id for a new tax rate, unique among `taken`. */
export function newTaxRateId(taken: readonly string[]): string {
  for (let n = 101; ; n += 1) {
    const id = `0199d1a0-0b0b-7000-8000-${String(n).padStart(12, '0')}`;
    if (!taken.includes(id)) return id;
  }
}
