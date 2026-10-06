import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { FirmTaxStatus, ListTaxStatusesResponse, type ListTaxStatusesQuery } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { activeManager, firmContext, missing } from '../firm-common/context.js';
const select = {
  id: true,
  name: true,
  sortOrder: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
type StatusRow = {
  id: string;
  name: string;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
const dto = (row: StatusRow) =>
  FirmTaxStatus.parse({
    ...row,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
export function validateTaxOrder(ids: string[], rows: { id: string; archivedAt: Date | null }[]) {
  if (ids.some((id) => !rows.some((row) => row.id === id))) throw missing();
  const active = rows.filter((row) => !row.archivedAt);
  if (
    ids.length !== active.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !active.some((row) => row.id === id))
  )
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'Order must contain every active status exactly once',
    });
}
@Injectable()
export class TaxStatusesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}
  async list(query: ListTaxStatusesQuery) {
    const ctx = firmContext();
    const rows = await this.db.forBusiness(ctx.businessId).taxStatus.findMany({
      where: {
        businessId: ctx.businessId,
        ...(query.includeArchived ? {} : { archivedAt: null }),
      },
      select,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    await this.audit.log(
      'tax_status.listed',
      { type: 'taxStatus' },
      { includeArchived: query.includeArchived },
    );
    return ListTaxStatusesResponse.parse({ items: rows.map(dto) });
  }
  private async write<T>(fn: (tx: TxClient, businessId: string) => Promise<T>) {
    const ctx = firmContext();
    return this.db.withScope({ kind: 'business', businessId: ctx.businessId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id=${ctx.businessId}::uuid FOR UPDATE`;
      await activeManager(tx, ctx);
      return fn(tx, ctx.businessId);
    });
  }
  private async unique(tx: TxClient, businessId: string, name: string, exceptId?: string) {
    const duplicate = await tx.taxStatus.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException({
        code: 'DUPLICATE_NAME',
        message: 'A tax status with this name already exists',
      });
  }
  async create(name: string) {
    const row = await this.write(async (tx, businessId) => {
      const clean = name.trim();
      await this.unique(tx, businessId, clean);
      if ((await tx.taxStatus.count({ where: { businessId } })) >= 500)
        throw new ConflictException({
          code: 'CONFIGURATION_LIMIT',
          message: 'The maximum number of status definitions has been reached',
        });
      const last = await tx.taxStatus.aggregate({
        where: { businessId, archivedAt: null },
        _max: { sortOrder: true },
      });
      return tx.taxStatus.create({
        data: { businessId, name: clean, sortOrder: (last._max.sortOrder ?? -1) + 1 },
        select,
      });
    });
    await this.audit.log('tax_status.created', { type: 'taxStatus', id: row.id });
    return dto(row);
  }
  async rename(id: string, name: string) {
    const row = await this.write(async (tx, businessId) => {
      const found = await tx.taxStatus.findFirst({
        where: { businessId, id },
        select: { id: true },
      });
      if (!found) throw missing();
      const clean = name.trim();
      await this.unique(tx, businessId, clean, id);
      return tx.taxStatus.update({ where: { id }, data: { name: clean }, select });
    });
    await this.audit.log('tax_status.renamed', { type: 'taxStatus', id });
    return dto(row);
  }
  async order(ids: string[]) {
    const rows = await this.write(async (tx, businessId) => {
      const all = await tx.taxStatus.findMany({
        where: { businessId },
        select: { id: true, archivedAt: true },
      });
      validateTaxOrder(ids, all);
      for (const [sortOrder, id] of ids.entries())
        await tx.taxStatus.update({ where: { id }, data: { sortOrder } });
      return tx.taxStatus.findMany({
        where: { businessId, archivedAt: null },
        select,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
    });
    await this.audit.log('tax_status.reordered', { type: 'taxStatus' }, { count: ids.length });
    return ListTaxStatusesResponse.parse({ items: rows.map(dto) });
  }
  async archive(id: string) {
    const row = await this.write(async (tx, businessId) => {
      const found = await tx.taxStatus.findFirst({ where: { businessId, id }, select });
      if (!found) throw missing();
      return found.archivedAt
        ? found
        : tx.taxStatus.update({ where: { id }, data: { archivedAt: new Date() }, select });
    });
    await this.audit.log('tax_status.archived', { type: 'taxStatus', id });
    return dto(row);
  }
}
