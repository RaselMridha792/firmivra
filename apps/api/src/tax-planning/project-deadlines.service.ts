import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  PROJECT_DEADLINE_UNIT_MINUTES,
  type ProjectDeadline,
  type ProjectDeadlinesQuery,
  type SaveProjectDeadlineRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';

type ListQuery = z.output<typeof ProjectDeadlinesQuery>;
type SaveBody = z.output<typeof SaveProjectDeadlineRequest>;

/** The caller: the signed-in member and their firm (from TenantGuard). */
export interface DeadlineActor {
  userId: string;
  tenant: TenantContext;
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const ownerOnly = () =>
  new ForbiddenException({
    code: 'OWNER_ONLY',
    message: 'Only the owner can change, share or delete this deadline',
  });
const invalid = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request is not valid',
    details: [{ path, message }],
  });

const member = { select: { userId: true, user: { select: { name: true } } } } as const;

const deadlineSelect = {
  id: true,
  name: true,
  dueAt: true,
  description: true,
  visibility: true,
  ownerUserId: true,
  completedAt: true,
  createdAt: true,
  service: { select: { id: true, name: true } },
  client: { select: { id: true, displayName: true, assignedUserId: true } },
  owner: member,
  completedBy: member,
  shares: {
    select: { member: { select: { userId: true, user: { select: { name: true } } } } },
    orderBy: { createdAt: 'asc' },
  },
  reminders: {
    select: { minutesBefore: true, unit: true, inApp: true, channels: true, sentAt: true },
    orderBy: { minutesBefore: 'desc' },
  },
} satisfies Prisma.ProjectDeadlineSelect;

type Row = Prisma.ProjectDeadlineGetPayload<{ select: typeof deadlineSelect }>;

const ref = (m: { userId: string; user: { name: string } }) => ({
  userId: m.userId,
  name: m.user.name,
});

/**
 * Tax Planning Review 2, approved addition "Project Deadlines" (contract in
 * packages/types/src/tax-planning/project-deadlines.ts). A member's own deadline: PRIVATE is
 * theirs alone (Owner and Admin included), SHARED adds the coworkers it names. Anyone else gets
 * 404. Only the owner edits, shares or deletes; the owner and those coworkers complete and
 * reopen. A Staff member names, and sees, only a client assigned to them. Every change is
 * audited with ids and counts only, never the name or description.
 */
