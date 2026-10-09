import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  IntakeFormDefinition,
  type LeadCounts,
  type LeadDetail,
  type LeadList,
  type LeadListItem,
  type ListLeadsQuery,
  type ReviewedLeadStatus,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type ClientsActor, decodeCursor, likeEscape } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { maskStoredNumbers } from '../intake/intake-numbers.js';

type ListQuery = z.output<typeof ListLeadsQuery>;

/** The statuses the firm sees: never a draft the visitor has not sent. */
export const REVIEWED: ReviewedLeadStatus[] = ['SUBMITTED', 'IN_REVIEW', 'CONVERTED', 'DECLINED'];
export const OPEN = ['SUBMITTED', 'IN_REVIEW'] as const;

export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
export const conflict = (code: string, message: string) => new ConflictException({ code, message });
export const handled = () => conflict('INVALID_STATUS', 'This lead was already handled');

const listSelect = {
  id: true,
  status: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  taxYear: true,
  submittedAt: true,
  createdAt: true,
  service: { select: { id: true, name: true, kind: true } },
} satisfies Prisma.LeadSelect;

const detailSelect = {
  ...listSelect,
  reviewedAt: true,
  reviewedByUserId: true,
  declineReason: true,
  clientId: true,
  engagementId: true,
  engagement: { select: { client: { select: { id: true, displayName: true } } } },
  intakes: {
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: {
      id: true,
      status: true,
      form: { select: { version: true, definition: true } },
      submissions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { answers: true },
      },
    },
  },
  uploads: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      slot: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      scanStatus: true,
      createdAt: true,
    },
  },
} satisfies Prisma.LeadSelect;

type ListRow = Prisma.LeadGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.LeadGetPayload<{ select: typeof detailSelect }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

function toItem(row: ListRow): LeadListItem {
  return {
    id: row.id,
    status: row.status as ReviewedLeadStatus,
    service: row.service,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    taxYear: row.taxYear,
    // Every lead the firm sees was sent (leads_submitted_at).
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The paging cursor of the inbox: the last row's sent time and id. */
const encodeCursor = (row: { submittedAt: Date | null; id: string }) =>
  Buffer.from(`${row.submittedAt?.toISOString() ?? ''}|${row.id}`).toString('base64url');

/**
 * The firm's Begin Online leads (R11 step 4): the inbox, review and decline. Every member of the
 * firm sees every lead the visitor sent; a draft never shows. Converting is LeadConvertService.
 */
@Injectable()
export class LeadsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string, q: ListQuery): Promise<LeadList> {
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const term = q.search ? likeEscape(q.search) : undefined;
    const where: Prisma.LeadWhereInput = {
      AND: [
        { businessId, status: q.status ?? { in: REVIEWED } },
        q.serviceId ? { serviceId: q.serviceId } : {},
        term
          ? {
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {},
        after
          ? {
              OR: [
                { submittedAt: { lt: after.createdAt } },
                { submittedAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {},
      ],
    };
    const rows = await this.database.forBusiness(businessId).lead.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      select: listSelect,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log('leads.listed', { type: 'lead' }, { count: page.length });
    return {
      items: page.map(toItem),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  async counts(businessId: string): Promise<LeadCounts> {
    const groups = await this.database.forBusiness(businessId).lead.groupBy({
      by: ['status'],
      where: { businessId, status: { in: [...OPEN] } },
      _count: { _all: true },
    });
    const of = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
    return { submitted: of('SUBMITTED'), inReview: of('IN_REVIEW') };
  }

  async get(businessId: string, id: string): Promise<LeadDetail> {
    const detail = await this.inFirm(businessId, (tx) => this.detail(tx, businessId, id));
    await this.audit.log('lead.viewed', { type: 'lead', id });
    return detail;
  }

  /** SUBMITTED to IN_REVIEW, naming who took it. */
  async startReview(businessId: string, actor: ClientsActor, id: string): Promise<LeadDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      const lead = await this.lock(tx, businessId, id);
      if (lead.status !== 'SUBMITTED') throw conflict('INVALID_STATUS', 'Not a new lead');
      await tx.lead.update({
        where: { id },
        data: { status: 'IN_REVIEW', reviewedByUserId: actor.userId, reviewedAt: new Date() },
      });
      return this.detail(tx, businessId, id);
    });
    await this.audit.log('lead.review_started', { type: 'lead', id });
    return detail;
  }

  async decline(
    businessId: string,
    actor: ClientsActor,
    id: string,
    reason: string,
  ): Promise<LeadDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      const lead = await this.lock(tx, businessId, id);
      if (!OPEN.includes(lead.status as (typeof OPEN)[number])) throw handled();
      await tx.lead.update({
        where: { id },
        data: {
          status: 'DECLINED',
          declineReason: reason,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        },
      });
      return this.detail(tx, businessId, id);
    });
    // The reason stays out of the audit metadata too: it is free text about a person.
    await this.audit.log('lead.declined', { type: 'lead', id });
    return detail;
  }

  /** The lead, held for this transaction (for convert too); 404 for a draft, an expired draft or another firm's. */
  async lock(tx: TxClient, businessId: string, id: string) {
    const rows = await tx.$queryRaw<
      { id: string; status: string; service_id: string }[]
    >`SELECT id, status::text, service_id FROM leads WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row || !REVIEWED.includes(row.status as ReviewedLeadStatus)) throw notFound();
    return tx.lead.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        serviceId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        taxYear: true,
      },
    });
  }

  async detail(tx: TxClient, businessId: string, id: string): Promise<LeadDetail> {
    const row = await tx.lead.findFirst({
      where: { businessId, id, status: { in: REVIEWED } },
      select: detailSelect,
    });
    if (!row) throw notFound();
    const reviewer = row.reviewedByUserId
      ? await tx.membership.findFirst({
          where: { businessId, userId: row.reviewedByUserId },
          select: { userId: true, user: { select: { name: true } } },
        })
      : null;
    return {
      ...toItem(row),
      intake: await this.intakeOf(row),
      reviewedAt: iso(row.reviewedAt),
      reviewedBy: reviewer ? { userId: reviewer.userId, name: reviewer.user.name } : null,
      declineReason: row.declineReason,
      client: row.engagement?.client ?? null,
      engagementId: row.engagementId,
    };
  }

  private async intakeOf(row: DetailRow): Promise<LeadDetail['intake']> {
    const intake = row.intakes[0];
    if (!intake) return null;
    const definition = IntakeFormDefinition.parse(intake.form.definition);
    const stored = (intake.submissions[0]?.answers ?? {}) as Record<string, unknown>;
    return {
      id: intake.id,
      status: intake.status,
      formVersion: intake.form.version,
      definition,
      answers: await maskStoredNumbers(definition, stored),
      uploads: row.uploads.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    };
  }
}
