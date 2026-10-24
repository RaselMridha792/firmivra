import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type CreateFirmBillingRequest,
  type FirmBillingInvoice,
  type FirmBillingInvoicePage,
  type FirmBillingInvoiceRange,
  type FirmBillingInvoiceRow,
  type FirmBillingInvoicesQuery,
  type FirmBillingOverview,
  type FirmBillingPlan,
  type FirmBillingPlanChoice,
  type FirmBillingRequest,
  type FirmBillingRequestKind,
  SUBSCRIPTION_CYCLE_LABELS,
  type SubscriptionBillingCycle,
  subscriptionAddMonths,
  subscriptionPriceCents,
} from '@firmivra/types';
import type { z } from 'zod';
import { invoiceStatus } from '../admin-billing/billing-common.js';
import {
  accessEndsOf,
  dayOrNull,
  nextBillingOf,
  planChangeKind,
  pricesOf,
} from '../admin-subscriptions/subscriptions-math.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { allowanceOf } from '../locations/locations-common.js';
import { activeCount } from '../locations/locations-read.service.js';
import {
  duplicateKey,
  isUniqueViolation,
  latestReplies,
  raiseTicket,
  ticketByKey,
  ticketNumber,
  type TicketRow,
  ticketsStartingWith,
} from './firm-tickets.js';
import { dayText, invoicePdf, money } from './invoice-pdf.js';
import { ROLE_NAMES } from './profile-changes.service.js';

type RequestBody = z.output<typeof CreateFirmBillingRequest>;
type InvoicesQuery = z.output<typeof FirmBillingInvoicesQuery>;

/** Each request kind's subject start; a ticket's subject never changes after insert. */
const PREFIX: Record<FirmBillingRequestKind, string> = {
  PLAN_CHANGE: 'Plan change request: ',
  BILLING_CONTACT: 'Billing contact change request',
};
const kindOf = (subject: string): FirmBillingRequestKind | null =>
  (Object.keys(PREFIX) as FirmBillingRequestKind[]).find((k) => subject.startsWith(PREFIX[k])) ??
  null;

const RANGE_MONTHS: Record<Exclude<FirmBillingInvoiceRange, 'ALL'>, number> = {
  '3M': 3,
  '6M': 6,
  '12M': 12,
};

const planInclude = {
  features: { orderBy: [{ createdAt: 'asc' }, { featureKey: 'asc' }] },
} satisfies Prisma.PlatformPlanInclude;

type PlanRow = {
  code: string;
  name: string;
  basePriceCents: number;
  billingCycle: SubscriptionBillingCycle;
  includedSeats: number;
  maxSeats: number | null;
  overagePriceCentsPerSeat: number | null;
  includedLocations: number;
  overagePriceCentsPerLocation: number | null;
  displayOrder: number;
  features: { featureKey: string; label: string }[];
};

const planOf = (p: PlanRow): FirmBillingPlan => ({
  code: p.code,
  name: p.name,
  priceCents: p.basePriceCents,
  billingCycle: p.billingCycle,
  includedSeats: p.includedSeats,
  maxSeats: p.maxSeats,
  seatPriceCents: p.overagePriceCentsPerSeat,
  includedLocations: p.includedLocations,
  locationPriceCents: p.overagePriceCentsPerLocation,
  features: p.features.map((f) => ({ key: f.featureKey, label: f.label })),
});

/**
 * What stops a firm asking for `plan` today: more active staff users than it can hold (its
 * ceiling, or its included seats when it sells none), or more active locations than it includes
 * when it sells none. Her guide: a downgrade below current usage is blocked until resolved;
 * nobody is removed and nothing is deleted to make it fit.
 */
export function blockersOf(plan: FirmBillingPlan, seats: number, locations: number): string[] {
  const out: string[] = [];
  const seatCeiling = plan.maxSeats ?? (plan.seatPriceCents === null ? plan.includedSeats : null);
  if (seatCeiling !== null && seats > seatCeiling)
    out.push(`${seats} active staff users; ${plan.name} allows ${seatCeiling}`);
  if (plan.locationPriceCents === null && locations > plan.includedLocations)
    out.push(`${locations} active locations; ${plan.name} includes ${plan.includedLocations}`);
  return out;
}

