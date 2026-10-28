import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';

// Settings > Payments' billing sections (Octavia's Invoices & Payments review of Oct 27, IP-F13):
// Invoice Defaults, Reminders & Automations, and Taxes & Fees, on the firm's one canonical store
// (`payment_settings`, `invoice_tax_rates`, `invoice_templates`). Owner and Admin. A firm that
// never saved has every option off (IP-F04, IP-F12: nothing is on by default).

const DateTime = z.iso.datetime({ offset: true });

/** Payment terms (IP-F02): the due date counts from the invoice's issue. */
export const PaymentTerm = z.enum(['due_on_receipt', 'net_7', 'net_14', 'net_30']);
export type PaymentTerm = z.infer<typeof PaymentTerm>;
export const PAYMENT_TERM_LABELS: Record<PaymentTerm, string> = {
  due_on_receipt: 'Due on Receipt',
  net_7: 'Net 7',
  net_14: 'Net 14',
  net_30: 'Net 30',
};
/** Days from issue to due for each term. */
export const PAYMENT_TERM_DAYS: Record<PaymentTerm, number> = {
  due_on_receipt: 0,
  net_7: 7,
  net_14: 14,
  net_30: 30,
};

const InvoiceDefaults = z.object({
  /** "INV-": letters, digits and hyphens, up to 10. */
  invoicePrefix: z
    .string()
    .regex(/^[A-Za-z0-9-]{0,10}$/, 'Use up to 10 letters, digits or hyphens'),
  defaultTerms: PaymentTerm,
  defaultMemo: z.string().max(500, 'Use 500 characters or fewer').nullable(),
});
const Reminders = z.object({
  sendReminders: z.boolean(),
  /** Days before the due date (0: on the day). */
  reminderDaysBefore: z.number().int().min(0).max(60),
  notifyOverdue: z.boolean(),
  /** Repeat the overdue reminder every this many days (0: once). */
  overdueReminderDays: z.number().int().min(0).max(90),
  /** A receipt goes out by itself after each successful payment (IP-F12). */
  autoReceipts: z.boolean(),
  /** A client's payment pays their oldest open invoice first when it names none. */
  autoApplyPayments: z.boolean(),
  /** AutoPay retries after a failed charge, where the provider supports them. */
  retryAttempts: z.number().int().min(0).max(10),
  retryIntervalDays: z.number().int().min(1).max(14),
});
const TaxesAndFees = z.object({
  lateFeeEnabled: z.boolean(),
  lateFeeType: z.enum(['PERCENT', 'FIXED']).nullable(),
  /** Percent of the balance (0.01 to 100) for PERCENT; null otherwise. */
  lateFeePercent: z.number().gt(0).max(100).nullable(),
  /** Cents for FIXED; null otherwise. */
  lateFeeCents: z.number().int().positive().max(100_000_00).nullable(),
  /** Clients may add a tip, on invoices that allow it. */
  tippingEnabled: z.boolean(),
  /** Invoices may require payment before the due date. */
  requirePaymentBeforeDue: z.boolean(),
});

export const PaymentPreferences = z.object({
  invoiceDefaults: InvoiceDefaults,
  reminders: Reminders,
  taxesAndFees: TaxesAndFees,
  /** Null until the firm saves: the defaults above are what it gets. Send it back to save. */
  updatedAt: DateTime.nullable(),
});
export type PaymentPreferences = z.infer<typeof PaymentPreferences>;

const lateFeeRule = (
  fees: Partial<z.infer<typeof TaxesAndFees>> | undefined,
  ctx: z.RefinementCtx,
) => {
  if (!fees) return;
  const { lateFeeEnabled, lateFeeType, lateFeePercent, lateFeeCents } = fees;
  if (lateFeeEnabled && !lateFeeType)
    ctx.addIssue({
      code: 'custom',
      path: ['taxesAndFees', 'lateFeeType'],
      message: 'Choose a percentage or a fixed amount',
    });
  if (lateFeeType === 'PERCENT' && lateFeePercent == null)
    ctx.addIssue({
      code: 'custom',
      path: ['taxesAndFees', 'lateFeePercent'],
      message: 'Enter the late fee percentage',
    });
  if (lateFeeType === 'FIXED' && lateFeeCents == null)
    ctx.addIssue({
      code: 'custom',
      path: ['taxesAndFees', 'lateFeeCents'],
      message: 'Enter the late fee amount',
    });
};

/** PATCH: the three sections whole (the screen saves them together), and the `updatedAt` read. */
export const UpdatePaymentPreferencesRequest = z
  .strictObject({
    invoiceDefaults: InvoiceDefaults.strict(),
    reminders: Reminders.strict(),
    taxesAndFees: TaxesAndFees.strict(),
    /** What GET answered; a newer save in between is 409 SAVE_CONFLICT. */
    updatedAt: DateTime.nullable(),
  })
  .superRefine((body, ctx) => lateFeeRule(body.taxesAndFees, ctx));
