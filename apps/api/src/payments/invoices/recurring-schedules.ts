import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type RecurrenceRule,
  type RecurringInvoiceDetail,
  UpdateRecurringInvoiceRequest,
  recurringPeriodOn,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../../auth/decorators.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import {
  type AuthContext,
  legacyFirmRole,
  type TenantContext,
} from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { DATABASE } from '../../database/database.module.js';
import { memberNames } from '../../workspaces/common.js';
import { conflict, day, firmToday, notFound, toDate } from './invoice-view.js';
import { InvoiceNotices } from './invoice-notices.js';
import { InvoicesService, scheduleTotal } from './invoices.service.js';

// IP-F18 (Octavia's Invoices & Payments review, Oct 27): a recurring invoice's own page and its
// management. Pause stops the next invoices; Resume starts again from the next send day on or after
// today (the periods missed while paused are not made afterwards); End stops it for good. One that
// only waits for its draft (IP-F05: PAUSED, nothing made yet) is changed through that draft, not
// here. Auto-send can be turned on or off; AutoPay stays off until a provider and the client's own
// authorization exist (Octavia's IP-010). Every change is audited with ids only.

const stateError = (message: string) => conflict('RECURRING_STATE', message);

const select = {
  id: true,
  name: true,
  clientId: true,
  frequency: true,
  intervalCount: true,
  intervalUnit: true,
  startOn: true,
  nextSendOn: true,
  endOn: true,
  maxOccurrences: true,
  occurrences: true,
  status: true,
  autoSend: true,
  autopay: true,
  delivery: true,
  client: { select: { id: true, displayName: true } },
  lines: {
    select: { description: true, quantity: true, unitAmountCents: true, taxable: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  discountType: true,
  discountPercent: true,
  discountCents: true,
  taxRate: { select: { rateBps: true } },
  invoices: {
    select: { id: true, number: true, recurringPeriodOn: true, status: true, totalCents: true },
    orderBy: { recurringPeriodOn: 'desc' as const },
    take: 50,
  },
} satisfies Prisma.RecurringInvoiceSelect;
type Row = Prisma.RecurringInvoiceGetPayload<{ select: typeof select }>;

const ruleOf = (r: Row): RecurrenceRule => ({
  frequency: r.frequency as RecurrenceRule['frequency'],
  intervalCount: r.intervalCount,
  intervalUnit: r.intervalUnit as RecurrenceRule['intervalUnit'],
});

/** The send day of period `k` (0 is the first invoice's), or null past the end. */
function periodDay(r: Row, k: number): string | null {
  if (r.maxOccurrences !== null && k >= r.maxOccurrences) return null;
  const on = recurringPeriodOn(day(r.startOn)!, ruleOf(r), k);
  const end = day(r.endOn);
  return end !== null && on > end ? null : on;
}

/** The first period on or after `today` that has not been made, and its index. */
function nextFrom(r: Row, today: string): { k: number; on: string } | null {
  for (let k = Math.max(1, r.occurrences); k < r.occurrences + 1_000; k += 1) {
    const on = periodDay(r, k);
    if (on === null) return null;
    if (on >= today) return { k, on };
  }
  return null;
}

const waiting = (r: Row) => r.status === 'PAUSED' && r.occurrences === 0;

@Injectable()
export class RecurringSchedulesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly notices: InvoiceNotices,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The schedule if its client is in reach (Staff: assigned to them); 404 otherwise. */
  private async load(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const row = await tx.recurringInvoice.findFirst({
      where: {
        businessId,
        id,
        client: actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {},
      },
      select,
    });
    if (!row) throw notFound();
    return row;
  }

  private async detail(tx: TxClient, businessId: string, r: Row): Promise<RecurringInvoiceDetail> {
    const { timeZone } = await firmToday(tx, businessId);
    const upcoming: string[] = [];
    if (r.status === 'ACTIVE' && r.nextSendOn) {
      const first = day(r.nextSendOn)!;
      upcoming.push(first);
      for (let k = r.occurrences + 1; upcoming.length < 3 && k < r.occurrences + 10; k += 1) {
        const on = periodDay(r, k);
        if (on === null) break;
        if (on > first) upcoming.push(on);
      }
    }
    const events = await tx.auditLog.findMany({
      where: { businessId, entityType: 'recurring_invoice', entityId: r.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { action: true, createdAt: true, actorUserId: true },
    });
    const names = await memberNames(
      tx,
      businessId,
      events.map((e) => e.actorUserId),
    );
    return {
      id: r.id,
      name: r.name,
      client: r.client,
      frequency: r.frequency,
      interval:
        r.frequency === 'CUSTOM' && r.intervalCount && r.intervalUnit
          ? { count: r.intervalCount, unit: r.intervalUnit }
          : null,
      nextSendOn: day(r.nextSendOn),
      status: r.status,
      amountCents: scheduleTotal(r),
      autoSend: r.autoSend,
      autopay: r.autopay,
      startOn: day(r.startOn)!,
      endOn: day(r.endOn),
      maxOccurrences: r.maxOccurrences,
      occurrences: r.occurrences,
      delivery: r.delivery,
      waiting: waiting(r),
      timezone: timeZone,
      upcoming,
      lines: r.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitAmountCents: l.unitAmountCents,
        taxable: l.taxable,
      })),
      invoices: r.invoices
        .filter((i) => i.recurringPeriodOn !== null)
        .map((i) => ({
          id: i.id,
          number: i.number,
          periodOn: day(i.recurringPeriodOn)!,
          status: i.status,
          totalCents: i.totalCents,
        })),
      history: events.map((e) => ({
        action: e.action.replace(/^recurring_invoice\./, ''),
        at: e.createdAt.toISOString(),
        by: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
      })),
    };
  }

  get(businessId: string, actor: ClientsActor, id: string): Promise<RecurringInvoiceDetail> {
    return this.inFirm(businessId, async (tx) =>
      this.detail(tx, businessId, await this.load(tx, businessId, actor, id)),
    );
  }

  /** Pause, resume or end; 409 RECURRING_STATE when the schedule cannot. */
  act(
    businessId: string,
    actor: ClientsActor,
    id: string,
    action: 'pause' | 'resume' | 'end',
  ): Promise<RecurringInvoiceDetail> {
    return this.inFirm(businessId, async (tx) => {
      const r = await this.load(tx, businessId, actor, id);
      if (waiting(r)) {
        throw stateError('This recurring invoice starts when its draft is sent; change it there');
      }
      const { today } = await firmToday(tx, businessId);
      let data: Prisma.RecurringInvoiceUpdateManyMutationInput;
      let meta: Record<string, unknown> = { clientId: r.clientId };
      if (action === 'pause') {
        if (r.status !== 'ACTIVE')
          throw stateError('Only an active recurring invoice can be paused');
        data = { status: 'PAUSED', pausedAt: new Date() };
      } else if (action === 'resume') {
        if (r.status !== 'PAUSED') throw stateError('Only a paused recurring invoice can resume');
        const next = nextFrom(r, today);
        data = next
          ? { status: 'ACTIVE', pausedAt: null, nextSendOn: toDate(next.on) }
          : { status: 'COMPLETED', pausedAt: null, nextSendOn: null, endedAt: new Date() };
        meta = { ...meta, nextSendOn: next?.on ?? null };
      } else {
        if (r.status !== 'ACTIVE' && r.status !== 'PAUSED') {
          throw stateError('This recurring invoice has already ended');
        }
        data = { status: 'ENDED', endedAt: new Date(), pausedAt: null, nextSendOn: null };
      }
      const { count } = await tx.recurringInvoice.updateMany({
        where: { businessId, id, status: r.status },
        data,
      });
      if (count === 0) throw stateError('The recurring invoice changed; reload and try again');
      const action$ = { pause: 'paused', resume: 'resumed', end: 'ended' }[action];
      await this.audit.logIn(
        tx,
        `recurring_invoice.${action$}`,
        { type: 'recurring_invoice', id },
        meta,
      );
      return this.detail(tx, businessId, await this.load(tx, businessId, actor, id));
    });
  }

  /**
   * IP-F18 Send Now (Owner and Admin): the next period's invoice is made now and goes to the
   * client (as Send does), and the schedule moves to the period after. 409 RECURRING_STATE unless
   * the schedule is active.
   */
  async sendNow(
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<RecurringInvoiceDetail> {
    const { detail, made } = await this.inFirm(businessId, async (tx) => {
      const r = await this.load(tx, businessId, actor, id);
      if (r.status !== 'ACTIVE' || waiting(r)) {
        throw stateError('Only an active recurring invoice can send its next invoice now');
      }
      const made = await this.invoices.makePeriodInvoice(tx, businessId, id, {
        send: 'now',
        actorUserId: actor.userId,
      });
      return {
        detail: await this.detail(tx, businessId, await this.load(tx, businessId, actor, id)),
        made,
      };
    });
    if (made?.opened)
      await this.notices.send('invoice.sent', businessId, made.invoiceId, actor.userId);
    return detail;
  }

  /** Auto-send on or off (AutoPay is not offered: it needs a provider and the client's consent). */
  update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: z.output<typeof UpdateRecurringInvoiceRequest>,
  ): Promise<RecurringInvoiceDetail> {
    return this.inFirm(businessId, async (tx) => {
      const r = await this.load(tx, businessId, actor, id);
      if (r.status === 'ENDED' || r.status === 'COMPLETED') {
        throw stateError('This recurring invoice has already ended');
      }
      if (r.autoSend !== body.autoSend) {
        await tx.recurringInvoice.update({
          where: { businessId_id: { businessId, id } },
          data: { autoSend: body.autoSend },
        });
        await this.audit.logIn(
          tx,
          'recurring_invoice.updated',
          { type: 'recurring_invoice', id },
          { clientId: r.clientId, autoSend: body.autoSend },
        );
      }
      return this.detail(tx, businessId, await this.load(tx, businessId, actor, id));
    });
  }
}

