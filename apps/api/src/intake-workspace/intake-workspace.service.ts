import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type { AssignedFormPage, AssignedFormRow, IntakeDashboardSummary } from '@firmivra/types';
import type { z } from 'zod';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import type { AssignedFormsQ } from './workspace-input.js';
import { day, iso, reachOf, TAB_STATUSES } from './workspace.common.js';

type Out<S extends z.ZodType> = z.output<S>;

export const rowInclude = {
  form: {
    select: {
      id: true,
      title: true,
      templateId: true,
      service: { select: { id: true, name: true } },
    },
  },
  engagement: {
    select: { client: { select: { id: true, displayName: true, email: true, phone: true } } },
  },
  lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.IntakeInclude;
export type RowSource = Prisma.IntakeGetPayload<{ include: typeof rowInclude }>;

/** A form the firm sent, as the Intake Forms table shows it. */
export function toRow(i: RowSource): AssignedFormRow {
  const recipient = i.engagement
    ? {
        kind: 'CLIENT' as const,
        id: i.engagement.client.id,
        name: i.engagement.client.displayName,
        email: i.engagement.client.email,
        phone: i.engagement.client.phone,
      }
    : {
        kind: 'LEAD' as const,
        id: (i.lead?.id ?? i.id) as string,
        name: `${i.lead?.firstName ?? ''} ${i.lead?.lastName ?? ''}`.trim(),
        email: i.lead?.email ?? null,
        phone: i.lead?.phone ?? null,
      };
  return {
    id: i.id,
    recipient,
    form: { id: i.form.templateId ?? i.form.id, name: i.form.title },
    service: i.form.service ? { id: i.form.service.id, name: i.form.service.name } : null,
    status: i.status,
    sentAt: iso(i.sentAt),
    lastActivityAt: iso(i.lastActivityAt),
    assignedTo: i.assignedMember
      ? { userId: i.assignedMember.userId, name: i.assignedMember.user.name }
      : null,
    dueOn: day(i.dueOn),
    expiresOn: day(i.expiresAt),
  };
}

/** The forms the firm sent: the summary cards and the table behind the tabs. */
@Injectable()
export class IntakeWorkspaceService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  summary(tenant: TenantContext, userId: string): Promise<IntakeDashboardSummary> {
    return this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const businessId = tenant.businessId;
        const reach = reachOf(tenant, userId);
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const by = await tx.intake.groupBy({
          by: ['status'],
          where: { AND: [{ businessId, status: { in: TAB_STATUSES.all } }, reach] },
          _count: { _all: true },
        });
        // Last month's figure: the same forms as they stood before this month began.
        const before = await tx.intake.groupBy({
          by: ['status'],
          where: {
            AND: [
              { businessId, status: { in: TAB_STATUSES.all }, sentAt: { lt: monthStart } },
              reach,
            ],
          },
          _count: { _all: true },
        });
        const sum = (rows: typeof by, statuses: string[]) =>
          rows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
        const count = (statuses: string[]) => ({
          value: sum(by, statuses),
          previous: sum(before, statuses),
        });
        const inProgress = ['IN_PROGRESS', 'NEEDS_CORRECTION'];
        const submitted = ['SUBMITTED', 'UNDER_REVIEW'];
        return {
          total: count(TAB_STATUSES.all as string[]),
          sent: count(['SENT']),
          inProgress: count(inProgress),
          completed: count(['COMPLETED']),
          expired: count(['EXPIRED']),
          byStatus: {
            notStarted: sum(by, ['SENT']),
            inProgress: sum(by, inProgress),
            submitted: sum(by, submitted),
            completed: sum(by, ['COMPLETED']),
            expired: sum(by, ['EXPIRED']),
          },
        };
      },
    );
  }

  list(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof AssignedFormsQ>,
  ): Promise<AssignedFormPage> {
    return this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const and: Prisma.IntakeWhereInput[] = [
          { businessId: tenant.businessId, status: { in: TAB_STATUSES[q.tab] } },
          reachOf(tenant, userId),
        ];
        if (q.assignedUserId) and.push({ assignedUserId: q.assignedUserId });
        if (q.formId) and.push({ form: { templateId: q.formId } });
        if (q.serviceId) and.push({ form: { serviceId: q.serviceId } });
        if (q.from) and.push({ sentAt: { gte: new Date(`${q.from}T00:00:00Z`) } });
        if (q.to)
          and.push({ sentAt: { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } });
        if (q.search)
          and.push({
            OR: [
              { form: { title: { contains: q.search, mode: 'insensitive' } } },
              {
                engagement: {
                  client: {
                    OR: [
                      { displayName: { contains: q.search, mode: 'insensitive' } },
                      { email: { contains: q.search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
              {
                lead: {
                  OR: [
                    { firstName: { contains: q.search, mode: 'insensitive' } },
                    { lastName: { contains: q.search, mode: 'insensitive' } },
                    { email: { contains: q.search, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          });
        const where: Prisma.IntakeWhereInput = { AND: and };
        const [total, rows] = await Promise.all([
          tx.intake.count({ where }),
          tx.intake.findMany({
            where,
            include: rowInclude,
            orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
            skip: (q.page - 1) * q.pageSize,
            take: q.pageSize,
          }),
        ]);
        return { items: rows.map(toRow), total, page: q.page, pageSize: q.pageSize };
      },
    );
  }
}
