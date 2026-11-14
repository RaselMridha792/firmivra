import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  LeadAgeBucket,
  LeadFunnelStage,
  LeadReport,
  LeadReportLeads,
  LeadReportLeadsQuery,
  LeadReportQuery,
} from '@firmivra/types';
import type { z } from 'zod';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { type PipelineActor, reach, visibleLead } from './pipeline.shared.js';

// Leads Review 2, R2 18: the funnel and aging reports (definitions in
// packages/types/src/leads/reports.ts). Read only, in the firm's scope, the Leads list's reach
// (Staff: their own leads). Counted in memory from the leads, their status changes and their
// newest meaningful activity: at most 5,000 leads per report.

type Query = z.output<typeof LeadReportQuery>;
type LeadsQuery = z.output<typeof LeadReportLeadsQuery>;

const DAY = 86_400_000;
const MAX = 5_000;
const STAGES: LeadFunnelStage[] = [
  'NEW',
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
  'CONVERTED',
];
const BUCKETS: LeadAgeBucket[] = ['D0_7', 'D8_14', 'D15_30', 'D31_60', 'D61_PLUS'];
/** A status as a funnel stage; closed statuses have none (their history decides). */
const STAGE_OF: Partial<Record<string, LeadFunnelStage>> = {
  SUBMITTED: 'NEW',
  IN_REVIEW: 'NEW',
  CONTACTED: 'CONTACTED',
  IN_FOLLOW_UP: 'IN_FOLLOW_UP',
  APPOINTMENT_SCHEDULED: 'APPOINTMENT_SCHEDULED',
  QUALIFIED: 'QUALIFIED',
  CONVERTED: 'CONVERTED',
};
/** Work on the lead (not its creation, a tag, an assignment or a campaign). */
const MEANINGFUL = [
  'STATUS_CHANGED',
  'FORM_SUBMITTED',
  'EMAIL_SENT',
  'SMS_SENT',
  'CALL',
  'MEETING',
  'NOTE',
  'FOLLOW_UP_COMPLETED',
  'APPOINTMENT_SCHEDULED',
  'DOCUMENT',
  'CONVERTED',
] as const;

const dateIn = (timeZone: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY);
const bucketOf = (days: number): LeadAgeBucket =>
  days <= 7
    ? 'D0_7'
    : days <= 14
      ? 'D8_14'
      : days <= 30
        ? 'D15_30'
        : days <= 60
          ? 'D31_60'
          : 'D61_PLUS';

type Row = {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  source: LeadReportLeads['items'][number]['source'];
  createdAt: Date;
  submittedAt: Date | null;
  assignedMember: { user: { name: string } } | null;
};
type Counted = Row & {
  /** The furthest funnel stage it reached (index into STAGES), or -1. */
  furthest: number;
  open: boolean;
  stage: LeadFunnelStage | null;
  daysInStage: number | null;
  daysIdle: number | null;
};