/** The plan's price per `cycle` at today's usage: its base price and the extras it sells. */
export function estimateCents(
  plan: FirmBillingPlan,
  cycle: SubscriptionBillingCycle,
  seats: number,
  locations: number,
): number {
  return subscriptionPriceCents(plan, {
    billingCycle: cycle,
    extraSeats: plan.seatPriceCents === null ? 0 : Math.max(0, seats - plan.includedSeats),
    extraLocations:
      plan.locationPriceCents === null ? 0 : Math.max(0, locations - plan.includedLocations),
  });
}

const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'That invoice was not found' });

const notAvailable = (message: string, details: string[] = []) =>
  new ConflictException({
    code: 'PLAN_NOT_AVAILABLE',
    message,
    ...(details.length ? { details: details.map((m) => ({ path: 'planCode', message: m })) } : {}),
  });

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Settings > Billing & Subscriptions, the firm's side (`api.firmBilling`). Reads the platform's
 * rows the firm may read (its subscription, the plans, its issued invoices with their lines and
 * payments, its billing profile) in its own scope; it writes none of them. A plan change or a new
 * billing contact is a support ticket for Firmivra's Super Admin team (`firm-tickets.ts`).
 * Audited: each request (kind, number, plan code) and each PDF download (the invoice number).
 */
