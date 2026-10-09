import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { Invoice, InvoiceList, ListInvoicesQuery } from '@firmivra/types';
import type { z } from 'zod';
import {
  type ClientsActor,
  decodeCursor,
  encodeCursor,
  likeEscape,
} from '../../clients/clients.service.js';
import { DATABASE } from '../../database/database.module.js';
import {
  firmToday,
  type InvoiceRow,
  invoiceSelect,
  notFound,
  paymentsEnabled,
  toInvoice,
  toListItem,
} from './invoice-view.js';

type ListQuery = z.output<typeof ListInvoicesQuery>;

/**
 * The firm's invoices (R7 step 7; contract in packages/types/src/payments). Owner and Admin reach
 * every invoice; Staff only read those of clients assigned to them (others 404) and the routes
 * refuse them every change. The database computes line amounts, subtotal and total and keeps the
 * lifecycle; every change runs in one transaction with its audit row. Reads are not audited.
 */
@Injectable()
export class InvoicesService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private reach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  /** The invoice, if its client is in reach; `lock` takes its row (FOR UPDATE) first. */
  async load(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    lock = false,
  ): Promise<InvoiceRow> {
    if (lock) {
      await tx.$queryRaw`
        SELECT 1 FROM invoices WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    const row = await tx.invoice.findFirst({
      where: { businessId, id, client: this.reach(actor) },
      select: invoiceSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  async list(businessId: string, actor: ClientsActor, q: ListQuery): Promise<InvoiceList> {
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const term = q.search ? likeEscape(q.search) : undefined;
    return this.inFirm(businessId, async (tx) => {
      if (q.clientId) {
        const client = await tx.client.findFirst({
          where: { AND: [{ businessId, id: q.clientId }, this.reach(actor)] },
          select: { id: true },
        });
        if (!client) throw notFound();
      }
      const where: Prisma.InvoiceWhereInput = {
        AND: [
          { businessId, client: this.reach(actor) },
          q.clientId ? { clientId: q.clientId } : {},
          q.status ? { status: q.status } : {},
          term
            ? {
                OR: [
                  { number: { contains: term, mode: 'insensitive' } },
                  { client: { displayName: { contains: term, mode: 'insensitive' } } },
                ],
              }
            : {},
          after
            ? {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {},
        ],
      };
      const rows = await tx.invoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: invoiceSelect,
      });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      const { today } = await firmToday(tx, businessId);
      return {
        items: page.map((row) => toListItem(row, today)),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
        paymentsEnabled: await paymentsEnabled(tx, businessId),
      };
    });
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<Invoice> {
    return this.inFirm(businessId, async (tx) => {
      const row = await this.load(tx, businessId, actor, id);
      return toInvoice(row, (await firmToday(tx, businessId)).today);
    });
  }
}