@Injectable()
export class ProjectDeadlinesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The deadlines the caller may see: their own, and SHARED ones that name them. */
  private visible(who: DeadlineActor): Prisma.ProjectDeadlineWhereInput {
    return {
      businessId: who.tenant.businessId,
      archivedAt: null,
      OR: [
        { ownerUserId: who.userId },
        { visibility: 'SHARED', shares: { some: { userId: who.userId } } },
      ],
    };
  }

  /** Staff see a client only when it is assigned to them; everyone else sees every client. */
  private seesClient(who: DeadlineActor, client: { assignedUserId: string | null }): boolean {
    return who.tenant.role !== 'STAFF' || client.assignedUserId === who.userId;
  }

  private view(who: DeadlineActor, row: Row): ProjectDeadline {
    const shown = row.client && this.seesClient(who, row.client) ? row.client : null;
    return {
      id: row.id,
      name: row.name,
      dueAt: row.dueAt.toISOString(),
      description: row.description,
      service: row.service,
      client: shown ? { id: shown.id, name: shown.displayName } : null,
      clientHidden: row.client !== null && shown === null,
      owner: ref(row.owner),
      visibility: row.visibility,
      sharedWith: row.shares.map((s) => ref(s.member)),
      reminders: row.reminders.map((r) => ({
        amount: r.minutesBefore / PROJECT_DEADLINE_UNIT_MINUTES[r.unit],
        unit: r.unit,
        inApp: r.inApp,
        email: r.channels.includes('EMAIL'),
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
      completedAt: row.completedAt?.toISOString() ?? null,
      completedBy: row.completedBy ? ref(row.completedBy) : null,
      mine: row.ownerUserId === who.userId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async visibleRow(tx: TxClient, who: DeadlineActor, id: string): Promise<Row> {
    const row = await tx.projectDeadline.findFirst({
      where: { AND: [this.visible(who), { id }] },
      select: deadlineSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  async list(who: DeadlineActor, q: ListQuery): Promise<ProjectDeadline[]> {
    const rows = await this.inFirm(who.tenant.businessId, (tx) =>
      tx.projectDeadline.findMany({
        where: {
          AND: [
            this.visible(who),
            q.status === 'open' ? { completedAt: null } : {},
            q.status === 'completed' ? { completedAt: { not: null } } : {},
            q.scope === 'mine' ? { ownerUserId: who.userId } : {},
            q.scope === 'shared' ? { ownerUserId: { not: who.userId } } : {},
          ],
        },
        orderBy: [{ dueAt: q.status === 'completed' ? 'desc' : 'asc' }, { id: 'asc' }],
        take: 500,
        select: deadlineSelect,
      }),
    );
    await this.audit.log(
      'project_deadlines.listed',
      { type: 'project_deadline' },
      { count: rows.length, status: q.status, scope: q.scope },
    );
    return rows.map((row) => this.view(who, row));
  }

  async get(who: DeadlineActor, id: string): Promise<ProjectDeadline> {
    const row = await this.inFirm(who.tenant.businessId, (tx) => this.visibleRow(tx, who, id));
    await this.audit.log('project_deadline.viewed', { type: 'project_deadline', id });
    return this.view(who, row);
  }

  /** The service, the client and the coworkers the body names, checked in the caller's firm. */
  private async check(tx: TxClient, who: DeadlineActor, body: SaveBody): Promise<void> {
    const businessId = who.tenant.businessId;
    const service = await tx.service.findFirst({
      where: { businessId, id: body.serviceId, archivedAt: null },
      select: { id: true },
    });
    if (!service) throw invalid('serviceId', 'Choose one of the firm’s services');
    if (body.clientId) {
      const client = await tx.client.findFirst({
        where: { businessId, id: body.clientId, archivedAt: null },
        select: { assignedUserId: true },
      });
      if (!client || !this.seesClient(who, client)) {
        throw invalid('clientId', 'Choose one of your clients');
      }
    }
    if (body.sharedWithUserIds.includes(who.userId)) {
      throw invalid('sharedWithUserIds', 'You own it already: choose coworkers');
    }
    if (body.sharedWithUserIds.length > 0) {
      const found = await tx.membership.count({
        where: { businessId, userId: { in: body.sharedWithUserIds }, status: 'ACTIVE' },
      });
      if (found !== body.sharedWithUserIds.length) {
        throw invalid('sharedWithUserIds', 'Choose active coworkers of the firm');
      }
    }
  }

  private reminderRows(
    businessId: string,
    deadlineId: string,
    body: SaveBody,
    kept: Map<number, Date | null> = new Map(),
  ) {
    return body.reminders.map((r) => {
      const minutesBefore = r.amount * PROJECT_DEADLINE_UNIT_MINUTES[r.unit];
      return {
        businessId,
        deadlineId,
        minutesBefore,
        unit: r.unit,
        inApp: r.inApp,
        channels: r.email ? ['EMAIL' as const] : [],
        sentAt: kept.get(minutesBefore) ?? null,
      };
    });
  }

  async create(who: DeadlineActor, body: SaveBody): Promise<ProjectDeadline> {
    const businessId = who.tenant.businessId;
    const row = await this.inFirm(businessId, async (tx) => {
      await this.check(tx, who, body);
      const created = await tx.projectDeadline.create({
        data: {
          businessId,
          name: body.name,
          dueAt: new Date(body.dueAt),
          description: body.description ?? null,
          serviceId: body.serviceId,
          clientId: body.clientId ?? null,
          ownerUserId: who.userId,
          visibility: body.visibility,
        },
        select: { id: true },
      });
      await tx.projectDeadlineShare.createMany({
        data: body.sharedWithUserIds.map((userId) => ({
          businessId,
          deadlineId: created.id,
          userId,
        })),
      });
      await tx.projectDeadlineReminder.createMany({
        data: this.reminderRows(businessId, created.id, body),
      });
      return this.visibleRow(tx, who, created.id);
    });
    await this.audit.log(
      'project_deadline.created',
      { type: 'project_deadline', id: row.id },
      {
        visibility: body.visibility,
        shares: body.sharedWithUserIds.length,
        reminders: body.reminders.length,
        clientId: body.clientId ?? null,
      },
    );
    return this.view(who, row);
  }

  /** Edit: the owner saves the whole deadline; a reminder already sent stays sent unless the due time moved. */
  async update(who: DeadlineActor, id: string, body: SaveBody): Promise<ProjectDeadline> {
    const businessId = who.tenant.businessId;
    const { row, changed } = await this.inFirm(businessId, async (tx) => {
      const before = await this.visibleRow(tx, who, id);
      if (before.ownerUserId !== who.userId) throw ownerOnly();
      await this.check(tx, who, body);
      const dueAt = new Date(body.dueAt);
      const moved = dueAt.getTime() !== before.dueAt.getTime();
      const kept = new Map(
        moved ? [] : before.reminders.map((r) => [r.minutesBefore, r.sentAt] as const),
      );
      await tx.projectDeadline.update({
        where: { id },
        data: {
          name: body.name,
          dueAt,
          description: body.description ?? null,
          serviceId: body.serviceId,
          clientId: body.clientId ?? null,
          visibility: body.visibility,
        },
      });
      await tx.projectDeadlineShare.deleteMany({ where: { businessId, deadlineId: id } });
      await tx.projectDeadlineShare.createMany({
        data: body.sharedWithUserIds.map((userId) => ({ businessId, deadlineId: id, userId })),
      });
      await tx.projectDeadlineReminder.deleteMany({ where: { businessId, deadlineId: id } });
      await tx.projectDeadlineReminder.createMany({
        data: this.reminderRows(businessId, id, body, kept),
      });
      const after = await this.visibleRow(tx, who, id);
      const changed = [
        before.name !== body.name && 'name',
        moved && 'dueAt',
        (before.description ?? null) !== (body.description ?? null) && 'description',
        before.service.id !== body.serviceId && 'serviceId',
        (before.client?.id ?? null) !== (body.clientId ?? null) && 'clientId',
        before.visibility !== body.visibility && 'visibility',
      ].filter((f): f is string => typeof f === 'string');
      return { row: after, changed };
    });
    await this.audit.log(
      'project_deadline.updated',
      { type: 'project_deadline', id },
      {
        fields: changed,
        shares: body.sharedWithUserIds.length,
        reminders: body.reminders.length,
      },
    );
    return this.view(who, row);
  }

  /** The owner or a coworker it is shared with marks it complete, or open again. */
  async setCompleted(who: DeadlineActor, id: string, done: boolean): Promise<ProjectDeadline> {
    const businessId = who.tenant.businessId;
    const row = await this.inFirm(businessId, async (tx) => {
      const before = await this.visibleRow(tx, who, id);
      if ((before.completedAt !== null) === done) return before;
      await tx.projectDeadline.update({
        where: { id },
        data: done
          ? { completedAt: new Date(), completedByUserId: who.userId }
          : { completedAt: null, completedByUserId: null },
      });
      return this.visibleRow(tx, who, id);
    });
    await this.audit.log(done ? 'project_deadline.completed' : 'project_deadline.reopened', {
      type: 'project_deadline',
      id,
    });
    return this.view(who, row);
  }

  async remove(who: DeadlineActor, id: string): Promise<void> {
    await this.inFirm(who.tenant.businessId, async (tx) => {
      const row = await this.visibleRow(tx, who, id);
      if (row.ownerUserId !== who.userId) throw ownerOnly();
      await tx.projectDeadline.delete({ where: { id } });
    });
    await this.audit.log('project_deadline.deleted', { type: 'project_deadline', id });
  }
}
