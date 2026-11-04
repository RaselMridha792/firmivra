import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  BookkeepingCategoryList,
  BookkeepingTransactionPage,
  ListBookkeepingTransactionsQuery,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { type BookkeepingActor, findProfile } from './bookkeeping.mappers.js';
import { inFirm } from './bookkeeping.shared.js';

type Query = z.output<typeof ListBookkeepingTransactionsQuery>;
const day = (d: Date) => d.toISOString().slice(0, 10);
const date = (s: string) => new Date(`${s}T00:00:00.000Z`);

const select = {
  id: true,
  transactionDate: true,
  description: true,
  payee: true,
  amountCents: true,
  direction: true,
  kind: true,
  status: true,
  source: true,
  receiptDocumentId: true,
  clearedReconciliationId: true,
  account: { select: { id: true, name: true, mask: true } },
  category: { select: { id: true, name: true } },
  _count: { select: { splits: true } },
} satisfies Prisma.BookkeepingTransactionSelect;

/**
 * Bookkeeping Transactions, the read side (Octavia's BK-T01): a client's ledger lines from
 * `bookkeeping_transactions`, newest first, with search, filters and the counts by status, and
 * the categories. Everyone with Bookkeeping's view reads; Staff only their clients' (findProfile).
 * Reads are audited with ids and counts only.
 */
@Injectable()
export class BookkeepingTransactionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async list(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    q: Query,
  ): Promise<BookkeepingTransactionPage> {
    const result = await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const base = { businessId, engagementId: p.engagementId };
      const term = q.search?.trim();
      const where: Prisma.BookkeepingTransactionWhereInput = {
        ...base,
        ...(q.status ? { status: q.status } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.direction ? { direction: q.direction } : {}),
        ...(q.accountId ? { accountId: q.accountId } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.from || q.to
          ? {
              transactionDate: {
                ...(q.from ? { gte: date(q.from) } : {}),
                ...(q.to ? { lte: date(q.to) } : {}),
              },
            }
          : {}),
        ...(term
          ? {
              OR: [
                { description: { contains: term, mode: 'insensitive' as const } },
                { payee: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [rows, total, byStatus] = await Promise.all([
        tx.bookkeepingTransaction.findMany({
          where,
          select,
          orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.bookkeepingTransaction.count({ where }),
        tx.bookkeepingTransaction.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      ]);
      return { rows, total, byStatus };
    });
    const count = (s: string) => result.byStatus.find((g) => g.status === s)?._count._all ?? 0;
    await this.audit.log(
      'bookkeeping.transactions.listed',
      { type: 'bookkeeping_client', id },
      { count: result.rows.length },
    );
    return {
      items: result.rows.map((r) => ({
        id: r.id,
        transactionDate: day(r.transactionDate),
        description: r.description,
        payee: r.payee,
        amountCents: r.amountCents,
        direction: r.direction,
        kind: r.kind,
        status: r.status,
        account: { id: r.account.id, name: r.account.name, mask: r.account.mask },
        category: r.category ? { id: r.category.id, name: r.category.name } : null,
        source: r.source,
        splitCount: r._count.splits,
        hasReceipt: r.receiptDocumentId !== null,
        cleared: r.clearedReconciliationId !== null,
      })),
      total: result.total,
      page: q.page,
      pageSize: q.pageSize,
      counts: {
        all: result.byStatus.reduce((sum, g) => sum + g._count._all, 0),
        uncategorized: count('UNCATEGORIZED'),
        needsReview: count('NEEDS_REVIEW'),
        categorized: count('CATEGORIZED'),
        matched: count('MATCHED'),
        excluded: count('EXCLUDED'),
      },
    };
  }

  async categories(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingCategoryList> {
    const rows = await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      return tx.bookkeepingCategory.findMany({
        where: { businessId, engagementId: p.engagementId },
        select: { id: true, name: true, type: true, isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
    });
    await this.audit.log(
      'bookkeeping.categories.listed',
      { type: 'bookkeeping_client', id },
      { count: rows.length },
    );
    return {
      items: rows.map((c) => ({ id: c.id, name: c.name, type: c.type, active: c.isActive })),
    };
  }
}
