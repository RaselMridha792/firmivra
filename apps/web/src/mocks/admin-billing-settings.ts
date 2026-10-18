import { ApiRequestError } from '@firmivra/types';
import { mockDelay, mocked } from '../lib/mock';
import {
  adminBilling,
  hasErrors,
  settingsErrors,
  TEMPLATE_KINDS,
  type BillingSettings,
  type FormErrors,
} from './admin-billing';

/**
 * Billing Settings (S01, docx §15) on top of `adminBilling.settings` / `updateSettings`: the
 * platform defaults behind each tab's "Reset to defaults", and the checks `settingsErrors` leaves
 * out, applied again on save like a server would. No API yet: same switch as admin-billing.ts
 * (NEXT_PUBLIC_API_MOCK=adminBilling or all); outside mock mode every call fails like an
 * unreachable API. Synthetic data only.
 */
const MODULE = 'adminBilling';

async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}

/** Template bodies longer than this are refused. */
export const TEMPLATE_BODY_MAX = 2000;

/**
 * Every Billing Settings field message, keyed by path ("taxes.rates.0.name"): the mock's
 * `settingsErrors` plus the rules it leaves out (attachment types, the default tax rate, the
 * overdue cadence, tax rate names, template names and bodies).
 */
export function billingSettingsErrors(next: BillingSettings): FormErrors {
  const fields = { ...settingsErrors(next).fields };
  const { invoices, taxes, reminders, templates } = next;
  if (invoices.allowAttachments && invoices.attachmentTypes.length === 0)
    fields['invoices.attachmentTypes'] = 'Keep at least one file type';
  if (
    invoices.defaultTaxRateId !== null &&
    !taxes.rates.some((rate) => rate.id === invoices.defaultTaxRateId)
  )
    fields['invoices.defaultTaxRateId'] = 'Choose a tax rate from the list';
  const names = new Set<string>();
  taxes.rates.forEach((rate, index) => {
    const name = rate.name.trim().toLowerCase();
    if (name && names.has(name))
      fields[`taxes.rates.${index}.name`] ??= 'Another tax rate has this name';
    names.add(name);
  });
  if (!(reminders.overdue.repeatEveryDays >= 1 && reminders.overdue.repeatEveryDays <= 30))
    fields['reminders.overdue.repeatEveryDays'] = 'Enter 1 to 30 days';
  if (!(
    Number.isInteger(reminders.overdue.maxReminders) &&
    reminders.overdue.maxReminders >= 1 &&
    reminders.overdue.maxReminders <= 10
  ))
    fields['reminders.overdue.maxReminders'] = 'Enter 1 to 10 reminders';
  for (const kind of TEMPLATE_KINDS) {
    const template = templates[kind];
    if (!template.name.trim()) fields[`templates.${kind}.name`] = 'Name the template';
    if (!template.body.trim()) fields[`templates.${kind}.body`] = 'Enter the message';
    else if (template.body.length > TEMPLATE_BODY_MAX)
      fields[`templates.${kind}.body`] = `Use ${TEMPLATE_BODY_MAX} characters or fewer`;
  }
  return { fields, lines: [] };
}

// Firmivra's shipped defaults: the settings as the mock first served them (kept on first use).
let shipped: BillingSettings | undefined;

export const adminBillingSettings = {
  /** The platform defaults each tab's "Reset to defaults" restores. */
  defaults: async (): Promise<BillingSettings> => {
    const current = await adminBilling.settings();
    shipped ??= current;
    return structuredClone(shipped);
  },
  /** Checks every rule, then saves the whole settings object (adminBilling.updateSettings). */
  save: async (next: BillingSettings): Promise<BillingSettings> => {
    await ready();
    const errors = billingSettingsErrors(next);
    if (hasErrors(errors)) {
      const first = Object.values(errors.fields).find(Boolean) ?? 'Some details need fixing';
      throw new ApiRequestError(400, 'VALIDATION_FAILED', first);
    }
    return adminBilling.updateSettings(next);
  },
};
