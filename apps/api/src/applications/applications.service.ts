import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type Database } from '@firmivra/db';
import {
  FirmApplicationSummary,
  FirmApplicationDetail,
  ListAdminApplicationsResponse,
  ListAdminApplicationHistoryResponse,
  type ListAdminApplicationsQuery,
  type ListAdminApplicationHistoryQuery,
} from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import { decodeCursor, encodeCursor, missing, pageBoundary } from '../firm-common/context.js';
import { requireTables } from '../firm-common/schema.js';

const summarySelect = {
  id: true,
  status: true,
  legalName: true,
  dbaName: true,
  contactName: true,
  contactEmail: true,
  createdAt: true,
  updatedAt: true,
} as const;
const platform = () => ({
  businessId: '00000000-0000-4000-8000-000000000000',
  userId:
    requestContext.getStore()?.auth?.userId ??
    (() => {
      throw missing();
    })(),
});
type SummaryRow = {
  id: string;
  status: string;
  legalName: string;
  dbaName: string | null;
  contactName: string;
  contactEmail: string;
  createdAt: Date;
  updatedAt: Date;
};
const dto = (row: SummaryRow) =>
  FirmApplicationSummary.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
export function applicationForm(data: unknown) {
  const raw =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const text = (key: string, max: number) =>
    typeof raw[key] === 'string' ? (raw[key] as string).slice(0, max) : null;
  let website = text('website', 2048);
  try {
    if (website && !['https:', 'http:'].includes(new URL(website).protocol)) website = null;
  } catch {
    website = null;
  }
  return {
    website,
    addressLine1: text('addressLine1', 200),
    addressLine2: text('addressLine2', 200),
    city: text('city', 120),
    state: text('state', 120),
    postalCode: text('postalCode', 32),
    country: text('country', 2),
  };
}
@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}
  async list(query: ListAdminApplicationsQuery) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException({ code: 'INVALID_RANGE', message: 'Invalid date range' });
    const ctx = platform(),
      filters = {
        module: 'applications',
        status: query.status ?? null,
        search: query.search ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      };
    const cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await this.db.forPlatform().firmApplication.findMany({
      where: {
        ...pageBoundary(cursor),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              AND: [
                {
                  OR: [
                    { legalName: { contains: query.search, mode: 'insensitive' } },
                    { contactEmail: { contains: query.search, mode: 'insensitive' } },
                    { contactName: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: summarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    await this.audit.log(
      'application.listed',
      { type: 'firmApplication' },
      { status: query.status ?? null },
    );
    return ListAdminApplicationsResponse.parse({
      items: items.map(dto),
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, items.at(-1)!) : null,
    });
  }
  async detail(id: string) {
    const row = await this.db.forPlatform().firmApplication.findUnique({
      where: { id },
      select: {
        ...summarySelect,
        contactPhone: true,
        internalNotes: true,
        decisionReason: true,
        reviewedByUserId: true,
        reviewedAt: true,
        businessId: true,
        data: true,
      },
    });
    if (!row) throw missing();
    await this.audit.log('application.viewed', { type: 'firmApplication', id });
    const { data, ...fields } = row;
    return FirmApplicationDetail.parse({
      ...fields,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      form: applicationForm(data),
    });
  }
  async history(id: string, query: ListAdminApplicationHistoryQuery) {
    const ctx = platform(),
      filters = { module: 'application-history', id },
      cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await this.db.withScope({ kind: 'platform' }, async (tx) => {
      if (!(await tx.firmApplication.findUnique({ where: { id }, select: { id: true } })))
        throw missing();
      await requireTables(tx, ['firm_application_histories']);
      return tx.$queryRaw<
        {
          id: string;
          fromStatus: string | null;
          toStatus: string;
          actorUserId: string | null;
          reason: string | null;
          createdAt: Date;
        }[]
      >(Prisma.sql`
        SELECT id,from_status AS "fromStatus",to_status AS "toStatus",actor_user_id AS "actorUserId",reason,created_at AS "createdAt"
        FROM firm_application_histories WHERE application_id=${id}::uuid
        ${cursor ? Prisma.sql`AND (created_at,id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.empty}
        ORDER BY created_at DESC,id DESC LIMIT ${query.limit + 1}`);
    });
    const items = rows.slice(0, query.limit);
    await this.audit.log('application.history_viewed', { type: 'firmApplication', id });
    return ListAdminApplicationHistoryResponse.parse({
      items: items.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, items.at(-1)!) : null,
    });
  }
}
