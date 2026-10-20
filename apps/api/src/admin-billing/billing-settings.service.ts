import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  BILLING_PAYMENT_TERM_DAYS,
  type BillingAdmin,
  type BillingDocumentKind,
  type BillingFirm,
  type BillingItem,
  BillingSettings,
  BillingTemplateKind,
  SaveBillingProfileRequest,
  UpdateBillingSettingsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  billingError,
  bps,
  loadFirms,
  loadTeam,
  nearestTerms,
  notFound,
  percent,
} from './billing-common.js';

type Settings = z.infer<typeof BillingSettings>;
type Reminders = Settings['reminders'];
type Templates = Settings['templates'];
type Preferences = Settings['preferences'];

/** The page's options the database does not store yet: what they read until it does. */
export const DEFAULT_PREFERENCES: Preferences = {
  language: 'en-US',
  timeZone: 'America/New_York',
  dateFormat: 'MM/DD/YYYY',
  enableCreditNotes: true,
  enableEstimates: true,
  requirePurchaseOrder: false,
  termsAndConditions: '',
  discountBeforeTax: true,
  onlinePaymentDefault: true,
  sendReceipts: true,
  requireRefundReason: true,
  taxMode: 'EXCLUSIVE',
  firmsMayOverride: true,
};

const DEFAULT_REMINDERS: Reminders = {
  invoiceDue: { enabled: true, days: 3 },
  overdue: { enabled: true, days: 1, repeatEveryDays: 7, maxReminders: 3 },
  estimateExpiring: { enabled: true, days: 3 },
  failedPayment: { enabled: true, days: 1 },
};

const TEMPLATE_DEFAULTS: Templates = {
  INVOICE: {
    name: 'Invoice',
    subject: 'Invoice {{number}} from Firmivra',
    body: 'Hello {{contact}},\n\nYour invoice {{number}} for {{amount}} is due on {{dueDate}}.\n\nThank you,\nFirmivra',
  },
  ESTIMATE: {
    name: 'Estimate',
    subject: 'Estimate {{number}} from Firmivra',
    body: 'Hello {{contact}},\n\nHere is estimate {{number}} for {{amount}}, valid until {{expirationDate}}.\n\nFirmivra',
  },
  RECEIPT: {
    name: 'Payment receipt',
    subject: 'Receipt for invoice {{number}}',
    body: 'Hello {{contact}},\n\nWe received your payment of {{amount}}. Thank you.\n\nFirmivra',
  },
  CREDIT_NOTE: {
    name: 'Credit note',
    subject: 'Credit note {{number}} from Firmivra',
    body: 'Hello {{contact}},\n\nA credit of {{amount}} is available on your account.\n\nFirmivra',
  },
  PAYMENT_REMINDER: {
    name: 'Payment reminder',
    subject: 'Reminder: invoice {{number}} is due',
    body: 'Hello {{contact}},\n\nInvoice {{number}} for {{amount}} is due on {{dueDate}}.\n\nFirmivra',
  },
  REFUND_CONFIRMATION: {
    name: 'Refund confirmation',
    subject: 'Your refund of {{amount}}',
    body: 'Hello {{contact}},\n\nWe refunded {{amount}} to your original payment method.\n\nFirmivra',
  },
};

/** The stored reminders: this contract's shape, or the seed's `beforeDueDays` / `afterDueDays`. */
export function remindersOf(json: Prisma.JsonValue): Reminders {
  const parsed = BillingSettings.shape.reminders.safeParse(json);
  if (parsed.success) return parsed.data;
  const o = (json ?? {}) as { beforeDueDays?: unknown; afterDueDays?: unknown };
  const before = Array.isArray(o.beforeDueDays)
    ? o.beforeDueDays.filter((n) => typeof n === 'number')
    : [];
  const after = Array.isArray(o.afterDueDays)
    ? o.afterDueDays.filter((n) => typeof n === 'number')
    : [];
  if (before.length === 0 && after.length === 0) return DEFAULT_REMINDERS;
  return {
    ...DEFAULT_REMINDERS,
    invoiceDue: {
      enabled: before.length > 0,
      days: before[0] ?? DEFAULT_REMINDERS.invoiceDue.days,
    },
    overdue: {
      enabled: after.length > 0,
      days: after[0] ?? 1,
      repeatEveryDays: Math.max(1, Math.min(90, (after[1] ?? 0) - (after[0] ?? 0) || 7)),
      maxReminders: Math.max(1, Math.min(12, after.length || 3)),
    },
  };
}

export function templatesOf(json: Prisma.JsonValue): Templates {
  const stored = (json && typeof json === 'object' && !Array.isArray(json) ? json : {}) as Record<
    string,
    unknown
  >;
  const out = {} as Templates;
  for (const kind of BillingTemplateKind.options) {
    const one = BillingSettings.shape.templates.valueType.safeParse(stored[kind]);
    out[kind] = one.success ? one.data : TEMPLATE_DEFAULTS[kind];
  }
  return out;
}

const KINDS: Record<BillingDocumentKind, 'INVOICE' | 'ESTIMATE' | 'CREDIT_NOTE'> = {
  invoice: 'INVOICE',
  estimate: 'ESTIMATE',
  creditNote: 'CREDIT_NOTE',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Billing's reference data and settings (R60 on R0's B3): the firms Firmivra bills with their
 * billing profiles, the team, the plans as items, the next document numbers, and the platform
 * Billing Settings. Every change writes a platform audit row.
 */
