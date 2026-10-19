import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  type AddSubscriptionNoteRequest,
  type BillingFirm,
  type ChangeBillingDateRequest,
  type ChangeSubscriptionPlanRequest,
  type CloseSubscriptionRequest,
  type ConvertSubscriptionRequest,
  type CreateSubscriptionRequest,
  type ExtendSubscriptionTrialRequest,
  type PlatformSubscriptionChangeKind,
  previewSubscriptionChange,
  type ReactivateSubscriptionRequest,
  type ReverseCancellationRequest,
  SaveBillingCreditNoteRequest,
  SaveBillingInvoiceRequest,
  type SaveBillingRecurringRequest,
  type SetSubscriptionPriceRequest,
  SUBSCRIPTION_CHANGEABLE_STATUSES,
  SUBSCRIPTION_CYCLE_LABELS,
  SUBSCRIPTION_TRIAL_DAYS,
  type SubscriptionBillingCycle,
  type SubscriptionDocument,
  type SubscriptionNote,
  type SubscriptionPlan,
  type SubscriptionPricing,
  type SubscriptionResult,
  type SubscriptionStatus,
  type SuspendSubscriptionRequest,
  type TurnOffAutoRenewRequest,
  type UpdateSubscriptionLocationsRequest,
  type UpdateSubscriptionSeatsRequest,
  subscriptionAddDays,
  subscriptionAddMonths,
  subscriptionBillingDateCents,
  subscriptionCycleMonths,
  subscriptionMonthlyCents,
  subscriptionPriceCents,
  subscriptionSeatRange,
} from '@firmivra/types';
import type { z } from 'zod';
import { loadFirms, loadTeam, templateOf } from '../admin-billing/billing-common.js';
import { BillingService } from '../admin-billing/billing.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  amountDue,
  billable,
  ENTITY,
  factsOf,
  inTransaction,
  type Loaded,
  loadOne,
  loadPlans,
  lockSubscription,
  notFound,
  planView,
  refuse,
  seatsInUse,
  subscriptionInclude,
} from './subscriptions-common.js';
import { ACTIONS, keptSuspensionKind } from './subscriptions-events.js';
import {
  asDate,
  dayOf,
  eventNote,
  isPaying,
  planChangeKind,
  pricesOf,
  reactivatedStatus,
  suspensionKindOf,
  utcDay,
} from './subscriptions-math.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The documents a change issued. */
interface Docs {
  invoice: SubscriptionDocument | null;
  creditNote: SubscriptionDocument | null;
}
const NO_DOCS: Docs = { invoice: null, creditNote: null };

/** What a change on an existing subscription works from, read under its lock. */
interface Ctx {
  tx: TxClient;
  now: Date;
  today: string;
  cur: Loaded;
  plans: ReadonlyMap<string, SubscriptionPlan>;
}

/** The fields of a history row (`platform_subscription_changes`) a change sets. */
interface History {
  fromPlanId?: string | null;
  toPlanId?: string | null;
  fromStatus?: SubscriptionStatus | null;
  toStatus?: SubscriptionStatus | null;
  fromSeats?: number | null;
  toSeats?: number | null;
  reason?: string | null;
  mrrCents: number;
}

/** "Team Pro (Monthly)": a subscription's invoice line and schedule template. */
const label = (plan: Pick<SubscriptionPlan, 'name'>, cycle: SubscriptionBillingCycle) =>
  `${plan.name} (${SUBSCRIPTION_CYCLE_LABELS[cycle]})`;
const SCHEDULE_DESCRIPTION = 'Firmivra subscription';
const LIVE_SCHEDULE: ('ACTIVE' | 'PAUSED')[] = ['ACTIVE', 'PAUSED'];
/** Statuses a subscription has a recurring schedule in (it has started paying and not ended). */
const BILLED: readonly SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'NON_RENEWING', 'SUSPENDED'];

/** A billing period from `start` to the day before `endExclusive` (never before `start`). */
const span = (start: string, endExclusive: string | null) => {
  if (!endExclusive) return { start, end: null };
  const end = subscriptionAddDays(endExclusive, -1);
  return { start, end: end < start ? start : end };
};
/** A new current period, paid through its end. */
const periodColumns = (start: string, end: string) => ({
  currentPeriodStart: asDate(start),
  currentPeriodEnd: asDate(end),
  nextBillingDate: asDate(end),
  paidThroughDate: asDate(end),
});
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the contract's previews need of the subscription. */
function pricingOf(cur: Loaded): SubscriptionPricing {
  return {
    status: cur.row.status,
    billingCycle: cur.row.billingCycle,
    seatsAllowed: cur.row.seatsAllowed,
    seatsUsed: cur.row.seatsUsed,
    extraLocations: cur.row.extraLocations,
    baseOverrideCents: cur.row.baseOverrideCents,
    priceCents: cur.row.priceCents,
    currentPeriodStart: cur.sub.currentPeriodStart ? dayOf(cur.sub.currentPeriodStart) : null,
    nextBillingOn: cur.row.nextBillingOn,
    plan: { id: cur.plan.id },
  };
}

