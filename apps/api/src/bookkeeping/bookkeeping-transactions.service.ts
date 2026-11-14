import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AttachBookkeepingReceiptRequest,
  BookkeepingCategoryList,
  BookkeepingTransactionPage,
  BookkeepingTransactionRow,
  BookkeepingTransferCandidates,
  BulkBookkeepingTransactionsRequest,
  BulkBookkeepingTransactionsResult,
  CategorizeBookkeepingTransactionRequest,
  ExcludeBookkeepingTransactionRequest,
  ListBookkeepingTransactionsQuery,
  MatchBookkeepingTransferRequest,
  SplitBookkeepingTransactionRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { type BookkeepingActor, findProfile } from './bookkeeping.mappers.js';
import { errors, inFirm, mapBookkeepingDbError } from './bookkeeping.shared.js';

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
        // Review 2 (T01a): by source, and by amount (both ends included).
        ...(q.source ? { source: q.source } : {}),
        ...(q.amountMin !== undefined || q.amountMax !== undefined
          ? {
              amountCents: {
                ...(q.amountMin !== undefined ? { gte: q.amountMin } : {}),
                ...(q.amountMax !== undefined ? { lte: q.amountMax } : {}),
              },
            }
          : {}),
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

  // ---------- BK-T01 engines ----------

  private toRow(r: Prisma.BookkeepingTransactionGetPayload<{ select: typeof select }>) {
    return {
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
    };
  }

  /** The client's line (Staff: their clients'), or 404. */
  private async line(
    tx: TxClient,
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
  ) {
    const p = await findProfile(tx, businessId, actor, id);
    const row = await tx.bookkeepingTransaction.findFirst({
      where: { businessId, engagementId: p.engagementId, id: txnId },
      select: {
        id: true,
        engagementId: true,
        accountId: true,
        amountCents: true,
        direction: true,
        kind: true,
        transferPairId: true,
        categoryId: true,
        transactionDate: true,
        _count: { select: { splits: true } },
      },
    });
    if (!row) throw errors.notFound();
    return row;
  }

  /** One of the client's categories, active; 404 when not the client's, 409 when inactive. */
  private async activeCategory(
    tx: TxClient,
    businessId: string,
    engagementId: string,
    categoryId: string,
  ) {
    const c = await tx.bookkeepingCategory.findFirst({
      where: { businessId, engagementId, id: categoryId },
      select: { isActive: true },
    });
    if (!c) throw errors.notFound();
    if (!c.isActive) throw errors.categoryInactive();
  }

  /** A transfer is undone on both sides (each back to a plain line waiting for a category). */
  private async unpair(tx: TxClient, businessId: string, pairId: string | null) {
    if (!pairId) return;
    await tx.bookkeepingTransaction.update({
      where: { businessId_id: { businessId, id: pairId } },
      data: { transferPairId: null, kind: 'STANDARD', status: 'UNCATEGORIZED' },
    });
  }

  /** Runs one change in its own transaction; the ledger's rules come back as the contract's 409s. */
  private async change(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
    action: string,
    work: (
      tx: TxClient,
      line: Awaited<ReturnType<BookkeepingTransactionsService['line']>>,
    ) => Promise<Record<string, unknown>>,
  ): Promise<BookkeepingTransactionRow> {
    try {
      return await inFirm(this.database, businessId, async (tx) => {
        const line = await this.line(tx, businessId, actor, id, txnId);
        const meta = await work(tx, line);
        await this.audit.logIn(
          tx,
          `bookkeeping.transaction.${action}`,
          { type: 'bookkeeping_transaction', id: txnId },
          { clientId: id, ...meta },
        );
        const row = await tx.bookkeepingTransaction.findFirstOrThrow({
          where: { businessId, id: txnId },
          select,
        });
        return this.toRow(row);
      });
    } catch (error) {
      return mapBookkeepingDbError(error);
    }
  }

  /** One category for the whole line; any split or transfer it had goes. */
  categorize(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
    body: z.output<typeof CategorizeBookkeepingTransactionRequest>,
  ): Promise<BookkeepingTransactionRow> {
    return this.change(businessId, actor, id, txnId, 'categorized', async (tx, l) => {
      await this.activeCategory(tx, businessId, l.engagementId, body.categoryId);
      await tx.bookkeepingTransactionSplit.deleteMany({
        where: { businessId, transactionId: l.id },
      });
      await this.unpair(tx, businessId, l.transferPairId);
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: l.id } },
        data: {
          categoryId: body.categoryId,
          status: 'CATEGORIZED',
          transferPairId: null,
          excludedReason: null,
          ...(l.kind === 'TRANSFER' ? { kind: 'STANDARD' as const } : {}),
        },
      });
      return { categoryId: body.categoryId };
    });
  }

  /** Two to twenty parts that add up to the amount (409 SPLIT_TOTAL otherwise). */
  split(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
    body: z.output<typeof SplitBookkeepingTransactionRequest>,
  ): Promise<BookkeepingTransactionRow> {
    return this.change(businessId, actor, id, txnId, 'split', async (tx, l) => {
      if (body.parts.reduce((n, p) => n + p.amountCents, 0) !== l.amountCents) {
        throw errors.splitTotal();
      }
      for (const c of new Set(body.parts.map((p) => p.categoryId))) {
        await this.activeCategory(tx, businessId, l.engagementId, c);
      }
      await this.unpair(tx, businessId, l.transferPairId);
      await tx.bookkeepingTransactionSplit.deleteMany({
        where: { businessId, transactionId: l.id },
      });
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: l.id } },
        data: {
          categoryId: null,
          status: 'CATEGORIZED',
          transferPairId: null,
          excludedReason: null,
          ...(l.kind === 'TRANSFER' ? { kind: 'STANDARD' as const } : {}),
        },
      });
      await tx.bookkeepingTransactionSplit.createMany({
        data: body.parts.map((p) => ({
          businessId,
          engagementId: l.engagementId,
          transactionId: l.id,
          categoryId: p.categoryId,
          amountCents: p.amountCents,
          memo: p.memo ?? null,
        })),
      });
      return { parts: body.parts.length };
    });
  }

  /** Lines that can be this one's other side: same amount, the other way, another account. */
  async transferCandidates(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
  ): Promise<BookkeepingTransferCandidates> {
    const rows = await inFirm(this.database, businessId, async (tx) => {
      const l = await this.line(tx, businessId, actor, id, txnId);
      const from = new Date(l.transactionDate.getTime() - 10 * 86_400_000);
      const to = new Date(l.transactionDate.getTime() + 10 * 86_400_000);
      const found = await tx.bookkeepingTransaction.findMany({
        where: {
          businessId,
          engagementId: l.engagementId,
          id: { not: l.id },
          amountCents: l.amountCents,
          direction: l.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
          accountId: { not: l.accountId },
          transferPairId: null,
          status: { not: 'EXCLUDED' },
          transactionDate: { gte: from, lte: to },
        },
        select,
        take: 50,
      });
      const at = l.transactionDate.getTime();
      return found
        .sort(
          (a, b) =>
            Math.abs(a.transactionDate.getTime() - at) - Math.abs(b.transactionDate.getTime() - at),
        )
        .slice(0, 20);
    });
    return { items: rows.map((r) => this.toRow(r)) };
  }

  /** This line and its other side become one transfer (each names the other). */
  matchTransfer(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
    body: z.output<typeof MatchBookkeepingTransferRequest>,
  ): Promise<BookkeepingTransactionRow> {
    return this.change(businessId, actor, id, txnId, 'transfer_matched', async (tx, l) => {
      const other = await this.line(tx, businessId, actor, id, body.pairId);
      if (
        other.id === l.id ||
        other.amountCents !== l.amountCents ||
        other.direction === l.direction ||
        other.accountId === l.accountId ||
        other.transferPairId !== null
      ) {
        throw errors.notATransfer();
      }
      await this.unpair(tx, businessId, l.transferPairId);
      const plain = { categoryId: null, status: 'CATEGORIZED' as const, excludedReason: null };
      for (const t of [l.id, other.id]) {
        await tx.bookkeepingTransactionSplit.deleteMany({
          where: { businessId, transactionId: t },
        });
      }
      // The other side is a transfer first, so this side may name it (the ledger's rule).
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: other.id } },
        data: { kind: 'TRANSFER' },
      });
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: l.id } },
        data: { ...plain, kind: 'TRANSFER', transferPairId: other.id },
      });
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: other.id } },
        data: { ...plain, transferPairId: l.id },
      });
      return { pairId: other.id };
    });
  }

  /** Left out of the books, with the reason (a transfer it was in comes apart). */
  exclude(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
    body: z.output<typeof ExcludeBookkeepingTransactionRequest>,
  ): Promise<BookkeepingTransactionRow> {
    return this.change(businessId, actor, id, txnId, 'excluded', async (tx, l) => {
      await this.unpair(tx, businessId, l.transferPairId);
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: l.id } },
        data: {
          status: 'EXCLUDED',
          excludedReason: body.reason,
          transferPairId: null,
          ...(l.kind === 'TRANSFER' ? { kind: 'STANDARD' as const } : {}),
        },
      });
      return {};
    });
  }

  /** Back in the books: categorized again when it kept a category or parts, else waiting. */
  include(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
  ): Promise<BookkeepingTransactionRow> {
    return this.change(businessId, actor, id, txnId, 'included', async (tx, l) => {
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: l.id } },
        data: {
          status: l.categoryId || l._count.splits > 0 ? 'CATEGORIZED' : 'UNCATEGORIZED',
          excludedReason: null,
        },
      });
      return {};
    });
  }

  /** One of the client's own documents as the line's receipt, or none. */
  receipt(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    txnId: string,
    body: z.output<typeof AttachBookkeepingReceiptRequest>,
  ): Promise<BookkeepingTransactionRow> {
    return this.change(businessId, actor, id, txnId, 'receipt_changed', async (tx, l) => {
      if (body.documentId) {
        const doc = await tx.document.findFirst({
          where: {
            businessId,
            engagementId: l.engagementId,
            id: body.documentId,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!doc) throw errors.notFound();
      }
      await tx.bookkeepingTransaction.update({
        where: { businessId_id: { businessId, id: l.id } },
        data: { receiptDocumentId: body.documentId },
      });
      return { documentId: body.documentId };
    });
  }

  /**
   * One action on up to 100 lines, each in its own transaction. Every line (and the category) must
   * be the client's, else 404 and nothing changes; a line the ledger refuses (a closed period) is
   * named with its code while the others change.
   */
  async bulk(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof BulkBookkeepingTransactionsRequest>,
  ): Promise<BulkBookkeepingTransactionsResult> {
    const unique = [...new Set(body.ids)];
    await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const found = await tx.bookkeepingTransaction.count({
        where: { businessId, engagementId: p.engagementId, id: { in: unique } },
      });
      if (found !== unique.length) throw errors.notFound();
      if (body.action === 'CATEGORIZE') {
        await this.activeCategory(tx, businessId, p.engagementId, body.categoryId!);
      }
    });
    const refused: { id: string; code: string }[] = [];
    let done = 0;
    for (const txnId of unique) {
      try {
        if (body.action === 'CATEGORIZE') {
          await this.categorize(businessId, actor, id, txnId, { categoryId: body.categoryId! });
        } else if (body.action === 'EXCLUDE') {
          await this.exclude(businessId, actor, id, txnId, { reason: body.reason! });
        } else {
          await this.include(businessId, actor, id, txnId);
        }
        done += 1;
      } catch (error) {
        const code =
          (error as { getResponse?: () => { code?: string } }).getResponse?.()?.code ?? 'FAILED';
        refused.push({ id: txnId, code });
      }
    }
    return { done, refused };
  }
}
