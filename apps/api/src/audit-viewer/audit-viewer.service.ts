import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { type Database, type TxClient } from '@firmivra/db';
import { z } from 'zod';
import { ListFirmAuditLogsResponse, type ListFirmAuditLogsQuery } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import {
  firmContext,
  decodeCursor,
  encodeCursor,
  pageBoundary,
  missing,
} from '../firm-common/context.js';
import { currentActor, denied } from '../firm-common/actor.js';
import { ApprovedSupportAccess } from './support.ports.js';
const safeEnums = new Set([
  'OWNER',
  'ADMIN',
  'STAFF',
  'CLIENT',
  'ACTIVE',
  'INVITED',
  'DEACTIVATED',
  'BOOKED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'APPOINTMENT',
  'DOCUMENT',
  'SERVICE',
  'BILLING',
  'SECURITY',
  'LEGAL',
  'MARKETING',
  'PENDING_REVIEW',
  'INFO_REQUESTED',
  'APPROVED',
  'DECLINED',
]);
export function safeAuditMetadata(input: unknown) {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (
      ['count', 'version', 'limit'].includes(key) &&
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
      out[key] = value;
    if (['includeArchived', 'support', 'complete'].includes(key) && typeof value === 'boolean')
      out[key] = value;
    if (
      ['role', 'previousRole', 'newRole', 'status', 'category', 'kind'].includes(key) &&
      typeof value === 'string' &&
      safeEnums.has(value)
    )
      out[key] = value;
    if (key === 'grantId' && z.uuid().safeParse(value).success) out[key] = value;
  }
  return out;
}
@Injectable()
export class AuditViewerService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly support: ApprovedSupportAccess,
  ) {}
  private async read(
    tx: TxClient,
    ctx: { businessId: string; userId: string },
    query: ListFirmAuditLogsQuery,
  ) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException({ code: 'INVALID_RANGE', message: 'Invalid date range' });
    const filters = {
        module: 'audit',
        from: query.from ?? null,
        to: query.to ?? null,
        action: query.action ?? null,
        entityType: query.entityType ?? null,
        actor: query.actorUserId ?? null,
      },
      cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await tx.auditLog.findMany({
      where: {
        businessId: ctx.businessId,
        ...pageBoundary(cursor),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      },
      select: {
        id: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        requestId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return ListFirmAuditLogsResponse.parse({
      items: items.map((row) => ({
        ...row,
        metadata: safeAuditMetadata(row.metadata),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, items.at(-1)!) : null,
    });
  }
  async own(query: ListFirmAuditLogsQuery) {
    const ctx = firmContext();
    const result = await this.db.withScope(
      { kind: 'business', businessId: ctx.businessId },
      async (tx) => {
        if ((await currentActor(tx, ctx)).role !== 'OWNER') throw denied();
        return this.read(tx, ctx, query);
      },
    );
    await this.audit.log('audit.viewed', { type: 'auditLog' });
    return result;
  }
  async supported(selector: string, query: ListFirmAuditLogsQuery) {
    const store = requestContext.getStore(),
      userId = store?.auth?.userId;
    if (!store || !userId) throw missing();
    return this.support.withFirm(selector, userId, async (tx, scope) => {
      if (
        scope.businessId !== selector ||
        scope.adminUserId !== userId ||
        !z.uuid().safeParse(scope.grantId).success
      )
        throw missing();
      const result = await this.read(tx, { businessId: scope.businessId, userId }, query);
      await requestContext.run(
        { ...store, tenant: { businessId: scope.businessId, kind: 'staff', role: 'STAFF' } },
        () =>
          this.audit.log(
            'audit.support_viewed',
            { type: 'auditLog' },
            { grantId: scope.grantId, support: true },
          ),
      );
      return result;
    });
  }
}
