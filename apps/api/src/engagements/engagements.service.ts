import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CreateEngagementRequest,
  Engagement,
  EngagementHistory,
  ListEngagementsQuery,
  MyService,
  RequestCancellationRequest,
  UpdateEngagementRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';

type ListQuery = z.output<typeof ListEngagementsQuery>;
type CreateBody = z.output<typeof CreateEngagementRequest>;
type UpdateBody = z.output<typeof UpdateEngagementRequest>;
type CancelRequestBody = z.output<typeof RequestCancellationRequest>;

const DAY = 86_400_000;
/** A cancelled engagement can be reactivated this long (the database agrees). */
const REACTIVATION_DAYS = 90;
/** The client asks to cancel a recurring service at least this long before its next billing. */
const CANCEL_NOTICE_DAYS = 14;
/** A cancelled service keeps its documents open to the client this long. */
const DOCUMENT_ACCESS_DAYS = 60;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const invalidStatus = (message: string) => conflict('INVALID_STATUS', message);
const invalidStage = () =>
  conflict('INVALID_STAGE', "The stage is not one of the service's stages");

/** `YYYY-MM-DD` of a `@db.Date` column (stored at midnight UTC). */
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const toDate = (s: string | null | undefined) =>
  s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00.000Z`);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
/** The calendar date of `at` in the firm's time zone. */
const dateIn = (timeZone: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

const select = {
  id: true,
  clientId: true,
  title: true,
  taxYear: true,
  periodStart: true,
  periodEnd: true,
  package: true,
  status: true,
  stage: true,
  billingInterval: true,
  nextBillingOn: true,
  assignedUserId: true,
  completedAt: true,
  cancelRequestedAt: true,
  cancelRequestReason: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
  service: { select: { id: true, name: true, kind: true, stages: true } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.EngagementSelect;
type Row = Prisma.EngagementGetPayload<{ select: typeof select }>;

function toEngagement(row: Row): Engagement {
  return {
    id: row.id,
    clientId: row.clientId,
    service: { id: row.service.id, name: row.service.name, kind: row.service.kind },
    title: row.title,
    taxYear: row.taxYear,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    package: row.package,
    status: row.status,
    stage: row.stage,
    billingInterval: row.billingInterval,
    recurring: row.billingInterval !== 'ONE_TIME',
    nextBillingOn: day(row.nextBillingOn),
    assignedTo: row.assignedMember
      ? { userId: row.assignedMember.userId, name: row.assignedMember.user.name }
      : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    cancelRequestReason: row.cancelRequestReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The last day a cancellation can be asked for; null unless ACTIVE, recurring and billed next. */
export function cancelByOf(e: {
  status: string;
  billingInterval: string;
  nextBillingOn: Date | null;
}): string | null {
  if (e.status !== 'ACTIVE' || e.billingInterval === 'ONE_TIME' || !e.nextBillingOn) return null;
  return addDays(day(e.nextBillingOn)!, -CANCEL_NOTICE_DAYS);
}

function toMyService(row: Row, timeZone: string): MyService {
  return {
    id: row.id,
    service: { name: row.service.name, kind: row.service.kind },
    title: row.title,
    taxYear: row.taxYear,
    package: row.package,
    status: row.status,
    stage: row.stage,
    billingInterval: row.billingInterval,
    recurring: row.billingInterval !== 'ONE_TIME',
    nextBillingOn: day(row.nextBillingOn),
    cancelBy: cancelByOf(row),
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    documentAccessUntil:
      row.status === 'CANCELLED' && row.cancelledAt
        ? addDays(dateIn(timeZone, row.cancelledAt), DOCUMENT_ACCESS_DAYS)
        : null,
  };
}

/**
 * A client's services and their lifecycle (R10 step 6; contract in packages/types/src/engagements).
 * Owner and Admin reach every client's engagements, Staff only their own clients' (others 404, as
 * is another firm's). The database keeps the rules too (stages, 90-day reactivation, completed and
 * cancelled times, history). Every change locks the engagement's row and re-reads its client, so
 * a change at the same time (an archive, a reassignment, another status change) waits or is seen.
 * Every read and change is audited, with ids and field names, never the reasons' text.
 */
@Injectable()
export class EngagementsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private reach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  /** The client, if this actor may reach it; `forChange` locks its row (FOR SHARE) first. */
  private async client(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    forChange = false,
  ) {
    if (forChange) {
      await tx.$queryRaw`
        SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
        FOR SHARE`;
    }
    const row = await tx.client.findFirst({
      where: { AND: [{ businessId, id: clientId }, this.reach(actor)] },
      select: { id: true, archivedAt: true },
    });
    if (!row) throw notFound();
    return row;
  }

  /** The engagement, if its client is in reach; `forChange` locks it (FOR UPDATE) first. */
  private async engagement(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    forChange = false,
  ): Promise<Row> {
    if (forChange) {
      const [locked] = await tx.$queryRaw<{ client_id: string }[]>`
        SELECT client_id FROM engagements WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      if (!locked) throw notFound();
      const client = await this.client(tx, businessId, actor, locked.client_id, true);
      // As for the client's own record: an archived client's engagements don't change.
      if (client.archivedAt) throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
    }
    const row = await tx.engagement.findFirst({
      where: { businessId, id, client: this.reach(actor) },
      select,
    });
    if (!row) throw notFound();
    return row;
  }

  /** The assignee is an active member of this firm (another firm's or a former member is 404). */
  private async activeMember(tx: TxClient, businessId: string, userId: string): Promise<void> {
    const member = await tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!member) throw notFound();
  }

  async listForClient(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    q: ListQuery,
  ): Promise<Engagement[]> {
    const rows = await this.inFirm(businessId, async (tx) => {
      await this.client(tx, businessId, actor, clientId);
      return tx.engagement.findMany({
        where: { businessId, clientId, ...(q.status ? { status: q.status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select,
      });
    });
    await this.audit.log(
      'engagements.listed',
      { type: 'client', id: clientId },
      { count: rows.length },
    );
    return rows.map(toEngagement);
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<Engagement> {
    const row = await this.inFirm(businessId, (tx) => this.engagement(tx, businessId, actor, id));
    await this.audit.log('engagement.viewed', { type: 'engagement', id });
    return toEngagement(row);
  }

  async create(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    body: CreateBody,
  ): Promise<Engagement> {
    if (actor.role === 'STAFF' && body.assignedUserId) throw forbidden();
    const row = await this.inFirm(businessId, async (tx) => {
      const client = await this.client(tx, businessId, actor, clientId, true);
      if (client.archivedAt) {
        throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
      }
      const service = await tx.service.findFirst({
        where: { businessId, id: body.serviceId, archivedAt: null },
        select: { id: true, billingInterval: true, stages: true },
      });
      if (!service) throw notFound();
      const billingInterval = body.billingInterval ?? service.billingInterval;
      if (body.nextBillingOn && billingInterval === 'ONE_TIME') {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Only a recurring service has a next billing date',
        });
      }
      if (body.stage && !service.stages.includes(body.stage)) throw invalidStage();
      if (body.assignedUserId) await this.activeMember(tx, businessId, body.assignedUserId);
      const created = await tx.engagement.create({
        data: {
          businessId,
          clientId,
          serviceId: service.id,
          title: body.title,
          taxYear: body.taxYear ?? null,
          periodStart: toDate(body.periodStart) ?? null,
          periodEnd: toDate(body.periodEnd) ?? null,
          package: body.package ?? null,
          stage: body.stage ?? null,
          billingInterval,
          nextBillingOn: toDate(body.nextBillingOn) ?? null,
          assignedUserId: body.assignedUserId ?? null,
          updatedByUserId: actor.userId,
        },
        select: { id: true },
      });
      return this.engagement(tx, businessId, actor, created.id);
    });
    await this.audit.log(
      'engagement.created',
      { type: 'engagement', id: row.id },
      { clientId, fields: Object.keys(body).sort() },
    );
    return toEngagement(row);
  }

  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<Engagement> {
    if (actor.role === 'STAFF' && body.assignedUserId !== undefined) throw forbidden();
    const row = await this.inFirm(businessId, async (tx) => {
      const current = await this.engagement(tx, businessId, actor, id, true);
      if (body.stage && !current.service.stages.includes(body.stage)) throw invalidStage();
      const periodStart =
        body.periodStart === undefined ? day(current.periodStart) : body.periodStart;
      const periodEnd = body.periodEnd === undefined ? day(current.periodEnd) : body.periodEnd;
      if (periodStart && periodEnd && periodEnd < periodStart) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'The period must end on or after its start',
        });
      }
      if (body.nextBillingOn && current.billingInterval === 'ONE_TIME') {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Only a recurring service has a next billing date',
        });
      }
      if (body.assignedUserId) await this.activeMember(tx, businessId, body.assignedUserId);
      const data: Prisma.EngagementUncheckedUpdateInput = { updatedByUserId: actor.userId };
      if (body.title !== undefined) data.title = body.title;
      if (body.taxYear !== undefined) data.taxYear = body.taxYear;
      if (body.periodStart !== undefined) data.periodStart = toDate(body.periodStart);
      if (body.periodEnd !== undefined) data.periodEnd = toDate(body.periodEnd);
      if (body.package !== undefined) data.package = body.package;
      if (body.stage !== undefined) data.stage = body.stage;
      if (body.nextBillingOn !== undefined) data.nextBillingOn = toDate(body.nextBillingOn);
      if (body.assignedUserId !== undefined) data.assignedUserId = body.assignedUserId;
      await tx.engagement.update({ where: { businessId_id: { businessId, id } }, data });
      return this.engagement(tx, businessId, actor, id);
    });
    await this.audit.log(
      'engagement.updated',
      { type: 'engagement', id },
      {
        fields: Object.entries(body)
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k)
          .sort(),
      },
    );
    return toEngagement(row);
  }

  /** PENDING or ACTIVE to COMPLETED, at the database's time. */
  async complete(businessId: string, actor: ClientsActor, id: string): Promise<Engagement> {
    return this.changeStatus(businessId, actor, id, 'engagement.completed', (current) => {
      if (current.status !== 'PENDING' && current.status !== 'ACTIVE') {
        throw invalidStatus('Only a pending or active engagement can be completed');
      }
      return { status: 'COMPLETED', completedAt: new Date() };
    });
  }

  /** Anything but CANCELLED to CANCELLED, with the firm's reason (not audited as text). */
  async cancel(
    businessId: string,
    actor: ClientsActor,
    id: string,
    reason: string,
  ): Promise<Engagement> {
    return this.changeStatus(businessId, actor, id, 'engagement.cancelled', (current) => {
      if (current.status === 'CANCELLED') throw invalidStatus('Already cancelled');
      return { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason };
    });
  }

  /** Back to ACTIVE within 90 days of cancelling (409 REACTIVATION_WINDOW_PASSED after). */
  async reactivate(businessId: string, actor: ClientsActor, id: string): Promise<Engagement> {
    return this.changeStatus(businessId, actor, id, 'engagement.reactivated', (current) => {
      if (current.status !== 'CANCELLED') {
        throw invalidStatus('Only a cancelled engagement can be reactivated');
      }
      if (
        !current.cancelledAt ||
        Date.now() - current.cancelledAt.getTime() >= REACTIVATION_DAYS * DAY
      ) {
        throw conflict(
          'REACTIVATION_WINDOW_PASSED',
          'A cancelled engagement can be reactivated only within 90 days',
        );
      }
      // A new start: the client's earlier cancellation request was answered by the cancel, so
      // it goes too, and the client can ask again.
      return {
        status: 'ACTIVE',
        cancelledAt: null,
        cancellationReason: null,
        cancelRequestedAt: null,
        cancelRequestReason: null,
      };
    });
  }

  private async changeStatus(
    businessId: string,
    actor: ClientsActor,
    id: string,
    action: string,
    change: (current: Row) => Prisma.EngagementUncheckedUpdateInput,
  ): Promise<Engagement> {
    const row = await this.inFirm(businessId, async (tx) => {
      const current = await this.engagement(tx, businessId, actor, id, true);
      await tx.engagement.update({
        where: { businessId_id: { businessId, id } },
        data: { ...change(current), updatedByUserId: actor.userId },
      });
      return this.engagement(tx, businessId, actor, id);
    });
    await this.audit.log(action, { type: 'engagement', id });
    return toEngagement(row);
  }

  /** Every status or stage change, newest first (written by the database). */
  async history(
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<EngagementHistory['items']> {
    const items = await this.inFirm(businessId, async (tx) => {
      await this.engagement(tx, businessId, actor, id);
      const rows = await tx.engagementStatusHistory.findMany({
        where: { businessId, engagementId: id },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        select: { status: true, stage: true, changedByUserId: true, changedAt: true },
      });
      const userIds = [...new Set(rows.map((r) => r.changedByUserId).filter((u) => u !== null))];
      const members = userIds.length
        ? await tx.membership.findMany({
            where: { businessId, userId: { in: userIds } },
            select: { userId: true, user: { select: { name: true } } },
          })
        : [];
      const names = new Map(members.map((m) => [m.userId, m.user.name]));
      return rows.map((r) => {
        const name = r.changedByUserId ? names.get(r.changedByUserId) : undefined;
        return {
          status: r.status,
          stage: r.stage,
          changedBy: r.changedByUserId && name ? { userId: r.changedByUserId, name } : null,
          changedAt: r.changedAt.toISOString(),
        };
      });
    });
    await this.audit.log('engagement.history_viewed', { type: 'engagement', id });
    return items;
  }

  // ---------- Portal: My Services ----------

  /** The session's client (never from the URL) and the firm's time zone. */
  private async mine(tx: TxClient, businessId: string, clientAccountId: string) {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true, portalRole: true },
    });
    if (!account?.clientId) throw notFound();
    const settings = await tx.businessSettings.findUnique({
      where: { businessId },
      select: { timezone: true },
    });
    return {
      clientId: account.clientId,
      primary: account.portalRole === 'PRIMARY',
      timeZone: settings?.timezone ?? 'America/New_York',
    };
  }

  async myServices(businessId: string, clientAccountId: string): Promise<MyService[]> {
    const { clientId, items } = await this.inFirm(businessId, async (tx) => {
      const me = await this.mine(tx, businessId, clientAccountId);
      const rows = await tx.engagement.findMany({
        where: { businessId, clientId: me.clientId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select,
      });
      return { clientId: me.clientId, items: rows.map((r) => toMyService(r, me.timeZone)) };
    });
    await this.audit.log(
      'portal.services_viewed',
      { type: 'client', id: clientId },
      { count: items.length },
    );
    return items;
  }

  /**
   * The client asks to cancel an ACTIVE recurring service, on or before `cancelBy` (the firm's
   * calendar). Asking again returns it unchanged. Only the primary login asks.
   */
  async requestCancellation(
    businessId: string,
    clientAccountId: string,
    id: string,
    body: CancelRequestBody,
  ): Promise<MyService> {
    const { service, requested, clientId } = await this.inFirm(businessId, async (tx) => {
      const me = await this.mine(tx, businessId, clientAccountId);
      if (!me.primary) throw forbidden();
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM engagements
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid AND client_id = ${me.clientId}::uuid
        FOR UPDATE`;
      if (!locked) throw notFound();
      const current = await tx.engagement.findFirstOrThrow({ where: { businessId, id }, select });
      if (current.billingInterval === 'ONE_TIME') {
        throw conflict('NOT_RECURRING', 'Only recurring services can be cancelled here');
      }
      if (current.status !== 'ACTIVE') {
        throw invalidStatus('Only an active service can be cancelled');
      }
      if (current.cancelRequestedAt) {
        return {
          service: toMyService(current, me.timeZone),
          requested: false,
          clientId: me.clientId,
        };
      }
      const last = cancelByOf(current);
      if (last && dateIn(me.timeZone, new Date()) > last) {
        throw conflict(
          'TOO_LATE_TO_CANCEL',
          'Cancel at least 14 days before the next billing date',
        );
      }
      const updated = await tx.engagement.update({
        where: { businessId_id: { businessId, id } },
        data: { cancelRequestedAt: new Date(), cancelRequestReason: body.reason ?? null },
        select,
      });
      return { service: toMyService(updated, me.timeZone), requested: true, clientId: me.clientId };
    });
    if (requested) {
      await this.audit.log(
        'portal.cancellation_requested',
        { type: 'engagement', id },
        { clientId },
      );
    }
    return service;
  }
}