/** 409 STATUS_NOT_ALLOWED outside Trial, Active, Past Due and Non-Renewing. */
function changeable(status: SubscriptionStatus): void {
  if (!SUBSCRIPTION_CHANGEABLE_STATUSES.includes(status)) throw refuse('STATUS_NOT_ALLOWED');
}

/** A plan a subscription may move to: its own, or an active one (422 PLAN_INACTIVE). */
function targetPlan(plans: ReadonlyMap<string, SubscriptionPlan>, id: string, current?: string) {
  const plan = plans.get(id);
  if (!plan || (plan.id !== current && !plan.active)) throw refuse('PLAN_INACTIVE');
  return plan;
}

/**
 * Super Admin Subscriptions changes (R60 on R0's stage A and B3), in the Super Admin's admin
 * scope. Each one runs in one transaction under the subscription's row lock: the checks the
 * contract names first, then the subscription, its history row (or, where no change kind fits,
 * the audit event), the billing documents and the recurring schedule through Billing, and an audit
 * row with ids and codes only. Every change applies now; nothing is scheduled.
 */
@Injectable()
export class SubscriptionsChangeService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  /** A change on an existing subscription: lock, read, change, answer the row after it. */
  private change(id: string, work: (c: Ctx) => Promise<Docs>): Promise<SubscriptionResult> {
    return inTransaction(this.admin, async (tx) => {
      await lockSubscription(tx, id);
      const now = new Date();
      const [cur, plans] = await Promise.all([loadOne(tx, id, now.getTime()), loadPlans(tx)]);
      const docs = await work({
        tx,
        now,
        today: utcDay(now.getTime()),
        cur,
        plans: new Map(plans.map((p) => [p.id, p])),
      });
      return { subscription: (await loadOne(tx, id)).row, ...docs };
    });
  }

  /** A history row as the signed-in admin; its id. */
  private async history(
    tx: TxClient,
    sub: { id: string; businessId: string },
    kind: PlatformSubscriptionChangeKind,
    h: History,
  ): Promise<string> {
    const row = await tx.platformSubscriptionChange.create({
      data: {
        businessId: sub.businessId,
        subscriptionId: sub.id,
        kind,
        fromPlanId: h.fromPlanId ?? null,
        toPlanId: h.toPlanId ?? null,
        fromStatus: h.fromStatus ?? null,
        toStatus: h.toStatus ?? null,
        fromSeats: h.fromSeats ?? null,
        toSeats: h.toSeats ?? null,
        reason: h.reason ?? null,
        mrrCents: h.mrrCents,
        changedByUserId: this.admin.adminUserId,
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * The change's audit row (ids and codes only). Text the event keeps (a reason, the approver, an
   * internal note) goes on B4's investigation note on that row, found by a one-off `ref`.
   */
  private async log(
    tx: TxClient,
    sub: { id: string; businessId: string },
    action: string,
    metadata: Record<string, unknown>,
    note?: string,
  ) {
    const ref = note === undefined ? undefined : randomUUID();
    await this.audit.logIn(
      tx,
      action,
      { type: ENTITY, id: sub.id },
      { firmId: sub.businessId, ...metadata, ...(ref ? { ref } : {}) },
      { businessId: null },
    );
    if (note === undefined || !ref) return null;
    const row = await tx.auditLog.findFirstOrThrow({
      where: {
        businessId: null,
        entityType: ENTITY,
        entityId: sub.id,
        action,
        metadata: { path: ['ref'], equals: ref },
      },
      select: { id: true },
    });
    return tx.auditInvestigationNote.create({
      data: { auditLogId: row.id, authorUserId: this.admin.adminUserId, body: note },
      select: { id: true, body: true, createdAt: true },
    });
  }

  private docs = (inv: SubscriptionDocument | null, cn: SubscriptionDocument | null) => ({
    invoiceId: inv?.id ?? null,
    creditNoteId: cn?.id ?? null,
  });

  /**
   * Money a change moves now, through Billing: a charge is an invoice on the subscription, issued
   * (its email waits for Billing's templates); a credit an Available credit note. Both at the
   * firm's tax rate and, for the invoice, its terms.
   */
  private async bill(
    tx: TxClient,
    cur: Pick<Loaded, 'firm' | 'sub'>,
    amountCents: number,
    what: string,
    today: string,
    period: { start: string; end: string | null },
  ): Promise<Docs> {
    if (amountCents === 0) return NO_DOCS;
    const terms = await this.billing.firmTerms(tx, cur.firm.id);
    const lines = [
      {
        description: what,
        quantity: 1,
        rateCents: Math.abs(amountCents),
        taxPercent: terms.taxPercent,
      },
    ];
    if (amountCents > 0) {
      const id = await this.billing.createInvoiceIn(
        tx,
        SaveBillingInvoiceRequest.parse({
          firmId: cur.firm.id,
          issueDate: today,
          dueDate: subscriptionAddDays(today, terms.termDays),
          periodStart: period.start,
          periodEnd: period.end,
          lines,
          send: true,
          emailFirm: true,
        }),
        cur.sub.id,
      );
      return { invoice: await invoiceDoc(tx, id), creditNote: null };
    }
    const id = await this.billing.createCreditNoteIn(
      tx,
      SaveBillingCreditNoteRequest.parse({
        firmId: cur.firm.id,
        date: today,
        reason: 'PRICE_ADJUSTMENT',
        method: 'LINE_ITEMS',
        lines,
        issue: true,
      }),
    );
    return { invoice: null, creditNote: await creditDoc(tx, id) };
  }

  /**
   * Keeps the subscription's recurring schedule (`subscription_id`) in step with it after a
   * change: its line and amount at the subscription's price, its frequency the billing cycle, its
   * next invoice the next billing day, ending with the period while it does not renew, paused while
   * suspended (or priced at nothing), canceled once it ends. `billNow` starts a period today: the
   * schedule (made if there is none) bills today's occurrence, the period's invoice.
   */
  private async keepSchedule(
    tx: TxClient,
    id: string,
    firm: BillingFirm,
    today: string,
    billNow = false,
  ): Promise<SubscriptionDocument | null> {
    const sub = await tx.platformFirmSubscription.findUniqueOrThrow({
      where: { id },
      include: subscriptionInclude,
    });
    const schedule = await tx.platformRecurringInvoice.findFirst({
      where: { subscriptionId: id, status: { in: LIVE_SCHEDULE } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!BILLED.includes(sub.status)) {
      if (schedule) await this.billing.setRecurringStatusIn(tx, schedule.id, 'CANCELED');
      return null;
    }
    const plan = planView(sub.plan);
    const facts = factsOf(sub);
    const { priceCents } = pricesOf(plan, facts);
    const start = schedule ? dayOf(schedule.startDate) : today;
    const next = billNow ? today : (facts.nextBillingOn ?? facts.periodEnd ?? today);
    const until = facts.paidThroughOn ?? facts.periodEnd;
    let end = sub.autoRenew || !until ? null : subscriptionAddDays(until, -1);
    if (end !== null && end < start) end = start;
    const body: Out<typeof SaveBillingRecurringRequest> = {
      firmId: sub.businessId,
      template: label(plan, sub.billingCycle),
      description: SCHEDULE_DESCRIPTION,
      frequency: sub.billingCycle,
      customIntervalDays: null,
      // A schedule always bills something: priced at nothing, it keeps its amount and pauses.
      amountCents: priceCents > 0 ? priceCents : (schedule?.amountCents ?? 1),
      startDate: start,
      nextInvoiceDate: next < start ? start : next,
      endDate: end,
      autoSend: schedule?.autoSend ?? true,
      autoPay: schedule?.autoPay ?? firm.autoPay,
    };
    const status = sub.status === 'SUSPENDED' || priceCents <= 0 ? 'PAUSED' : 'ACTIVE';
    let scheduleId = schedule?.id;
    if (!schedule) {
      // Only a start makes a schedule; a subscription paying without one (made by hand or a seed)
      // gets one from Billing's recurring drawer.
      if (!billNow || priceCents <= 0) return null;
      scheduleId = await this.billing.createRecurringIn(tx, body, id);
    } else {
      const kept = {
        template: templateOf(schedule.lineTemplate)[0]?.description ?? '',
        description: schedule.description,
        frequency: schedule.frequency,
        amountCents: schedule.amountCents,
        nextInvoiceDate: schedule.nextInvoiceDate ? dayOf(schedule.nextInvoiceDate) : null,
        endDate: schedule.endDate ? dayOf(schedule.endDate) : null,
      };
      const wanted = {
        template: body.template,
        description: body.description,
        frequency: body.frequency,
        amountCents: body.amountCents,
        nextInvoiceDate: body.nextInvoiceDate,
        endDate: body.endDate,
      };
      if (JSON.stringify(kept) !== JSON.stringify(wanted))
        await this.billing.updateRecurringIn(tx, schedule.id, body);
      if (schedule.status !== status)
        await this.billing.setRecurringStatusIn(tx, schedule.id, status);
    }
    if (!billNow || priceCents <= 0 || !scheduleId) return null;
    return invoiceDoc(tx, await this.billing.runRecurringIn(tx, scheduleId));
  }

  // ---------- Start and plan ----------

  create(body: Out<typeof CreateSubscriptionRequest>): Promise<SubscriptionResult> {
    return inTransaction(this.admin, async (tx) => {
      const now = new Date();
      const today = utcDay(now.getTime());
      const firm = (await loadFirms(tx, body.firmId)).get(body.firmId);
      if (!firm || (firm.status !== 'ACTIVE' && firm.status !== 'PENDING_SETUP'))
        throw refuse('FIRM_NOT_AVAILABLE');
      const taken = await tx.platformFirmSubscription.findUnique({
        where: { businessId: firm.id },
        select: { id: true },
      });
      if (taken) throw refuse('ALREADY_SUBSCRIBED');
      const plan = targetPlan(new Map((await loadPlans(tx)).map((p) => [p.id, p])), body.planId);
      const range = subscriptionSeatRange(plan);
      if (body.seats < range.min || (range.max !== null && body.seats > range.max))
        throw refuse('SEATS_OUT_OF_RANGE');
      const used = await seatsInUse(tx, firm.id);
      if (used !== null && body.seats < used) throw refuse('SEATS_IN_USE');
      if (body.extraLocations > 0 && plan.locationPriceCents === null)
        throw refuse('LOCATIONS_NOT_OFFERED');
      const paid = body.mode === 'PAID';
      if (paid) billable(firm);
      const extraSeats = body.seats - plan.includedSeats;
      const priceCents = subscriptionPriceCents(plan, {
        billingCycle: body.billingCycle,
        extraSeats,
        extraLocations: body.extraLocations,
      });
      const end = subscriptionAddMonths(today, subscriptionCycleMonths(body.billingCycle));
      const sub = await tx.platformFirmSubscription.create({
        data: {
          businessId: firm.id,
          planId: plan.id,
          status: paid ? 'ACTIVE' : 'TRIAL',
          billingCycle: body.billingCycle,
          seatsIncluded: plan.includedSeats,
          seatsPurchased: extraSeats,
          locationsIncluded: plan.includedLocations,
          locationsPurchased: body.extraLocations,
          autoRenew: true,
          ...(paid
            ? { startedAt: now, ...periodColumns(today, end) }
            : {
                trialStartedAt: now,
                trialEndsAt: asDate(subscriptionAddDays(today, SUBSCRIPTION_TRIAL_DAYS)),
              }),
        },
        select: { id: true, businessId: true },
      });
      const changeId = await this.history(tx, sub, 'CREATED', {
        toPlanId: plan.id,
        toStatus: paid ? 'ACTIVE' : 'TRIAL',
        toSeats: body.seats,
        mrrCents: paid ? subscriptionMonthlyCents(priceCents, body.billingCycle) : 0,
      });
      const invoice = paid ? await this.keepSchedule(tx, sub.id, firm, today, true) : null;
      await this.log(tx, sub, ACTIONS.created, {
        changeIds: [changeId],
        mode: body.mode,
        planId: plan.id,
        billingCycle: body.billingCycle,
        amountCents: invoice ? priceCents : null,
        ...this.docs(invoice, null),
      });
      return { subscription: (await loadOne(tx, sub.id)).row, invoice, creditNote: null };
    });
  }

  changePlan(
    id: string,
    body: Out<typeof ChangeSubscriptionPlanRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, plan: from, sub, firm } = c.cur;
      changeable(row.status);
      const to = targetPlan(c.plans, body.planId, from.id);
      if (to.id === from.id && body.billingCycle === row.billingCycle) throw refuse('NO_CHANGE');
      const preview = previewSubscriptionChange(
        pricingOf(c.cur),
        to,
        { billingCycle: body.billingCycle },
        c.today,
      );
      if (preview.blocked) throw refuse(preview.blocked);
      if (preview.amountCents !== 0) billable(firm);
      const cycleChanged = body.billingCycle !== row.billingCycle;
      const newPeriod =
        cycleChanged &&
        preview.nextBillingOn !== null &&
        preview.nextBillingOn !== row.nextBillingOn;
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          planId: to.id,
          billingCycle: preview.billingCycle,
          seatsIncluded: to.includedSeats,
          seatsPurchased: preview.extraSeats,
          locationsIncluded: to.includedLocations,
          locationsPurchased: preview.extraLocations,
          priceCentsOverride: preview.baseOverrideCents,
          ...(newPeriod ? periodColumns(c.today, preview.nextBillingOn!) : {}),
        },
      });
      const moved: History = {
        fromPlanId: from.id,
        toPlanId: to.id,
        fromStatus: row.status,
        toStatus: row.status,
        fromSeats: row.seatsAllowed,
        toSeats: preview.seats,
        mrrCents: isPaying(row.status) ? preview.monthlyCents : 0,
      };
      const changeIds: string[] = [];
      if (to.id !== from.id)
        changeIds.push(await this.history(c.tx, sub, planChangeKind(from, to), moved));
      if (cycleChanged) changeIds.push(await this.history(c.tx, sub, 'CYCLE_CHANGED', moved));
      const docs = await this.bill(
        c.tx,
        c.cur,
        preview.amountCents,
        `${label(to, preview.billingCycle)}: plan change, prorated`,
        c.today,
        span(c.today, preview.nextBillingOn),
      );
      await this.keepSchedule(c.tx, id, firm, c.today);
      await this.log(c.tx, sub, ACTIONS.planChanged, {
        changeIds,
        fromPlanId: from.id,
        toPlanId: to.id,
        fromCycle: row.billingCycle,
        toCycle: preview.billingCycle,
        droppedLocations: preview.droppedLocations,
        amountCents: preview.amountCents || null,
        ...this.docs(docs.invoice, docs.creditNote),
      });
      return docs;
    });
  }

  updateSeats(
    id: string,
    body: Out<typeof UpdateSubscriptionSeatsRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, plan, sub, firm } = c.cur;
      changeable(row.status);
      if (body.seats === row.seatsAllowed) throw refuse('NO_CHANGE');
      const preview = previewSubscriptionChange(
        pricingOf(c.cur),
        plan,
        { seats: body.seats },
        c.today,
      );
      if (preview.blocked) throw refuse(preview.blocked);
      if (preview.amountCents !== 0) billable(firm);
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          seatsIncluded: plan.includedSeats,
          seatsPurchased: preview.extraSeats,
          locationsPurchased: preview.extraLocations,
        },
      });
      const changeId = await this.history(c.tx, sub, 'SEATS_CHANGED', {
        fromPlanId: plan.id,
        toPlanId: plan.id,
        fromStatus: row.status,
        toStatus: row.status,
        fromSeats: row.seatsAllowed,
        toSeats: preview.seats,
        mrrCents: isPaying(row.status) ? preview.monthlyCents : 0,
      });
      const docs = await this.bill(
        c.tx,
        c.cur,
        preview.amountCents,
        `${label(plan, row.billingCycle)}: seat change, prorated`,
        c.today,
        span(c.today, preview.nextBillingOn),
      );
      await this.keepSchedule(c.tx, id, firm, c.today);
      await this.log(c.tx, sub, ACTIONS.seatsChanged, {
        changeIds: [changeId],
        amountCents: preview.amountCents || null,
        ...this.docs(docs.invoice, docs.creditNote),
      });
      return docs;
    });
  }

  updateLocations(
    id: string,
    body: Out<typeof UpdateSubscriptionLocationsRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, plan, sub, firm } = c.cur;
      changeable(row.status);
      if (body.extraLocations === row.extraLocations) throw refuse('NO_CHANGE');
      const preview = previewSubscriptionChange(
        pricingOf(c.cur),
        plan,
        { extraLocations: body.extraLocations },
        c.today,
      );
      if (preview.blocked) throw refuse(preview.blocked);
      if (preview.amountCents !== 0) billable(firm);
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          seatsIncluded: plan.includedSeats,
          seatsPurchased: preview.extraSeats,
          locationsPurchased: preview.extraLocations,
        },
      });
      const docs = await this.bill(
        c.tx,
        c.cur,
        preview.amountCents,
        `${label(plan, row.billingCycle)}: location change, prorated`,
        c.today,
        span(c.today, preview.nextBillingOn),
      );
      await this.keepSchedule(c.tx, id, firm, c.today);
      await this.log(c.tx, sub, ACTIONS.locationsChanged, {
        event: 'LOCATIONS_CHANGED',
        fromLocations: row.extraLocations,
        toLocations: preview.extraLocations,
        amountCents: preview.amountCents || null,
        mrrCents: isPaying(row.status) ? preview.monthlyCents : 0,
        ...this.docs(docs.invoice, docs.creditNote),
      });
      return docs;
    });
  }

  // ---------- Trial ----------

  extendTrial(
    id: string,
    body: Out<typeof ExtendSubscriptionTrialRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, sub } = c.cur;
      if (row.status !== 'TRIAL') throw refuse('STATUS_NOT_ALLOWED');
      const from = factsOf(sub).trialEndsOn ?? c.today;
      const to = subscriptionAddDays(from, body.days);
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: { trialEndsAt: asDate(to), ...(sub.trialStartedAt ? {} : { trialStartedAt: c.now }) },
      });
      await this.log(
        c.tx,
        sub,
        ACTIONS.trialExtended,
        { event: 'TRIAL_EXTENDED', fromDay: from, toDay: to, days: body.days },
        body.reason,
      );
      return NO_DOCS;
    });
  }

  convert(id: string, body: Out<typeof ConvertSubscriptionRequest>): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, plan: from, sub, firm } = c.cur;
      if (row.status !== 'TRIAL') throw refuse('STATUS_NOT_ALLOWED');
      const to = targetPlan(c.plans, body.planId, from.id);
      const preview = previewSubscriptionChange(
        pricingOf(c.cur),
        to,
        { billingCycle: body.billingCycle },
        c.today,
      );
      if (preview.blocked) throw refuse(preview.blocked);
      billable(firm);
      // A trial the client asked not to renew pays one period and does not renew (§6.9: Auto-Renew
      // never comes back on by itself).
      const status: SubscriptionStatus = sub.autoRenew ? 'ACTIVE' : 'NON_RENEWING';
      const end = subscriptionAddMonths(c.today, subscriptionCycleMonths(body.billingCycle));
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          planId: to.id,
          billingCycle: body.billingCycle,
          seatsIncluded: to.includedSeats,
          seatsPurchased: preview.extraSeats,
          locationsIncluded: to.includedLocations,
          locationsPurchased: preview.extraLocations,
          priceCentsOverride: preview.baseOverrideCents,
          status,
          startedAt: c.now,
          ...periodColumns(c.today, end),
        },
      });
      const changeId = await this.history(c.tx, sub, 'STATUS_CHANGED', {
        fromPlanId: from.id,
        toPlanId: to.id,
        fromStatus: 'TRIAL',
        toStatus: status,
        fromSeats: row.seatsAllowed,
        toSeats: preview.seats,
        mrrCents: preview.monthlyCents,
      });
      const invoice = await this.keepSchedule(c.tx, id, firm, c.today, true);
      await this.log(c.tx, sub, ACTIONS.converted, {
        changeIds: [changeId],
        planId: to.id,
        billingCycle: body.billingCycle,
        amountCents: invoice ? preview.priceCents : null,
        ...this.docs(invoice, null),
      });
      return { invoice, creditNote: null };
    });
  }

  // ---------- Renewal and lifecycle ----------

  turnOffAutoRenew(
    id: string,
    body: Out<typeof TurnOffAutoRenewRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, sub, firm } = c.cur;
      if (!sub.autoRenew) throw refuse('RENEWAL_ALREADY_OFF');
      if (row.status !== 'ACTIVE' && row.status !== 'TRIAL') throw refuse('STATUS_NOT_ALLOWED');
      const facts = factsOf(sub);
      const toStatus: SubscriptionStatus = row.status === 'ACTIVE' ? 'NON_RENEWING' : 'TRIAL';
      const paidThrough = facts.paidThroughOn ?? facts.periodEnd ?? facts.nextBillingOn;
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          status: toStatus,
          autoRenew: false,
          cancelRequestedAt: c.now,
          cancelReason: body.notes,
          cancelRequestSource: body.source,
          ...(row.status === 'ACTIVE' && paidThrough
            ? { paidThroughDate: asDate(paidThrough) }
            : {}),
        },
      });
      const changeId = await this.history(c.tx, sub, 'CANCEL_REQUESTED', {
        fromStatus: row.status,
        toStatus,
        reason: body.notes,
        mrrCents: isPaying(toStatus) ? row.monthlyCents : 0,
      });
      await this.keepSchedule(c.tx, id, firm, c.today);
      await this.log(c.tx, sub, ACTIONS.autoRenewOff, {
        changeIds: [changeId],
        source: body.source,
      });
      return NO_DOCS;
    });
  }

  reverseCancellation(
    id: string,
    body: Out<typeof ReverseCancellationRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, sub, firm } = c.cur;
      if (sub.autoRenew) throw refuse('RENEWAL_ALREADY_ON');
      if (row.status !== 'NON_RENEWING' && row.status !== 'TRIAL')
        throw refuse('STATUS_NOT_ALLOWED');
      const renewing = row.status === 'NON_RENEWING';
      const facts = factsOf(sub);
      const next = facts.paidThroughOn ?? facts.periodEnd ?? facts.nextBillingOn;
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          autoRenew: true,
          cancelRequestedAt: null,
          cancelReason: null,
          cancelRequestSource: null,
          ...(renewing
            ? { status: 'ACTIVE' as const, ...(next ? { nextBillingDate: asDate(next) } : {}) }
            : {}),
        },
      });
      if (renewing) {
        const changeId = await this.history(c.tx, sub, 'STATUS_CHANGED', {
          fromStatus: 'NON_RENEWING',
          toStatus: 'ACTIVE',
          reason: body.reason,
          mrrCents: row.monthlyCents,
        });
        await this.log(c.tx, sub, ACTIONS.cancellationReversed, { changeIds: [changeId] });
      } else {
        // A trial's reversal changes no status, so no history row: the audit row is the event.
        await this.log(
          c.tx,
          sub,
          ACTIONS.cancellationReversed,
          { event: 'CANCEL_REVERSED', fromStatus: 'TRIAL', toStatus: 'TRIAL' },
          body.reason,
        );
      }
      await this.keepSchedule(c.tx, id, firm, c.today);
      return NO_DOCS;
    });
  }

  suspend(id: string, body: Out<typeof SuspendSubscriptionRequest>): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, sub, firm } = c.cur;
      changeable(row.status);
      if (body.kind === 'NONPAYMENT' && row.status !== 'PAST_DUE')
        throw refuse('NONPAYMENT_NOT_PAST_DUE');
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: { status: 'SUSPENDED', suspendedAt: c.now, suspendedReason: body.reason },
      });
      const changeId = await this.history(c.tx, sub, 'STATUS_CHANGED', {
        fromStatus: row.status,
        toStatus: 'SUSPENDED',
        reason: body.reason,
        mrrCents: 0,
      });
      await this.keepSchedule(c.tx, id, firm, c.today);
      // No column holds the kind (R0, Needs): this row keeps it, the detail reads the latest.
      await this.log(c.tx, sub, ACTIONS.suspended, { changeIds: [changeId], kind: body.kind });
      return NO_DOCS;
    });
  }

  reactivate(
    id: string,
    body: Out<typeof ReactivateSubscriptionRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row } = c.cur;
      if (row.status === 'SUSPENDED') return this.resume(c, body);
      if (row.status === 'CANCELLED' || row.status === 'EXPIRED') return this.restart(c, body);
      throw refuse('STATUS_NOT_ALLOWED');
    });
  }

  /** Back from a suspension, once nothing is due; a period that ended meanwhile starts again. */
  private async resume(c: Ctx, body: Out<typeof ReactivateSubscriptionRequest>): Promise<Docs> {
    const { sub, firm, row } = c.cur;
    if ((await amountDue(c.tx, firm.id)) > 0) throw refuse('BALANCE_DUE');
    const [into, audits] = await Promise.all([
      c.tx.platformSubscriptionChange.findFirst({
        where: { subscriptionId: sub.id, toStatus: 'SUSPENDED' },
        orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
        select: { fromStatus: true },
      }),
      c.tx.auditLog.findMany({
        where: {
          businessId: null,
          entityType: ENTITY,
          entityId: sub.id,
          action: ACTIONS.suspended,
        },
        select: { id: true, action: true, actorUserId: true, metadata: true, createdAt: true },
      }),
    ]);
    const kind = suspensionKindOf(keptSuspensionKind(audits), into?.fromStatus ?? null);
    if (kind === 'NONPAYMENT' && !body.paymentConfirmed)
      throw refuse('PAYMENT_CONFIRMATION_REQUIRED');
    const paid = into?.fromStatus
      ? into.fromStatus !== 'TRIAL'
      : sub.startedAt !== null || sub.currentPeriodStart !== null;
    const status = reactivatedStatus({ paid, autoRenew: sub.autoRenew });
    const facts = factsOf(sub);
    const periodEnd = facts.nextBillingOn ?? facts.periodEnd;
    const newPeriod = paid && (periodEnd === null || periodEnd <= c.today);
    if (newPeriod) billable(firm);
    const end = subscriptionAddMonths(c.today, subscriptionCycleMonths(sub.billingCycle));
    await c.tx.platformFirmSubscription.update({
      where: { id: sub.id },
      data: {
        status,
        suspendedAt: null,
        suspendedReason: null,
        ...(newPeriod ? periodColumns(c.today, end) : {}),
      },
    });
    const changeId = await this.history(c.tx, sub, 'STATUS_CHANGED', {
      fromStatus: 'SUSPENDED',
      toStatus: status,
      reason: body.reason,
      mrrCents: isPaying(status) ? row.monthlyCents : 0,
    });
    const invoice = await this.keepSchedule(c.tx, sub.id, firm, c.today, newPeriod);
    await this.log(c.tx, sub, ACTIONS.reactivated, {
      changeIds: [changeId],
      restart: false,
      newPeriod,
      amountCents: invoice ? row.priceCents : null,
      ...this.docs(invoice, null),
    });
    return { invoice, creditNote: null };
  }

  /** A canceled or expired subscription starts again today on a plan, with its first invoice. */
  private async restart(c: Ctx, body: Out<typeof ReactivateSubscriptionRequest>): Promise<Docs> {
    const { sub, firm, row, plan: from } = c.cur;
    if (!body.planId || !body.billingCycle) throw refuse('PLAN_REQUIRED');
    const to = targetPlan(c.plans, body.planId);
    const preview = previewSubscriptionChange(
      pricingOf(c.cur),
      to,
      { billingCycle: body.billingCycle },
      c.today,
    );
    if (preview.blocked) throw refuse(preview.blocked);
    billable(firm);
    const end = subscriptionAddMonths(c.today, subscriptionCycleMonths(body.billingCycle));
    await c.tx.platformFirmSubscription.update({
      where: { id: sub.id },
      data: {
        planId: to.id,
        billingCycle: body.billingCycle,
        seatsIncluded: to.includedSeats,
        seatsPurchased: preview.extraSeats,
        locationsIncluded: to.includedLocations,
        locationsPurchased: preview.extraLocations,
        priceCentsOverride: preview.baseOverrideCents,
        status: 'ACTIVE',
        autoRenew: true,
        cancelRequestedAt: null,
        cancelReason: null,
        cancelRequestSource: null,
        suspendedAt: null,
        suspendedReason: null,
        closedAt: null,
        closedReason: null,
        startedAt: c.now,
        ...periodColumns(c.today, end),
      },
    });
    const changeId = await this.history(c.tx, sub, 'STATUS_CHANGED', {
      fromPlanId: from.id,
      toPlanId: to.id,
      fromStatus: row.status,
      toStatus: 'ACTIVE',
      fromSeats: row.seatsAllowed,
      toSeats: preview.seats,
      reason: body.reason,
      mrrCents: preview.monthlyCents,
    });
    const invoice = await this.keepSchedule(c.tx, sub.id, firm, c.today, true);
    await this.log(c.tx, sub, ACTIONS.reactivated, {
      changeIds: [changeId],
      restart: true,
      planId: to.id,
      billingCycle: body.billingCycle,
      amountCents: invoice ? preview.priceCents : null,
      ...this.docs(invoice, null),
    });
    return { invoice, creditNote: null };
  }

  close(id: string, body: Out<typeof CloseSubscriptionRequest>): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, sub, firm } = c.cur;
      if (row.status === 'CANCELLED') throw refuse('STATUS_NOT_ALLOWED');
      if (!sameName(body.confirmName, firm.name)) throw refuse('CONFIRM_NAME_MISMATCH');
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          autoRenew: false,
          closedAt: c.now,
          closedReason: body.reason,
          nextBillingDate: null,
          suspendedAt: null,
          suspendedReason: null,
        },
      });
      const changeId = await this.history(c.tx, sub, 'CANCELED', {
        fromStatus: row.status,
        toStatus: 'CANCELLED',
        reason: body.reason,
        mrrCents: 0,
      });
      await this.keepSchedule(c.tx, id, firm, c.today);
      await this.log(c.tx, sub, ACTIONS.closed, { changeIds: [changeId] });
      return NO_DOCS;
    });
  }

  // ---------- Billing terms ----------

  setPrice(id: string, body: Out<typeof SetSubscriptionPriceRequest>): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, plan, sub, firm } = c.cur;
      if (row.status === 'CANCELLED') throw refuse('STATUS_NOT_ALLOWED');
      if (body.baseCents === sub.priceCentsOverride) throw refuse('NO_CHANGE');
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: { priceCentsOverride: body.baseCents },
      });
      const after = pricesOf(plan, { ...factsOf(sub), priceCentsOverride: body.baseCents });
      await this.keepSchedule(c.tx, id, firm, c.today);
      await this.log(
        c.tx,
        sub,
        ACTIONS.priceChanged,
        {
          event: 'PRICE_CHANGED',
          fromCents: sub.priceCentsOverride,
          toCents: body.baseCents,
          mrrCents: isPaying(row.status) ? after.monthlyCents : 0,
        },
        eventNote(body.reason, body.baseCents === null ? null : body.approvedBy),
      );
      return NO_DOCS;
    });
  }

  changeBillingDate(
    id: string,
    body: Out<typeof ChangeBillingDateRequest>,
  ): Promise<SubscriptionResult> {
    return this.change(id, async (c) => {
      const { row, plan, sub, firm } = c.cur;
      const next = row.nextBillingOn;
      if (!next) throw refuse('NO_BILLING_DATE');
      const latest = subscriptionAddMonths(c.today, subscriptionCycleMonths(row.billingCycle));
      if (body.date <= c.today || body.date > latest) throw refuse('BILLING_DATE_OUT_OF_RANGE');
      if (body.date === next) throw refuse('NO_CHANGE');
      const amountCents = subscriptionBillingDateCents(pricingOf(c.cur), body.date);
      if (amountCents !== 0) billable(firm);
      // The whole period moves, so it stays one cycle long: a later move or a prorated change
      // prices a day as before, not by the shorter or longer period this move would leave.
      const months = subscriptionCycleMonths(row.billingCycle);
      await c.tx.platformFirmSubscription.update({
        where: { id },
        data: {
          currentPeriodStart: asDate(subscriptionAddMonths(body.date, -months)),
          currentPeriodEnd: asDate(body.date),
          nextBillingDate: asDate(body.date),
          paidThroughDate: asDate(body.date),
        },
      });
      const docs = await this.bill(
        c.tx,
        c.cur,
        amountCents,
        `${label(plan, row.billingCycle)}: billing date moved from ${next} to ${body.date}`,
        c.today,
        span(next, body.date),
      );
      await this.keepSchedule(c.tx, id, firm, c.today);
      await this.log(
        c.tx,
        sub,
        ACTIONS.billingDateChanged,
        {
          event: 'BILLING_DATE_CHANGED',
          fromDay: next,
          toDay: body.date,
          amountCents: amountCents || null,
          ...this.docs(docs.invoice, docs.creditNote),
        },
        body.reason,
      );
      return docs;
    });
  }

  // ---------- Notes ----------

  addNote(id: string, body: Out<typeof AddSubscriptionNoteRequest>): Promise<SubscriptionNote> {
    return inTransaction(this.admin, async (tx) => {
      const sub = await tx.platformFirmSubscription.findUnique({
        where: { id },
        select: { id: true, businessId: true },
      });
      if (!sub) throw notFound();
      const note = await this.log(tx, sub, ACTIONS.noteAdded, { event: 'NOTE_ADDED' }, body.body);
      const team = await loadTeam(tx);
      return {
        id: note!.id,
        body: note!.body,
        author: team.nameOf(this.admin.adminUserId),
        createdAt: note!.createdAt.toISOString(),
      };
    });
  }
}

async function invoiceDoc(tx: TxClient, id: string): Promise<SubscriptionDocument> {
  return tx.platformInvoice.findUniqueOrThrow({
    where: { id },
    select: { id: true, number: true, totalCents: true },
  });
}

async function creditDoc(tx: TxClient, id: string): Promise<SubscriptionDocument> {
  return tx.platformCreditNote.findUniqueOrThrow({
    where: { id },
    select: { id: true, number: true, totalCents: true },
  });
}
