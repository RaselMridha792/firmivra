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
import { AuditService } from '../../audit/audit.service.js';
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
/** Where an item sits in the portal's order (`order` below): section rank, date, number, id. */
type SortKey = [rank: 0 | 1, date: string, number: string, id: string];
const keyOf = (i: MyInvoice): SortKey =>
  MY_INVOICE_SECTIONS.CURRENT.includes(i.status)
    ? [0, i.dueOn ?? '9999-12-31', i.number, i.id]
    : [1, i.paidAt ?? i.canceledAt ?? '', i.number, i.id];
/** CURRENT first, soonest due date first (none last); then PAST, newest first; then number, id. */
function compareKeys(a: SortKey, b: SortKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return (a[1] < b[1] ? -1 : 1) * (a[0] === 0 ? 1 : -1);
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return a[3] === b[3] ? 0 : a[3] < b[3] ? -1 : 1;
}
const order = (a: MyInvoice, b: MyInvoice) => compareKeys(keyOf(a), keyOf(b));
/**
 * Opaque: the last item's sort keys, so the next page resumes after them even when that invoice
 * has left the view since (paid, canceled). Only a cursor that does not decode is 400.
 */
const encode = (i: MyInvoice) =>
  Buffer.from(JSON.stringify(['my', ...keyOf(i)])).toString('base64url');
const decode = (cursor: string): SortKey | null => {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (!Array.isArray(v) || v.length !== 5 || v[0] !== 'my') return null;
    const [, rank, date, number, id] = v as unknown[];
    if (rank !== 0 && rank !== 1) return null;
    if (![date, number, id].every((x) => typeof x === 'string')) return null;
    return [rank, date as string, number as string, id as string];
  } catch {
    return null;
  }
};

/**
 * The signed-in client's invoices at one firm (portal Receipts & Invoices). The client comes from
 * the session's ClientAccount, never from the URL; every query is filtered by it, so another
 * client's invoice, or one at another firm, is 404. Drafts never show (`myInvoiceStatus()`).
 */
@Injectable()
export class MyInvoicesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

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
    const list = await this.inFirm(businessId, async (tx) => {
      const clientId = await this.clientOf(tx, businessId, clientAccountId);
      const rows = await tx.invoice.findMany({
        where: { businessId, clientId, status: { not: 'DRAFT' } },
        select: invoiceSelect,
        // The newest if a client ever has more; the rest is sorted after reading.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        if (!after) throw badCursor();
        start = shown.findIndex((i) => compareKeys(keyOf(i), after) > 0);
        if (start < 0) start = shown.length;
      }
      const page = shown.slice(start, start + q.limit);
      const more = start + q.limit < shown.length;
      return {
        items: page,
        nextCursor: more && page.length > 0 ? encode(page.at(-1)!) : null,
        paymentsEnabled: on,
      };
    });
    await this.audit.log('my_invoices.listed', { type: 'invoice' }, { count: list.items.length });
    return list;
  }

  async get(businessId: string, clientAccountId: string, id: string): Promise<MyInvoiceDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      const { row, mine } = await this.mine(tx, businessId, clientAccountId, id);
      return toMyInvoiceDetail(row, mine);
    });
    await this.audit.log('my_invoice.viewed', { type: 'invoice', id });
    return detail;
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