const idPipe = new ZodValidationPipe(z.uuid());
/** As the invoices controller's (kept here so the two modules do not import each other). */
function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: legacyFirmRole(tenant.role) };
}
const NoBody = z.strictObject({});

/**
 * IP-F18: one recurring invoice. Reads: Owner, Admin and Staff (their clients'). Changes: Owner and
 * Admin; the role guard refuses Staff (403) before the body is read.
 */
@Controller('business/invoices/recurring')
@Access('INVOICES_PAYMENTS')
@Roles(...FIRM_STAFF)
export class RecurringSchedulesController {
  constructor(private readonly schedules: RecurringSchedulesService) {}

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<RecurringInvoiceDetail> {
    return this.schedules.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRecurringInvoiceRequest))
    body: z.output<typeof UpdateRecurringInvoiceRequest>,
  ): Promise<RecurringInvoiceDetail> {
    return this.schedules.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  pause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(NoBody)) _body: z.output<typeof NoBody>,
  ): Promise<RecurringInvoiceDetail> {
    return this.schedules.act(tenant.businessId, actorOf(auth, tenant), id, 'pause');
  }

  @Post(':id/resume')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  resume(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(NoBody)) _body: z.output<typeof NoBody>,
  ): Promise<RecurringInvoiceDetail> {
    return this.schedules.act(tenant.businessId, actorOf(auth, tenant), id, 'resume');
  }

  /** IP-F18: the next period's invoice now, sent to the client. */
  @Post(':id/send-now')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  sendNow(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(NoBody)) _body: z.output<typeof NoBody>,
  ): Promise<RecurringInvoiceDetail> {
    return this.schedules.sendNow(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/end')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  end(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(NoBody)) _body: z.output<typeof NoBody>,
  ): Promise<RecurringInvoiceDetail> {
    return this.schedules.act(tenant.businessId, actorOf(auth, tenant), id, 'end');
  }
}
