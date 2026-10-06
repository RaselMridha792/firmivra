import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { TaxStatus } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';

/** At most this many statuses per firm, archived ones included. */
export const MAX_TAX_STATUSES = 500;

const select = {
  id: true,
  name: true,
  sortOrder: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
const displayOrder = [{ sortOrder: 'asc' }, { id: 'asc' }] as const;

type Row = { id: string; name: string; sortOrder: number; archivedAt: Date | null } & {
  createdAt: Date;
  updatedAt: Date;
};

const toTaxStatus = (row: Row): TaxStatus => ({
  id: row.id,
  name: row.name,
  sortOrder: row.sortOrder,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

/**
 * A new order must name every active status exactly once: an unknown id is 404, anything else
 * that does not match the active set is 409 CONFLICT.
 */
export function checkOrder(ids: string[], rows: { id: string; archivedAt: Date | null }[]): void {
  const known = new Set(rows.map((row) => row.id));
  if (ids.some((id) => !known.has(id))) throw notFound();
  const active = new Set(rows.filter((row) => !row.archivedAt).map((row) => row.id));
  if (
    ids.length !== active.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !active.has(id))
  ) {
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'Order must contain every active status exactly once',
    });
  }
}

/**
 * The firm's tax statuses (Settings > Tax statuses; contract in packages/types/src/tax-statuses).
 * Business scope only; `businessId` comes from TenantGuard. Changes run one at a time per firm,
 * so names stay unique ignoring case and the 500 limit holds. Archived, never deleted.
 */
@Injectable()
export class TaxStatusesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async list(businessId: string, includeArchived: boolean): Promise<TaxStatus[]> {
    const rows = await this.database.forBusiness(businessId).taxStatus.findMany({
      where: { businessId, ...(includeArchived ? {} : { archivedAt: null }) },
      select,
      orderBy: [...displayOrder],
      take: MAX_TAX_STATUSES,
    });
    return rows.map(toTaxStatus);
  }

  async create(businessId: string, name: string): Promise<TaxStatus> {
    const row = await this.change(businessId, async (tx) => {
      await this.unique(tx, businessId, name);
      if ((await tx.taxStatus.count({ where: { businessId } })) >= MAX_TAX_STATUSES) {
        throw new ConflictException({
          code: 'CONFIGURATION_LIMIT',
          message: 'The maximum number of status definitions has been reached',
        });
      }
      const last = await tx.taxStatus.aggregate({
        where: { businessId, archivedAt: null },
        _max: { sortOrder: true },
      });
      return tx.taxStatus.create({
        data: { businessId, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
        select,
      });
    });
    await this.audit.log('tax_status.created', { type: 'tax_status', id: row.id });
    return toTaxStatus(row);
  }

  async rename(businessId: string, id: string, name: string): Promise<TaxStatus> {
    const row = await this.change(businessId, async (tx) => {
      await this.find(tx, businessId, id);
      await this.unique(tx, businessId, name, id);
      return tx.taxStatus.update({ where: { id }, data: { name }, select });
    });
    await this.audit.log('tax_status.renamed', { type: 'tax_status', id });
    return toTaxStatus(row);
  }

  async reorder(businessId: string, ids: string[]): Promise<TaxStatus[]> {
    const rows = await this.change(businessId, async (tx) => {
      const all = await tx.taxStatus.findMany({
        where: { businessId },
        select: { id: true, archivedAt: true },
      });
      checkOrder(ids, all);
      for (const [sortOrder, id] of ids.entries()) {
        await tx.taxStatus.update({ where: { id }, data: { sortOrder } });
      }
      return tx.taxStatus.findMany({
        where: { businessId, archivedAt: null },
        select,
        orderBy: [...displayOrder],
      });
    });
    await this.audit.log('tax_status.reordered', { type: 'tax_status' }, { count: ids.length });
    return rows.map(toTaxStatus);
  }

  /** Hides the status from new choices; client years that use it keep it. Repeating is harmless. */
  async archive(businessId: string, id: string): Promise<TaxStatus> {
    const { row, changed } = await this.change(businessId, async (tx) => {
      const found = await this.find(tx, businessId, id);
      if (found.archivedAt) return { row: found, changed: false };
      const archived = await tx.taxStatus.update({
        where: { id },
        data: { archivedAt: new Date() },
        select,
      });
      return { row: archived, changed: true };
    });
    if (changed) await this.audit.log('tax_status.archived', { type: 'tax_status', id });
    return toTaxStatus(row);
  }

  /** Runs a change in the firm's scope, one at a time per firm. */
  private change<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const key = `tax_statuses:${businessId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      return fn(tx);
    });
  }

  private async find(tx: TxClient, businessId: string, id: string) {
    const row = await tx.taxStatus.findFirst({ where: { businessId, id }, select });
    if (!row) throw notFound();
    return row;
  }

  /** Names are unique within the firm ignoring case, archived statuses included. */
  private async unique(tx: TxClient, businessId: string, name: string, exceptId?: string) {
    const duplicate = await tx.taxStatus.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_NAME',
        message: 'A tax status with this name already exists',
      });
    }
  }
}
