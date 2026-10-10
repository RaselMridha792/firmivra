import { Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import { withJobLock } from '../completion/prisma-completion.repository.js';
import { inFirm, InjectDatabase } from '../requests/esign-prisma.js';
import type {
  EsignBulkBatchRecord,
  EsignBulkItemPatch,
  EsignBulkItemRecord,
  EsignBulkRepository,
} from './bulk.repository.js';

/**
 * Bulk send in PostgreSQL (R13, r0_esign): the insert-only batch (ids and role fills only, never
 * an access code) and its rows, which change only while QUEUED, in the firm's scope.
 */
@Injectable()
export class PrismaBulkRepository implements EsignBulkRepository {
  constructor(@InjectDatabase() private readonly database: Database) {}

  async create(businessId: string, batch: EsignBulkBatchRecord): Promise<void> {
    const { items, roles, ...rest } = batch;
    await inFirm(this.database, businessId, async (tx) => {
      await tx.esignBulkBatch.create({
        data: { ...rest, businessId, roles: roles as unknown as Prisma.InputJsonValue },
      });
      await tx.esignBulkItem.createMany({
        data: items.map((i) => ({ ...i, businessId, batchId: batch.id })),
      });
    });
  }

  async find(businessId: string, id: string): Promise<EsignBulkBatchRecord | null> {
    const row = await this.database.forBusiness(businessId).esignBulkBatch.findFirst({
      where: { id },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!row) return null;
    const { businessId: _b, items, roles, ...batch } = row;
    return {
      ...batch,
      roles: roles as unknown as EsignBulkBatchRecord['roles'],
      items: items.map(({ businessId: _ib, batchId: _bid, ...i }): EsignBulkItemRecord => ({
        ...i,
        problem: i.problem as EsignBulkItemRecord['problem'],
      })),
    };
  }

  async updateItem(
    businessId: string,
    batchId: string,
    position: number,
    patch: EsignBulkItemPatch,
  ): Promise<boolean> {
    const updated = await this.database.forBusiness(businessId).esignBulkItem.updateMany({
      where: { batchId, position, state: 'QUEUED' },
      data: patch,
    });
    return updated.count === 1;
  }

  withJobLock<T>(work: () => Promise<T>): Promise<T | null> {
    return withJobLock(this.database, 'bulk', work);
  }

  async queued(businessId: string, limit: number) {
    return this.database.forBusiness(businessId).esignBulkItem.findMany({
      where: { state: 'QUEUED' },
      orderBy: [{ batch: { createdAt: 'asc' } }, { batchId: 'asc' }, { position: 'asc' }],
      take: limit,
      select: { batchId: true, position: true },
    });
  }
}
