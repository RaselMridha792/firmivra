import { z } from 'zod';
import { BillingInvoiceStatus, BillingPaymentMethod } from '../admin-billing/schemas.js';
import { SubscriptionBillingCycle, SubscriptionStatus } from '../admin-subscriptions/schemas.js';
import { Email } from '../auth/schemas.js';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { SupportTicketStatus } from '../db-enums.js';
import { ticketText } from './ticket-text.js';

// Settings > Billing & Subscriptions, the firm's side (Octavia's Billing guide of Oct 18): the
// firm's own Firmivra subscription as Firmivra bills it, read from the platform's rows that the
// firm may read and never write (R0's policies: its subscription, the plans, its issued invoices
// with their lines and payments, its billing profile). A plan change or new billing contact is a
// request to Firmivra's Super Admin team through the support-request flow, as Company Profile's
// Request Change (R60, following Rasel's default of Oct 24); nothing changes until Firmivra
// applies it. Card payments to Firmivra are not set up, so no payment method is stored or shown.
// API: /api/v1/business/billing. Owner and Admin. Responses are plain objects; requests are strict.

const Id = z.uuid();
const Day = z.iso.date();
const DateTime = z.iso.datetime({ offset: true });
const Cents = z.number().int();
const Count = z.number().int().min(0);

/** A plan of the ladder, as the firm compares them. Prices are per the plan's billing cycle. */
export const FirmBillingPlan = z.object({
  /** SOLO_CORE, TEAM_PRO, ...: the same in every environment. */
  code: z.string(),
  name: z.string(),
  priceCents: Cents,
  billingCycle: SubscriptionBillingCycle,
  includedSeats: Count,
  /** null: no fixed ceiling. */
  maxSeats: Count.nullable(),
  /** Each seat above the included ones; null: the plan sells none. */
  seatPriceCents: Cents.nullable(),
  includedLocations: Count,
  /** Each location above the included ones; null: the plan sells none. */
  locationPriceCents: Cents.nullable(),
  features: z.array(z.object({ key: z.string(), label: z.string() })),
});
export type FirmBillingPlan = z.infer<typeof FirmBillingPlan>;

/** The firm's subscription, as Firmivra bills it. */
export const FirmBillingSubscription = z.object({
  status: SubscriptionStatus,
  plan: FirmBillingPlan,
  billingCycle: SubscriptionBillingCycle,
  /** What the firm pays per cycle: a negotiated base price, and extra seats and locations. */
  priceCents: Cents,
  currency: z.string(),
  seatsAllowed: Count,
  locationsAllowed: Count,
  periodStart: Day.nullable(),
  periodEnd: Day.nullable(),
  /** The next invoice: only while it renews (Active or Past Due with renewal on). */
  nextBillingOn: Day.nullable(),
  trialEndsOn: Day.nullable(),
  /** When access ends: non-renewing, a trial without renewal, expired or canceled. */
  accessEndsOn: Day.nullable(),
  autoRenew: z.boolean(),
});
export type FirmBillingSubscription = z.infer<typeof FirmBillingSubscription>;

/** One measure against the plan. `allowed` null: no limit (or no subscription). */
export const FirmBillingUsage = z.object({ used: Count, allowed: Count.nullable() });
export type FirmBillingUsage = z.infer<typeof FirmBillingUsage>;

/** A plan the firm may ask to move to, with its direction and what blocks it now. */
export const FirmBillingPlanChoice = FirmBillingPlan.extend({
  direction: z.enum(['CURRENT', 'UPGRADE', 'DOWNGRADE']),
  /** Why it cannot be asked for now ("8 active staff users; this plan allows 5"). Empty: it can. */
  blockers: z.array(z.string()),
});
export type FirmBillingPlanChoice = z.infer<typeof FirmBillingPlanChoice>;

export const FirmBillingRequestKind = z.enum(['PLAN_CHANGE', 'BILLING_CONTACT']);
export type FirmBillingRequestKind = z.infer<typeof FirmBillingRequestKind>;

/** A request to Firmivra (a support ticket), as the firm follows it. */
export const FirmBillingRequest = z.object({
  id: Id,
  /** The support ticket's number ("#1004"). */
  number: z.string(),
  kind: FirmBillingRequestKind,
  /** "Plan change: Team Pro to Practice Plus (Monthly)" or "Billing contact". */
  summary: z.string(),
  status: SupportTicketStatus,
  submittedAt: DateTime,
  submittedBy: z.string(),
  /** Firmivra's latest reply sent to the firm; null until there is one. */
  latestReply: z.object({ body: z.string(), at: DateTime }).nullable(),
});
export type FirmBillingRequest = z.infer<typeof FirmBillingRequest>;

/** GET /business/billing: every card of the page. */
export const FirmBillingOverview = z.object({
  /** null: no subscription is connected to the firm yet (every plan card says so). */
  subscription: FirmBillingSubscription.nullable(),
  usage: z.object({
    /** Active staff users (Owner, Admin and Staff). */
    seats: FirmBillingUsage,
    /** Active locations (Settings > Locations). */
    locations: FirmBillingUsage,
    pendingInvitations: Count,
    measuredAt: DateTime,
  }),
  billingDetails: z.object({
    companyName: z.string(),
    legalName: z.string().nullable(),
    /** The billing contact Firmivra keeps; null until Firmivra records one. */
    contactName: z.string().nullable(),
    contactEmail: z.string().nullable(),
    /** The company's address (Company Profile), line by line; empty when none. */
    address: z.array(z.string()),
    paymentTermDays: Count.nullable(),
  }),
  /** The latest payment Firmivra recorded; null when none. */
  lastPayment: z
    .object({
      method: BillingPaymentMethod,
      amountCents: Cents,
      paidOn: Day,
      invoiceNumber: z.string(),
    })
    .nullable(),
  /** The active plans, cheapest first, for Upgrade and Downgrade. */
  plans: z.array(FirmBillingPlanChoice),
  /** The firm's billing requests, newest first. */
  requests: z.array(FirmBillingRequest).max(10),
});
export type FirmBillingOverview = z.infer<typeof FirmBillingOverview>;

