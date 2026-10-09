import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type ListMyInvoicesQuery,
  MY_INVOICE_SECTIONS,
  MY_INVOICE_VIEWS,
  type MyInvoice,
  type MyInvoiceDetail,
  type MyInvoiceList,
} from '@firmivra/types';
import type { z } from 'zod';
import { DATABASE } from '../../database/database.module.js';
import {
  firmToday,
  type InvoiceRow,
  invoiceSelect,
  notFound,
  paymentsEnabled,
  toMyInvoice,
  toMyInvoiceDetail,
} from './invoice-view.js';

type ListQuery = z.output<typeof ListMyInvoicesQuery>;
/** A client has few invoices; the list is filtered and sorted after reading them all. */
const MAX_INVOICES = 2_000;
const badCursor = () =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The cursor is not valid' });
/** Opaque: the last item's id. */
const encode = (id: string) => Buffer.from(`my:${id}`).toString('base64url');
const decode = (cursor: string) => {
  const text = Buffer.from(cursor, 'base64url').toString();
  return text.startsWith('my:') ? text.slice(3) : '';
};

/**
 * The signed-in client's invoices at one firm (portal Receipts & Invoices). The client comes from
 * the session's ClientAccount, never from the URL; every query is filtered by it, so another
 * client's invoice, or one at another firm, is 404. Drafts never show (`myInvoiceStatus()`).
 */
@Injectable()
export class MyInvoicesService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The client of this login (404 when the login no longer reaches one). */
  async clientOf(tx: TxClient, businessId: string, clientAccountId: string): Promise<string> {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true },
    });
    if (!account?.clientId) throw notFound();
    return account.clientId;
  }

  async list(businessId: string, clientAccountId: string, q: ListQuery): Promise<MyInvoiceList> {
    return this.inFirm(businessId, async (tx) => {
      const clientId = await this.clientOf(tx, businessId, clientAccountId);
      const rows = await tx.invoice.findMany({
        where: { businessId, clientId, status: { not: 'DRAFT' } },
        select: invoiceSelect,
        take: MAX_INVOICES,
      });
      const { today, timeZone } = await firmToday(tx, businessId);
      const on = await paymentsEnabled(tx, businessId);
      const term = q.search?.toLowerCase();
      const wanted = new Set(MY_INVOICE_VIEWS[q.view]);
      const shown = rows
        .map((row) => toMyInvoice(row, today, timeZone, on))
        .filter((i): i is MyInvoice => i !== null)
        .filter(
          (i) =>
            wanted.has(i.status) &&
            (!q.status || i.status === q.status) &&
            (!q.section || i.section === q.section) &&
            (!term ||
              i.number.toLowerCase().includes(term) ||
              i.title.toLowerCase().includes(term)),
        )
        .sort(order);
      let start = 0;
      if (q.cursor) {
        const after = decode(q.cursor);
        const at = after ? shown.findIndex((i) => i.id === after) : -1;
        if (at < 0) throw badCursor();
        start = at + 1;
      }
      const page = shown.slice(start, start + q.limit);
      const more = start + q.limit < shown.length;
      return {
        items: page,
        nextCursor: more && page.length > 0 ? encode(page.at(-1)!.id) : null,
        paymentsEnabled: on,
      };
    });
  }

  async get(businessId: string, clientAccountId: string, id: string): Promise<MyInvoiceDetail> {
    return this.inFirm(businessId, async (tx) => {
      const { row, mine } = await this.mine(tx, businessId, clientAccountId, id);
      return toMyInvoiceDetail(row, mine);
    });
  }

  /** One of the client's own shown invoices (404 otherwise), as the client sees it. */
  async mine(tx: TxClient, businessId: string, clientAccountId: string, id: string) {
    const clientId = await this.clientOf(tx, businessId, clientAccountId);
    const row: InvoiceRow | null = await tx.invoice.findFirst({
      where: { businessId, clientId, id },
      select: invoiceSelect,
    });
    if (!row) throw notFound();
    const { today, timeZone } = await firmToday(tx, businessId);
    const mine = toMyInvoice(row, today, timeZone, await paymentsEnabled(tx, businessId));
    if (!mine) throw notFound();
    return { row, mine };
  }
}

/** CURRENT first, soonest due date first (none last); then PAST, newest first; then by id. */
function order(a: MyInvoice, b: MyInvoice): number {
  const rank = (i: MyInvoice) => (MY_INVOICE_SECTIONS.CURRENT.includes(i.status) ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 0) {
    const da = a.dueOn ?? '9999-12-31';
    const db = b.dueOn ?? '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
  } else {
    const ta = a.paidAt ?? a.canceledAt ?? '';
    const tb = b.paidAt ?? b.canceledAt ?? '';
    if (ta !== tb) return ta > tb ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}