@Injectable()
export class LeadReportsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** The leads counted, each with its furthest stage and ages. */
  private async counted(businessId: string, actor: PipelineActor, q: Query) {
    return this.database.withScope({ kind: 'business', businessId }, async (tx: TxClient) => {
      const timeZone = await firmTimeZone(tx, businessId);
      const today = dateIn(timeZone, new Date());
      const to = q.to ?? today;
      const from = q.from ?? addDays(to, -89);
      if (daysBetween(from, to) > 731) {
        throw new BadRequestException({
          code: 'RANGE_TOO_LONG',
          message: 'Choose two years or less',
        });
      }
      const where: Prisma.LeadWhereInput = {
        AND: [
          visibleLead(businessId),
          reach(actor),
          // A merged duplicate is never counted twice.
          { mergedAt: null },
          q.archived === 'exclude' ? { archivedAt: null } : {},
          q.source ? { source: q.source } : {},
          // As the Leads list: the lead's first service or any of its services.
          q.serviceId
            ? {
                OR: [
                  { serviceId: q.serviceId },
                  { services: { some: { serviceId: q.serviceId } } },
                ],
              }
            : {},
          q.assignedUserId ? { assignedUserId: q.assignedUserId } : {},
          q.campaignId
            ? { commAudience: { some: { communicationId: q.campaignId, kind: 'LEAD' as const } } }
            : {},
          {
            createdAt: {
              gte: new Date(Date.parse(`${from}T00:00:00.000Z`) - DAY),
              lt: new Date(Date.parse(`${to}T00:00:00.000Z`) + 2 * DAY),
            },
          },
        ],
      };
      const rows: Row[] = (
        await tx.lead.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: MAX + 1,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true,
            source: true,
            createdAt: true,
            submittedAt: true,
            assignedMember: { select: { user: { select: { name: true } } } },
          },
        })
      ).filter((r) => {
        const on = dateIn(timeZone, r.createdAt);
        return on >= from && on <= to;
      });
      if (rows.length > MAX) {
        throw new BadRequestException({
          code: 'TOO_MANY_LEADS',
          message: 'Narrow the dates or filters: more than 5,000 leads',
        });
      }
      const ids = rows.map((r) => r.id);
      const [changes, work] = ids.length
        ? await Promise.all([
            tx.leadActivity.findMany({
              where: { businessId, leadId: { in: ids }, kind: 'STATUS_CHANGED' },
              select: { leadId: true, status: true, occurredAt: true },
            }),
            tx.leadActivity.groupBy({
              by: ['leadId'],
              where: { businessId, leadId: { in: ids }, kind: { in: [...MEANINGFUL] } },
              _max: { occurredAt: true },
            }),
          ])
        : [[], []];
      const history = new Map<string, { status: string | null; occurredAt: Date }[]>();
      for (const c of changes) history.set(c.leadId, [...(history.get(c.leadId) ?? []), c]);
      const lastWork = new Map(work.map((w) => [w.leadId, w._max.occurredAt]));

      const items: Counted[] = rows.map((r) => {
        const stage = STAGE_OF[r.status] ?? null;
        const past = history.get(r.id) ?? [];
        const furthest = Math.max(
          stage ? STAGES.indexOf(stage) : -1,
          // A submitted lead reached New, whatever happened next.
          0,
          ...past.map((h) =>
            h.status && STAGE_OF[h.status] ? STAGES.indexOf(STAGE_OF[h.status]!) : -1,
          ),
        );
        const open = !!stage && stage !== 'CONVERTED';
        const into = past
          .filter((h) => h.status === r.status)
          .reduce<Date | null>((a, h) => (!a || h.occurredAt > a ? h.occurredAt : a), null);
        const since = into ?? r.submittedAt ?? r.createdAt;
        const worked = lastWork.get(r.id) ?? null;
        return {
          ...r,
          furthest,
          open,
          stage,
          daysInStage: open ? Math.max(0, daysBetween(dateIn(timeZone, since), today)) : null,
          daysIdle: worked ? Math.max(0, daysBetween(dateIn(timeZone, worked), today)) : null,
        };
      });
      return { from, to, today, items };
    });
  }

  async report(businessId: string, actor: PipelineActor, q: Query): Promise<LeadReport> {
    const { from, to, today, items } = await this.counted(businessId, actor, q);
    const open = items.filter((i) => i.open);
    const converted = items.filter((i) => i.status === 'CONVERTED').length;
    const result: LeadReport = {
      from,
      to,
      today,
      total: items.length,
      funnel: STAGES.map((stage, n) => ({
        stage,
        reached: items.filter((i) => i.furthest >= n).length,
        current: items.filter((i) => i.stage === stage).length,
      })),
      closed: {
        notQualified: items.filter((i) => i.status === 'DECLINED').length,
        lost: items.filter((i) => i.status === 'LOST').length,
      },
      conversionRate: items.length ? converted / items.length : null,
      aging: {
        open: open.length,
        inStage: BUCKETS.map((bucket) => ({
          bucket,
          count: open.filter((i) => bucketOf(i.daysInStage!) === bucket).length,
        })),
        idle: BUCKETS.map((bucket) => ({
          bucket,
          count: open.filter((i) => i.daysIdle !== null && bucketOf(i.daysIdle) === bucket).length,
        })),
        noActivity: open.filter((i) => i.daysIdle === null).length,
        byStage: STAGES.filter((s) => s !== 'CONVERTED').map((stage) => {
          const here = open.filter((i) => i.stage === stage);
          return {
            stage,
            open: here.length,
            averageDays: here.length
              ? Math.round(here.reduce((n, i) => n + i.daysInStage!, 0) / here.length)
              : null,
          };
        }),
      },
    };
    await this.audit.log(
      'leads.funnel_report_viewed',
      { type: 'lead' },
      { from, to, total: result.total },
    );
    return result;
  }

  async leads(businessId: string, actor: PipelineActor, q: LeadsQuery): Promise<LeadReportLeads> {
    const { items } = await this.counted(businessId, actor, q);
    const bad = () =>
      new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose a number to open' });
    const stage = STAGES.indexOf(q.key as LeadFunnelStage);
    const bucket = q.key as LeadAgeBucket;
    let picked: Counted[];
    switch (q.metric) {
      case 'REACHED':
        if (stage < 0) throw bad();
        picked = items.filter((i) => i.furthest >= stage);
        break;
      case 'CURRENT':
      case 'OPEN_STAGE':
        if (stage < 0) throw bad();
        picked = items.filter((i) => i.stage === STAGES[stage]);
        break;
      case 'CLOSED':
        if (q.key !== 'NOT_QUALIFIED' && q.key !== 'LOST') throw bad();
        picked = items.filter((i) => i.status === (q.key === 'LOST' ? 'LOST' : 'DECLINED'));
        break;
      case 'IN_STAGE':
        if (!BUCKETS.includes(bucket)) throw bad();
        picked = items.filter((i) => i.open && bucketOf(i.daysInStage!) === bucket);
        break;
      case 'IDLE':
        if (q.key === 'NONE') {
          picked = items.filter((i) => i.open && i.daysIdle === null);
        } else {
          if (!BUCKETS.includes(bucket)) throw bad();
          picked = items.filter(
            (i) => i.open && i.daysIdle !== null && bucketOf(i.daysIdle) === bucket,
          );
        }
        break;
    }
    const sorted = picked.sort(
      (a, b) =>
        (b.daysInStage ?? -1) - (a.daysInStage ?? -1) ||
        (b.daysIdle ?? -1) - (a.daysIdle ?? -1) ||
        a.id.localeCompare(b.id),
    );
    await this.audit.log(
      'leads.funnel_report_leads_viewed',
      { type: 'lead' },
      { metric: q.metric, key: q.key, count: sorted.length },
    );
    return {
      items: sorted.slice(0, 200).map((i) => ({
        id: i.id,
        name: `${i.firstName} ${i.lastName}`.trim(),
        status: i.status as LeadReportLeads['items'][number]['status'],
        source: i.source,
        owner: i.assignedMember?.user.name ?? null,
        createdAt: i.createdAt.toISOString(),
        daysInStage: i.daysInStage,
        daysIdle: i.daysIdle,
      })),
      total: sorted.length,
    };
  }
}