@Injectable()
export class BillingSettingsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  firms(): Promise<BillingFirm[]> {
    return this.admin.transaction(async (tx) => [...(await loadFirms(tx)).values()]);
  }

  firm(id: string): Promise<BillingFirm> {
    return this.admin.transaction(async (tx) => {
      const firm = (await loadFirms(tx, id)).get(id);
      if (!firm) throw notFound('Firm');
      return firm;
    });
  }

  saveProfile(id: string, body: z.output<typeof SaveBillingProfileRequest>): Promise<BillingFirm> {
    return this.admin.transaction(async (tx) => {
      const firm = (await loadFirms(tx, id)).get(id);
      if (!firm) throw notFound('Firm');
      const data = {
        billingContactName: body.contactName,
        billingContactEmail: body.contactEmail.toLowerCase(),
        paymentTermDays: body.paymentTermDays,
        taxExempt: body.taxExempt,
        taxRateBps: body.taxPercent === null ? null : bps(body.taxPercent),
        autoPay: body.autoPay,
        notes: body.notes || null,
        updatedByUserId: this.admin.adminUserId,
      };
      await tx.platformFirmBillingProfile.upsert({
        where: { businessId: id },
        create: { businessId: id, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        firm.hasProfile ? 'billing_profile.updated' : 'billing_profile.created',
        { type: 'billing_profile', id },
        { businessId: id, taxExempt: body.taxExempt, autoPay: body.autoPay },
        { businessId: null },
      );
      return (await loadFirms(tx, id)).get(id)!;
    });
  }

  admins(): Promise<BillingAdmin[]> {
    return this.admin.transaction(async (tx) => (await loadTeam(tx)).admins);
  }

  /** The active plans, for the Item / Service pickers. */
  async items(): Promise<BillingItem[]> {
    const plans = await this.admin.db.platformPlan.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    const cycle = { MONTHLY: 'Monthly', ANNUAL: 'Annual' } as Record<string, string>;
    return plans.map((p) => ({
      id: p.id,
      name: `${p.name} plan`,
      description: `${cycle[p.billingCycle] ?? p.billingCycle} subscription, ${p.includedSeats} seats included`,
      unitPriceCents: p.basePriceCents,
    }));
  }

  async nextNumber(kind: BillingDocumentKind): Promise<{ number: string }> {
    const counter = await this.admin.db.platformBillingCounter.findUnique({
      where: { docType: KINDS[kind] },
    });
    if (!counter) throw notFound('Counter');
    return { number: `${counter.prefix}${counter.lastNumber + 1}` };
  }

  settings(): Promise<Settings> {
    return this.admin.transaction((tx) => this.read(tx));
  }

  async read(tx: TxClient): Promise<Settings> {
    const [row, counters, team] = await Promise.all([
      tx.platformBillingSettings.findUnique({ where: { id: 1 } }),
      tx.platformBillingCounter.findMany(),
      loadTeam(tx),
    ]);
    const counter = (t: string) => {
      const c = counters.find((x) => x.docType === t);
      return { prefix: c?.prefix ?? '', next: (c?.lastNumber ?? 1000) + 1 };
    };
    const lateBps = row?.lateFeeBps ?? 0;
    return {
      general: {
        currency: 'USD',
        invoiceTerms: nearestTerms(row?.defaultPaymentTermDays ?? 30),
        estimateValidityDays: row?.estimateValidDays ?? 30,
        enablePartialPayments: row?.allowPartialPayments ?? true,
        footerNote: row?.invoiceFooter ?? '',
      },
      taxes: {
        defaultTaxPercent: percent(row?.defaultTaxRateBps ?? 0),
        lateFee: {
          enabled: lateBps > 0,
          percent: percent(lateBps),
          graceDays: row?.lateFeeGraceDays ?? 0,
        },
      },
      reminders: remindersOf(row?.reminders ?? {}),
      templates: templatesOf(row?.templates ?? {}),
      numbering: {
        invoice: counter('INVOICE'),
        estimate: counter('ESTIMATE'),
        creditNote: counter('CREDIT_NOTE'),
      },
      preferences: DEFAULT_PREFERENCES,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedByUserId ? team.nameOf(row.updatedByUserId) : null,
    };
  }

  update(body: z.output<typeof UpdateBillingSettingsRequest>): Promise<Settings> {
    return this.admin.transaction(async (tx) => {
      if (!same(body.preferences, DEFAULT_PREFERENCES))
        throw billingError(422, 'NOT_SUPPORTED_YET', 'These billing options cannot be saved yet');
      if (body.taxes.lateFee.enabled && body.taxes.lateFee.percent <= 0)
        throw billingError(400, 'VALIDATION_FAILED', 'Enter the late fee percent');
      const data = {
        currency: 'usd',
        defaultPaymentTermDays: BILLING_PAYMENT_TERM_DAYS[body.general.invoiceTerms],
        estimateValidDays: body.general.estimateValidityDays,
        allowPartialPayments: body.general.enablePartialPayments,
        invoiceFooter: body.general.footerNote || null,
        defaultTaxRateBps: bps(body.taxes.defaultTaxPercent),
        lateFeeBps: body.taxes.lateFee.enabled ? bps(body.taxes.lateFee.percent) : 0,
        lateFeeGraceDays: body.taxes.lateFee.graceDays,
        reminders: body.reminders as Prisma.InputJsonValue,
        templates: body.templates as Prisma.InputJsonValue,
        updatedByUserId: this.admin.adminUserId,
      };
      await tx.platformBillingSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        'billing_settings.updated',
        { type: 'billing_settings' },
        { terms: body.general.invoiceTerms, partialPayments: body.general.enablePartialPayments },
        { businessId: null },
      );
      return this.read(tx);
    });
  }
}