export const FirmBillingInvoiceRange = z.enum(['3M', '6M', '12M', 'ALL']);
export type FirmBillingInvoiceRange = z.infer<typeof FirmBillingInvoiceRange>;
export const FIRM_BILLING_INVOICE_RANGE_LABELS: Readonly<Record<FirmBillingInvoiceRange, string>> =
  {
    '3M': 'Last 3 months',
    '6M': 'Last 6 months',
    '12M': 'Last 12 months',
    ALL: 'All invoices',
  };

/** GET /business/billing/invoices: newest first, by invoice date. */
export const FirmBillingInvoicesQuery = z.strictObject({
  range: FirmBillingInvoiceRange.optional().default('6M'),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(10),
});
export type FirmBillingInvoicesQuery = z.input<typeof FirmBillingInvoicesQuery>;

export const FirmBillingInvoiceRow = z.object({
  id: Id,
  /** "INV-1026". */
  number: z.string(),
  invoiceDate: Day,
  dueDate: Day,
  periodStart: Day.nullable(),
  periodEnd: Day.nullable(),
  totalCents: Cents,
  /** What is still owed: total less paid and credited. */
  balanceCents: Cents,
  currency: z.string(),
  status: BillingInvoiceStatus,
});
export type FirmBillingInvoiceRow = z.infer<typeof FirmBillingInvoiceRow>;

export const FirmBillingInvoicePage = z.object({
  items: z.array(FirmBillingInvoiceRow).max(50),
  total: Count,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type FirmBillingInvoicePage = z.infer<typeof FirmBillingInvoicePage>;

/** GET /business/billing/invoices/{id}: one invoice with its lines and payments. */
export const FirmBillingInvoice = FirmBillingInvoiceRow.extend({
  billTo: z.object({ name: z.string(), email: z.string() }),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPriceCents: Cents,
      amountCents: Cents,
    }),
  ),
  subtotalCents: Cents,
  discountCents: Cents,
  taxCents: Cents,
  paidCents: Cents,
  creditedCents: Cents,
  refundedCents: Cents,
  notes: z.string().nullable(),
  payments: z.array(
    z.object({
      paidOn: Day,
      amountCents: Cents,
      method: BillingPaymentMethod,
      status: z.string(),
    }),
  ),
});
export type FirmBillingInvoice = z.infer<typeof FirmBillingInvoice>;

const RequestId = z.uuid();

/**
 * POST /business/billing/requests: ask Firmivra for a plan change (a plan from `plans` with no
 * blockers, or the current plan on the other cycle) or a new billing contact. The same
 * `requestId` again answers the first request.
 */
export const CreateFirmBillingRequest = z.discriminatedUnion('kind', [
  z.strictObject({
    requestId: RequestId,
    kind: z.literal('PLAN_CHANGE'),
    planCode: z.string().trim().min(1, 'Choose a plan').max(60),
    billingCycle: SubscriptionBillingCycle,
    note: ticketText(2000, 'many').optional(),
  }),
  z
    .strictObject({
      requestId: RequestId,
      kind: z.literal('BILLING_CONTACT'),
      contactName: ticketText(120).optional(),
      contactEmail: Email.optional(),
      note: ticketText(2000, 'many').optional(),
    })
    .refine((b) => b.contactName !== undefined || b.contactEmail !== undefined, {
      message: 'Enter a new contact name or email',
      path: ['contactName'],
    }),
]);
export type CreateFirmBillingRequest = z.input<typeof CreateFirmBillingRequest>;

const BASE = '/business/billing';

/**
 * `api.firmBilling` (apps/web/src/lib/api.ts): Settings > Billing & Subscriptions. Owner and Admin
 * only (403 for staff). `baseUrl` ('/api/v1' in the browser) prefixes the PDF download link.
 */
export function createFirmBillingClient(request: ApiRequest, baseUrl = '') {
  const invoicePath = (id: string) => `${BASE}/invoices/${parseInput(Id, id)}`;
  return {
    overview: async (): Promise<FirmBillingOverview> => request(FirmBillingOverview, BASE),
    invoices: async (query: FirmBillingInvoicesQuery = {}): Promise<FirmBillingInvoicePage> =>
      request(
        FirmBillingInvoicePage,
        `${BASE}/invoices${toQuery(parseInput(FirmBillingInvoicesQuery, query))}`,
      ),
    /** 404 for another firm's invoice or a draft. */
    invoice: async (id: string): Promise<FirmBillingInvoice> =>
      request(FirmBillingInvoice, invoicePath(id)),
    /** The invoice's PDF, to download (same site, signed-in cookie). */
    invoicePdfUrl: (id: string): string => `${baseUrl}${invoicePath(id)}/pdf`,
    /**
     * 409 PLAN_NOT_AVAILABLE for a plan that is inactive, the current one on the same cycle, or
     * blocked by usage (`details` say why); 409 NO_SUBSCRIPTION for a plan change with none.
     */
    request: async (body: CreateFirmBillingRequest): Promise<FirmBillingRequest> =>
      request(FirmBillingRequest, `${BASE}/requests`, {
        method: 'POST',
        body: parseInput(CreateFirmBillingRequest, body),
      }),
  };
}
export type FirmBillingClient = ReturnType<typeof createFirmBillingClient>;