@Injectable()
export class FirmBillingService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, userId: string, fn: (tx: TxClient) => Promise<T>) {
    return this.database.withScope({ kind: 'business', businessId, actorUserId: userId }, fn);
  }

  overview(businessId: string, userId: string): Promise<FirmBillingOverview> {
    return this.inFirm(businessId, userId, (tx) => this.overviewIn(tx, businessId));
  }

  private async overviewIn(tx: TxClient, businessId: string): Promise<FirmBillingOverview> {
    // One query at a time: a transaction holds one connection.
    const sub = await tx.platformFirmSubscription.findUnique({
      where: { businessId },
      include: { plan: { include: planInclude } },
    });
    const plans = await tx.platformPlan.findMany({
      where: { isActive: true },
      include: planInclude,
      orderBy: [{ displayOrder: 'asc' }, { basePriceCents: 'asc' }],
    });
    const seats = await tx.membership.count({ where: { businessId, status: 'ACTIVE' } });
    const pendingInvitations = await tx.membership.count({
      where: { businessId, status: 'INVITED' },
    });
    const locations = await activeCount(tx, businessId);
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, legalName: true },
    });
    const settings = await tx.businessSettings.findUnique({
      where: { businessId },
      select: {
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
      },
    });
    const profile = await tx.platformFirmBillingProfile.findUnique({
      where: { businessId },
      select: { billingContactName: true, billingContactEmail: true, paymentTermDays: true },
    });
    const payment = await tx.platformPayment.findFirst({
      where: { businessId, status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
      select: {
        method: true,
        amountCents: true,
        paidOn: true,
        invoice: { select: { number: true } },
      },
    });
    const requests = await this.requestsIn(tx, businessId);

    const current = sub ? planOf(sub.plan) : null;
    const subscription = sub
      ? (() => {
          const facts = {
            status: sub.status,
            billingCycle: sub.billingCycle,
            seatsIncluded: sub.seatsIncluded,
            seatsPurchased: sub.seatsPurchased,
            locationsIncluded: sub.locationsIncluded,
            locationsPurchased: sub.locationsPurchased,
            priceCentsOverride: sub.priceCentsOverride,
            autoRenew: sub.autoRenew,
            trialEndsOn: dayOrNull(sub.trialEndsAt),
            nextBillingOn: dayOrNull(sub.nextBillingDate),
            periodEnd: dayOrNull(sub.currentPeriodEnd),
            paidThroughOn: dayOrNull(sub.paidThroughDate),
            closedOn: dayOrNull(sub.closedAt),
          };
          const prices = pricesOf(current!, facts);
          return {
            status: sub.status,
            plan: current!,
            billingCycle: sub.billingCycle,
            priceCents: prices.priceCents,
            currency: 'usd',
            seatsAllowed: prices.seatsAllowed,
            locationsAllowed: prices.locationsAllowed,
            periodStart: dayOrNull(sub.currentPeriodStart),
            periodEnd: facts.periodEnd,
            nextBillingOn: nextBillingOf(facts),
            trialEndsOn: facts.trialEndsOn,
            accessEndsOn: accessEndsOf(facts),
            autoRenew: sub.autoRenew,
          };
        })()
      : null;

    const choices: FirmBillingPlanChoice[] = plans.map((p) => {
      const plan = planOf(p);
      const direction: FirmBillingPlanChoice['direction'] =
        sub && p.code === sub.plan.code
          ? 'CURRENT'
          : sub &&
              planChangeKind(
                { ...sub.plan, priceCents: sub.plan.basePriceCents },
                { ...p, priceCents: p.basePriceCents },
              ) === 'DOWNGRADED'
            ? 'DOWNGRADE'
            : 'UPGRADE';
      return { ...plan, direction, blockers: blockersOf(plan, seats, locations) };
    });

    const address = settings
      ? [
          settings.addressLine1,
          settings.addressLine2,
          [settings.city, [settings.state, settings.postalCode].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', '),
          settings.country === 'US' ? 'United States' : settings.country,
        ].filter((line): line is string => Boolean(line))
      : [];

    return {
      subscription,
      usage: {
        seats: { used: seats, allowed: subscription?.seatsAllowed ?? null },
        locations: { used: locations, allowed: allowanceOf(sub) },
        pendingInvitations,
        measuredAt: new Date().toISOString(),
      },
      billingDetails: {
        companyName: business.name,
        legalName: business.legalName,
        contactName: profile?.billingContactName ?? null,
        contactEmail: profile?.billingContactEmail ?? null,
        address: settings?.addressLine1 ? address : [],
        paymentTermDays: profile?.paymentTermDays ?? null,
      },
      lastPayment: payment
        ? {
            method: payment.method,
            amountCents: payment.amountCents,
            paidOn: payment.paidOn.toISOString().slice(0, 10),
            invoiceNumber: payment.invoice.number,
          }
        : null,
      plans: choices,
      requests,
    };
  }

  /** Issued invoices (never a draft), newest first by invoice date. */
  invoices(businessId: string, userId: string, q: InvoicesQuery): Promise<FirmBillingInvoicePage> {
    return this.inFirm(businessId, userId, async (tx) => {
      const where = {
        businessId,
        status: { not: 'DRAFT' as const },
        ...(q.range === 'ALL'
          ? {}
          : {
              invoiceDate: {
                gte: new Date(
                  `${subscriptionAddMonths(today(), -RANGE_MONTHS[q.range])}T00:00:00Z`,
                ),
              },
            }),
      };
      const total = await tx.platformInvoice.count({ where });
      const rows = await tx.platformInvoice.findMany({
        where,
        orderBy: [{ invoiceDate: 'desc' }, { number: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      });
      return { items: rows.map(rowOf), total, page: q.page, pageSize: q.pageSize };
    });
  }

  invoice(businessId: string, userId: string, id: string): Promise<FirmBillingInvoice> {
    return this.inFirm(businessId, userId, (tx) => this.invoiceIn(tx, businessId, id));
  }

  /** The invoice's PDF, audited with its number. */
  async invoicePdf(
    businessId: string,
    userId: string,
    id: string,
  ): Promise<{ bytes: Uint8Array; fileName: string }> {
    const invoice = await this.inFirm(businessId, userId, async (tx) => {
      const found = await this.invoiceIn(tx, businessId, id);
      await this.audit.logIn(
        tx,
        'billing.invoice_downloaded',
        { type: 'platform_invoice', id },
        { number: found.number },
        { businessId },
      );
      return found;
    });
    return { bytes: await invoicePdf(invoice), fileName: `${invoice.number}.pdf` };
  }

  private async invoiceIn(tx: TxClient, businessId: string, id: string) {
    const row = await tx.platformInvoice.findFirst({
      where: { id, businessId, status: { not: 'DRAFT' } },
      include: {
        lines: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        payments: { orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!row) throw notFound();
    return {
      ...rowOf(row),
      billTo: { name: row.billToName, email: row.billToEmail },
      lines: row.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPriceCents: l.unitCents,
        amountCents: l.amountCents,
      })),
      subtotalCents: row.subtotalCents,
      discountCents: row.discountCents,
      taxCents: row.taxCents,
      paidCents: row.paidCents,
      creditedCents: row.creditedCents,
      refundedCents: row.refundedCents,
      notes: row.notes,
      payments: row.payments.map((p) => ({
        paidOn: p.paidOn.toISOString().slice(0, 10),
        amountCents: p.amountCents,
        method: p.method,
        status: p.status,
      })),
    };
  }

  /** POST: one ticket per `requestId`; the same key again answers the first request. */
  async request(
    businessId: string,
    userId: string,
    body: RequestBody,
  ): Promise<FirmBillingRequest> {
    const known = await this.byKey(businessId, userId, body.requestId);
    if (known) return known;
    try {
      return await this.inFirm(businessId, userId, async (tx) => {
        const member = await tx.membership.findUniqueOrThrow({
          where: { businessId_userId: { businessId, userId } },
          select: { role: true, user: { select: { name: true } } },
        });
        const who = `${member.user.name} (${ROLE_NAMES[member.role] ?? member.role})`;
        const { subject, description, metadata } =
          body.kind === 'PLAN_CHANGE'
            ? await this.planRequest(tx, businessId, who, body)
            : await this.contactRequest(tx, businessId, who, body);
        const row = await raiseTicket(tx, {
          businessId,
          userId,
          requestId: body.requestId,
          subject,
          description,
          category: 'Billing & Payments',
          priority: 'MEDIUM',
        });
        await this.audit.logIn(
          tx,
          'billing.request_raised',
          { type: 'support_ticket', id: row.id },
          { kind: body.kind, number: row.number, ...metadata },
          { businessId },
        );
        return (await this.views(tx, businessId, [row]))[0]!;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.byKey(businessId, userId, body.requestId);
        if (again) return again;
        throw duplicateKey();
      }
      throw error;
    }
  }

  private async planRequest(
    tx: TxClient,
    businessId: string,
    who: string,
    body: Extract<RequestBody, { kind: 'PLAN_CHANGE' }>,
  ) {
    const overview = await this.overviewIn(tx, businessId);
    const sub = overview.subscription;
    if (!sub)
      throw new ConflictException({
        code: 'NO_SUBSCRIPTION',
        message: 'No subscription is connected to this workspace yet. Contact Firmivra Support.',
      });
    const target = overview.plans.find((p) => p.code === body.planCode);
    if (!target) throw notAvailable('That plan is not available. Choose another one.');
    if (target.direction === 'CURRENT' && body.billingCycle === sub.billingCycle)
      throw notAvailable('This is your current plan.');
    if (target.blockers.length)
      throw notAvailable(`${target.name} does not fit your usage today.`, target.blockers);
    const { seats, locations } = overview.usage;
    const cycle = SUBSCRIPTION_CYCLE_LABELS[body.billingCycle];
    const estimate = estimateCents(target, body.billingCycle, seats.used, locations.used);
    const timing =
      target.direction === 'DOWNGRADE'
        ? `at the next renewal${sub.nextBillingOn ? ` (${dayText(sub.nextBillingOn)})` : ''}`
        : 'once Firmivra confirms the price and it is paid';
    return {
      subject: `${PREFIX.PLAN_CHANGE}${sub.plan.name} to ${target.name} (${cycle})`,
      description: [
        `${who} asks Firmivra to change the firm's plan from ${sub.plan.name} ` +
          `(${SUBSCRIPTION_CYCLE_LABELS[sub.billingCycle]}) to ${target.name} (${cycle}).`,
        '',
        `Current price: ${money(sub.priceCents)} per ${sub.billingCycle === 'ANNUAL' ? 'year' : 'month'}.`,
        `${target.name} at today's usage (estimate): ${money(estimate)} per ` +
          `${body.billingCycle === 'ANNUAL' ? 'year' : 'month'}.`,
        `Usage now: ${seats.used} active staff users, ${locations.used} active locations.`,
        `Requested timing: ${timing}.`,
        ...(body.note ? ['', 'Note:', body.note] : []),
        '',
        'Nothing changes until Firmivra applies it.',
      ].join('\n'),
      metadata: { planCode: target.code, billingCycle: body.billingCycle },
    };
  }

  private async contactRequest(
    tx: TxClient,
    businessId: string,
    who: string,
    body: Extract<RequestBody, { kind: 'BILLING_CONTACT' }>,
  ) {
    const profile = await tx.platformFirmBillingProfile.findUnique({
      where: { businessId },
      select: { billingContactName: true, billingContactEmail: true },
    });
    const change = (label: string, now: string | null | undefined, next: string | undefined) =>
      next === undefined
        ? []
        : [label, `Current: ${now ?? 'Not on file'}`, `Proposed: ${next}`, ''];
    return {
      subject: PREFIX.BILLING_CONTACT,
      description: [
        `${who} asks Firmivra to change the firm's billing contact.`,
        '',
        ...change('Billing contact name', profile?.billingContactName, body.contactName),
        ...change('Billing contact email', profile?.billingContactEmail, body.contactEmail),
        ...(body.note ? ['Note:', body.note, ''] : []),
        'Nothing changes until Firmivra applies it.',
      ].join('\n'),
      metadata: {
        fields: [
          ...(body.contactName === undefined ? [] : ['contactName']),
          ...(body.contactEmail === undefined ? [] : ['contactEmail']),
        ],
      },
    };
  }

  private async requestsIn(tx: TxClient, businessId: string) {
    const rows = await ticketsStartingWith(tx, businessId, Object.values(PREFIX), 10);
    return this.views(tx, businessId, rows);
  }

  private async byKey(businessId: string, userId: string, key: string) {
    return this.inFirm(businessId, userId, async (tx) => {
      const row = await ticketByKey(tx, businessId, key);
      if (!row) return null;
      if (!kindOf(row.subject)) throw duplicateKey();
      return (await this.views(tx, businessId, [row]))[0]!;
    });
  }

  private async views(
    tx: TxClient,
    businessId: string,
    rows: TicketRow[],
  ): Promise<FirmBillingRequest[]> {
    const replies = await latestReplies(
      tx,
      businessId,
      rows.map((r) => r.id),
    );
    return rows.flatMap((r) => {
      const kind = kindOf(r.subject);
      if (!kind) return [];
      return [
        {
          id: r.id,
          number: ticketNumber(r),
          kind,
          summary:
            kind === 'PLAN_CHANGE'
              ? `Plan change: ${r.subject.slice(PREFIX.PLAN_CHANGE.length)}`
              : 'Billing contact change',
          status: r.status,
          submittedAt: r.createdAt.toISOString(),
          submittedBy: r.contact.user.name,
          latestReply: replies.get(r.id) ?? null,
        },
      ];
    });
  }
}

function rowOf(row: {
  id: string;
  number: string;
  status: Parameters<typeof invoiceStatus>[0]['status'];
  invoiceDate: Date;
  dueDate: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  totalCents: number;
  paidCents: number;
  creditedCents: number;
  currency: string;
}): FirmBillingInvoiceRow {
  return {
    id: row.id,
    number: row.number,
    invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
    dueDate: row.dueDate.toISOString().slice(0, 10),
    periodStart: dayOrNull(row.periodStart),
    periodEnd: dayOrNull(row.periodEnd),
    totalCents: row.totalCents,
    balanceCents: row.totalCents - row.paidCents - row.creditedCents,
    currency: row.currency,
    status: invoiceStatus(row, today()),
  };
}