export type UpdatePaymentPreferencesRequest = z.input<typeof UpdatePaymentPreferencesRequest>;

/** POST .../reset: back to the defaults (every option off), after the screen's confirmation. */
export const ResetPaymentPreferencesRequest = z.strictObject({ updatedAt: DateTime.nullable() });
export type ResetPaymentPreferencesRequest = z.input<typeof ResetPaymentPreferencesRequest>;

// ---------- Taxes (invoice_tax_rates) ----------
export const InvoiceTaxRate = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Basis points: 825 is 8.25%. */
  rateBps: z.number().int().min(0).max(10_000),
  isDefault: z.boolean(),
});
export type InvoiceTaxRate = z.infer<typeof InvoiceTaxRate>;
export const InvoiceTaxRateList = z.object({ items: z.array(InvoiceTaxRate) });
export const SaveInvoiceTaxRateRequest = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name').max(60, 'Use 60 characters or fewer'),
  rateBps: z.number().int().min(0, 'Use 0% to 100%').max(10_000, 'Use 0% to 100%'),
  isDefault: z.boolean().optional().default(false),
});
export type SaveInvoiceTaxRateRequest = z.input<typeof SaveInvoiceTaxRateRequest>;

// ---------- Templates (invoice_templates) ----------
export const InvoiceTemplateView = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  memo: z.string().nullable(),
  footer: z.string().nullable(),
  showLogo: z.boolean(),
  isDefault: z.boolean(),
});
export type InvoiceTemplateView = z.infer<typeof InvoiceTemplateView>;
export const InvoiceTemplateList = z.object({ items: z.array(InvoiceTemplateView) });
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);
export const SaveInvoiceTemplateRequest = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Use 80 characters or fewer'),
  description: Optional(200),
  memo: Optional(500),
  footer: Optional(500),
  showLogo: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});
export type SaveInvoiceTemplateRequest = z.input<typeof SaveInvoiceTemplateRequest>;

const BASE = '/business/settings/payment-preferences';

/** `api.paymentPreferences` (apps/web/src/lib/api.ts): Owner and Admin. */
export function createPaymentPreferencesClient(request: ApiRequest) {
  const json = (method: string, body: unknown) => ({ method, body });
  return {
    get: async (): Promise<PaymentPreferences> => request(PaymentPreferences, BASE),
    update: async (body: UpdatePaymentPreferencesRequest): Promise<PaymentPreferences> =>
      request(
        PaymentPreferences,
        BASE,
        json('PATCH', parseInput(UpdatePaymentPreferencesRequest, body)),
      ),
    reset: async (body: ResetPaymentPreferencesRequest): Promise<PaymentPreferences> =>
      request(
        PaymentPreferences,
        `${BASE}/reset`,
        json('POST', parseInput(ResetPaymentPreferencesRequest, body)),
      ),
    taxRates: async () => request(InvoiceTaxRateList, `${BASE}/tax-rates`),
    createTaxRate: async (body: SaveInvoiceTaxRateRequest) =>
      request(
        InvoiceTaxRate,
        `${BASE}/tax-rates`,
        json('POST', parseInput(SaveInvoiceTaxRateRequest, body)),
      ),
    updateTaxRate: async (id: string, body: SaveInvoiceTaxRateRequest) =>
      request(
        InvoiceTaxRate,
        `${BASE}/tax-rates/${encodeURIComponent(id)}`,
        json('PUT', parseInput(SaveInvoiceTaxRateRequest, body)),
      ),
    archiveTaxRate: async (id: string) =>
      request(
        InvoiceTaxRateList,
        `${BASE}/tax-rates/${encodeURIComponent(id)}/archive`,
        json('POST', {}),
      ),
    templates: async () => request(InvoiceTemplateList, `${BASE}/templates`),
    createTemplate: async (body: SaveInvoiceTemplateRequest) =>
      request(
        InvoiceTemplateView,
        `${BASE}/templates`,
        json('POST', parseInput(SaveInvoiceTemplateRequest, body)),
      ),
    updateTemplate: async (id: string, body: SaveInvoiceTemplateRequest) =>
      request(
        InvoiceTemplateView,
        `${BASE}/templates/${encodeURIComponent(id)}`,
        json('PUT', parseInput(SaveInvoiceTemplateRequest, body)),
      ),
    archiveTemplate: async (id: string) =>
      request(
        InvoiceTemplateList,
        `${BASE}/templates/${encodeURIComponent(id)}/archive`,
        json('POST', {}),
      ),
  };
}
export type PaymentPreferencesClient = ReturnType<typeof createPaymentPreferencesClient>;
