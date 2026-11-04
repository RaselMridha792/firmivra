import {
  ApiRequestError,
  type InvoiceTaxRate,
  type InvoiceTemplateView,
  type DepositAccount,
  type PaymentPreferences,
  type PaymentPreferencesClient,
  ResetPaymentPreferencesRequest,
  SaveDepositAccountRequest,
  SaveInvoiceTaxRateRequest,
  SaveInvoiceTemplateRequest,
  UpdatePaymentPreferencesRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/** Every option off, as the API answers a firm that never saved (IP-F13). */
const defaults = (): PaymentPreferences => ({
  invoiceDefaults: {
    invoicePrefix: 'INV-',
    defaultTerms: 'net_14',
    defaultMemo: null,
    customTermDays: [],
  },
  reminders: {
    sendReminders: false,
    reminderDaysBefore: 3,
    notifyOverdue: false,
    overdueReminderDays: 7,
    autoReceipts: false,
    autoApplyPayments: false,
    retryAttempts: 0,
    retryIntervalDays: 3,
  },
  taxesAndFees: {
    lateFeeEnabled: false,
    lateFeeType: null,
    lateFeePercent: null,
    lateFeeCents: null,
    tippingEnabled: false,
    requirePaymentBeforeDue: false,
  },
  updatedAt: null,
});

/** The latest mock's live tax rates, templates and settings, for the invoice mock (IP-F03, F04). */
let live:
  | {
      taxes: () => InvoiceTaxRate[];
      templates: () => InvoiceTemplateView[];
      prefs: () => PaymentPreferences;
      accounts: () => DepositAccount[];
    }
  | undefined;
export const mockLiveTaxRate = (id: string) => live?.taxes().find((t) => t.id === id);
export const mockLiveTemplate = (id: string) => live?.templates().find((t) => t.id === id);
export const mockLivePreferences = () => live?.prefs() ?? defaults();
export const mockLiveDepositAccount = (id: string) => live?.accounts().find((a) => a.id === id);

/** `api.paymentPreferences` in mock mode (synthetic), with the API's stale-save check. */
export function createPaymentPreferencesMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): PaymentPreferencesClient {
  let prefs = defaults();
  let taxes: InvoiceTaxRate[] = [];
  let templates: InvoiceTemplateView[] = [];
  let accounts: DepositAccount[] = [];
  live = {
    taxes: () => taxes,
    templates: () => templates,
    prefs: () => prefs,
    accounts: () => accounts,
  };
  let n = 0;
  const id = () => `01a1a000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
  const guard = async () => {
    await mockDelay();
    if (options.role === 'STAFF')
      throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const fresh = (updatedAt: string | null) => {
    if (updatedAt !== prefs.updatedAt)
      throw new ApiRequestError(
        409,
        'SAVE_CONFLICT',
        'Someone else saved these settings. Reload to see their changes.',
      );
  };
  const named = <T extends { id: string; name: string }>(
    list: T[],
    name: string,
    self?: string,
  ) => {
    if (list.some((x) => x.name === name && x.id !== self))
      throw new ApiRequestError(409, 'NAME_TAKEN', 'A record with this name already exists.');
  };
  return {
    get: async () => (await guard(), structuredClone(prefs)),
    update: async (body) => {
      await guard();
      const { updatedAt, ...sections } = UpdatePaymentPreferencesRequest.parse(body);
      fresh(updatedAt);
      const days = [...sections.invoiceDefaults.customTermDays].sort((a, b) => a - b);
      prefs = {
        ...sections,
        invoiceDefaults: { ...sections.invoiceDefaults, customTermDays: days },
        updatedAt: new Date().toISOString(),
      };
      return structuredClone(prefs);
    },
    reset: async (body) => {
      await guard();
      fresh(ResetPaymentPreferencesRequest.parse(body).updatedAt);
      prefs = { ...defaults(), updatedAt: new Date().toISOString() };
      return structuredClone(prefs);
    },
    taxRates: async () => (await guard(), { items: structuredClone(taxes) }),
    createTaxRate: async (body) => {
      await guard();
      const b = SaveInvoiceTaxRateRequest.parse(body);
      named(taxes, b.name);
      if (b.isDefault) taxes = taxes.map((t) => ({ ...t, isDefault: false }));
      const row = { id: id(), ...b };
      taxes.push(row);
      return row;
    },
    updateTaxRate: async (taxId, body) => {
      await guard();
      const b = SaveInvoiceTaxRateRequest.parse(body);
      named(taxes, b.name, taxId);
      taxes = taxes.map((t) =>
        t.id === taxId ? { ...t, ...b } : b.isDefault ? { ...t, isDefault: false } : t,
      );
      const row = taxes.find((t) => t.id === taxId);
      if (!row) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      return row;
    },
    archiveTaxRate: async (taxId) => {
      await guard();
      taxes = taxes.filter((t) => t.id !== taxId);
      return { items: structuredClone(taxes) };
    },
    depositAccounts: async () => (await guard(), { items: structuredClone(accounts) }),
    createDepositAccount: async (body) => {
      await guard();
      const b = SaveDepositAccountRequest.parse(body);
      named(accounts, b.name);
      if (b.isDefault) accounts = accounts.map((a) => ({ ...a, isDefault: false }));
      const row = { id: id(), ...b };
      accounts.push(row);
      return row;
    },
    updateDepositAccount: async (accountId, body) => {
      await guard();
      const b = SaveDepositAccountRequest.parse(body);
      named(accounts, b.name, accountId);
      accounts = accounts.map((a) =>
        a.id === accountId ? { ...a, ...b } : b.isDefault ? { ...a, isDefault: false } : a,
      );
      const row = accounts.find((a) => a.id === accountId);
      if (!row) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      return row;
    },
    archiveDepositAccount: async (accountId) => {
      await guard();
      accounts = accounts.filter((a) => a.id !== accountId);
      return { items: structuredClone(accounts) };
    },
    templates: async () => (await guard(), { items: structuredClone(templates) }),
    createTemplate: async (body) => {
      await guard();
      const b = SaveInvoiceTemplateRequest.parse(body);
      named(templates, b.name);
      if (b.isDefault) templates = templates.map((t) => ({ ...t, isDefault: false }));
      const row = { id: id(), ...b };
      templates.push(row);
      return row;
    },
    updateTemplate: async (templateId, body) => {
      await guard();
      const b = SaveInvoiceTemplateRequest.parse(body);
      named(templates, b.name, templateId);
      templates = templates.map((t) =>
        t.id === templateId ? { ...t, ...b } : b.isDefault ? { ...t, isDefault: false } : t,
      );
      const row = templates.find((t) => t.id === templateId);
      if (!row) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      return row;
    },
    archiveTemplate: async (templateId) => {
      await guard();
      templates = templates.filter((t) => t.id !== templateId);
      return { items: structuredClone(templates) };
    },
  };
}
