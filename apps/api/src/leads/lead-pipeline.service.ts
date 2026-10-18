import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  LeadOptions,
  LeadPipelinePage,
  LeadPipelineQuery,
  LeadPipelineSummary,
  LeadProfile,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import { zonedInstant } from '../reports/schedule-math.js';
import {
  loadProfile,
  type PipelineActor,
  reach,
  rowSelect,
  SOURCE_LABELS,
  toRow,
  visibleLead,
} from './pipeline.shared.js';

type Query = z.output<typeof LeadPipelineQuery>;

const DAY_MS = 86_400_000;
const NO_CLOSE = { not: 'CLOSE_LEAD' } as const;

/** Next action due and not yet done, on a lead that is still open. */
const overdue = (now: Date): Prisma.LeadWhereInput => ({
  nextActionAt: { lt: now },
  nextActionType: NO_CLOSE,
  status: { notIn: ['CONVERTED', 'DECLINED', 'LOST'] },
});

/** The Leads page's reads (R57): the table, the six cards, the dropdowns and the profile. */
@Injectable()
export class LeadPipelineService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private async timezone(businessId: string): Promise<string> {
    const s = await this.tenantPrisma.db.businessSettings.findUnique({
      where: { businessId },
      select: { timezone: true },
    });
    return s?.timezone ?? 'America/New_York';
  }

  async list(businessId: string, actor: PipelineActor, q: Query): Promise<LeadPipelinePage> {
    const now = new Date();
    const zone = q.from || q.to ? await this.timezone(businessId) : '';
    const term = q.search ? likeEscape(q.search) : undefined;
    const sources = q.search
      ? Object.entries(SOURCE_LABELS)
          .filter(([, label]) => label.toLowerCase().includes(q.search!.toLowerCase()))
          .map(([key]) => key as keyof typeof SOURCE_LABELS)
      : [];
    const where: Prisma.LeadWhereInput = {
      AND: [
        visibleLead(businessId),
        reach(actor),
        { archivedAt: null },
        q.source ? { source: q.source } : {},
        q.serviceId
          ? { OR: [{ serviceId: q.serviceId }, { services: { some: { serviceId: q.serviceId } } }] }
          : {},
        q.stage ? { status: q.stage } : {},
        q.overdue ? overdue(now) : {},
        q.assignedUserId ? { assignedUserId: q.assignedUserId } : {},
        q.from ? { createdAt: { gte: zonedInstant(q.from, '00:00', zone) } } : {},
        q.to
          ? { createdAt: { lt: new Date(zonedInstant(q.to, '00:00', zone).getTime() + DAY_MS) } }
          : {},
        q.priority ? { priority: q.priority } : {},
        // Leads carry no campaign yet: a campaign filter matches none.
        q.campaignId ? { id: { in: [] } } : {},
        q.tag ? { tags: { some: { tag: { name: { equals: q.tag, mode: 'insensitive' } } } } } : {},
        term
          ? {
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { businessName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
                { sourceDetail: { contains: term, mode: 'insensitive' } },
                ...(sources.length ? [{ source: { in: sources } }] : []),
                {
                  activities: {
                    some: { kind: 'NOTE', body: { contains: term, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const db = this.tenantPrisma.db.lead;
    const [total, rows] = await Promise.all([
      db.count({ where }),
      db.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: rowSelect,
      }),
    ]);
    await this.audit.log('leads.listed', { type: 'lead' }, { count: rows.length });
    return { items: rows.map((r) => toRow(r, now)), total, page: q.page, pageSize: q.pageSize };
  }

  /** The cards: today's counts, and last month's figure (leads added 30 to 60 days ago) to compare. */
  async summary(businessId: string, actor: PipelineActor): Promise<LeadPipelineSummary> {
    const now = new Date();
    const base: Prisma.LeadWhereInput = {
      AND: [visibleLead(businessId), reach(actor), { archivedAt: null }],
    };
    const lastMonth: Prisma.LeadWhereInput = {
      createdAt: {
        gte: new Date(now.getTime() - 60 * DAY_MS),
        lt: new Date(now.getTime() - 30 * DAY_MS),
      },
    };
    const db = this.tenantPrisma.db.lead;
    const by = (extra: Prisma.LeadWhereInput) =>
      db.groupBy({ by: ['status'], where: { AND: [base, extra] }, _count: { _all: true } });
    const [current, previous, late] = await Promise.all([
      by({}),
      by(lastMonth),
      db.count({ where: { AND: [base, overdue(now)] } }),
    ]);
    const sum = (rows: typeof current, ...statuses: string[]) =>
      rows
        .filter((r) => !statuses.length || statuses.includes(r.status))
        .reduce((n, r) => n + r._count._all, 0);
    // No figure for last month when the firm had no leads then: nothing to compare with.
    const card = (...statuses: string[]) => {
      const before = sum(previous, ...statuses);
      return { value: sum(current, ...statuses), previous: before === 0 ? null : before };
    };
    return {
      total: card(),
      new: card('SUBMITTED'),
      inFollowUp: card('IN_FOLLOW_UP'),
      converted: card('CONVERTED'),
      notQualified: card('DECLINED'),
      // "Overdue" is a state of today, not a count that was taken a month ago.
      overdueFollowUps: { value: late, previous: null },
    };
  }

  async options(businessId: string): Promise<LeadOptions> {
    const db = this.tenantPrisma.db;
    const [services, staff, tags] = await Promise.all([
      db.service.findMany({
        where: { businessId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      }),
      db.membership.findMany({
        where: { businessId, status: 'ACTIVE' },
        orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
        select: { userId: true, user: { select: { name: true } } },
      }),
      db.tag.findMany({
        where: { businessId, archivedAt: null },
        orderBy: { name: 'asc' },
        select: { name: true },
      }),
    ]);
    // `campaigns` is left out until leads can belong to one (Communications module).
    return {
      services,
      staff: staff.map((m) => ({ userId: m.userId, name: m.user.name })),
      tags: tags.map((t) => t.name),
    };
  }

  async profile(businessId: string, actor: PipelineActor, id: string): Promise<LeadProfile> {
    const profile = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      loadProfile(tx, businessId, actor, id),
    );
    await this.audit.log('lead.viewed', { type: 'lead', id }, { view: 'profile' });
    return profile;
  }
}
