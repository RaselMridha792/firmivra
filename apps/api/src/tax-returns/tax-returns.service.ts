import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CreateTaxReturnRequest,
  MyTaxReturn,
  MyTaxReturnsQuery,
  OkResponse,
  TaxReturn,
  UpdateTaxReturnRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  canDelete,
  canMoveTo,
  changesOf,
  clientArchived,
  dateColumn,
  fieldsOf,
  filedOnMissing,
  invalidDocument,
  invalidStatus,
  needsFiledOn,
  notFound,
  refusalOf,
  returnLocked,
  toMyTaxReturn,
  toTaxReturn,
} from './tax-return-rules.js';

type CreateBody = z.output<typeof CreateTaxReturnRequest>;
type UpdateBody = z.output<typeof UpdateTaxReturnRequest>;
type MyQuery = z.output<typeof MyTaxReturnsQuery>;

const returnSelect = {
  id: true,
  clientId: true,
  engagementId: true,
  taxYear: true,
  filingType: true,
  quarter: true,
  formType: true,
  status: true,
  filedOn: true,
  documentId: true,
  firstFiledAt: true,
  createdAt: true,
  updatedAt: true,
  document: { select: { id: true, fileName: true } },
} satisfies Prisma.TaxReturnSelect;

type ReturnRow = Prisma.TaxReturnGetPayload<{ select: typeof returnSelect }>;

/** What the portal reads: the PDF with what decides whether the client may see it. */
const myReturnSelect = {
  id: true,
  taxYear: true,
  filingType: true,
  quarter: true,
  formType: true,
  status: true,
  filedOn: true,
  document: {
    select: { id: true, fileName: true, clientId: true, direction: true, scanStatus: true },
  },
} satisfies Prisma.TaxReturnSelect;

/** Newest year first; within a year the annual return, then the quarters; then oldest first. */
const ORDER = [
  { taxYear: 'desc' },
  { quarter: { sort: 'asc', nulls: 'first' } },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.TaxReturnOrderByWithRelationInput[];

/**
 * A client's tax returns (R10 step 7; contract in packages/types/src/tax-returns), one row per
 * annual return or quarterly estimate, with the status the client sees and the return PDF. Every
 * query runs in the firm's business scope with `businessId` from TenantGuard. Owner and Admin
 * reach every client's returns; Staff only those of clients assigned to them (others are 404).
 * The database keeps the rules too; the API checks them first and answers with the contract's
 * codes. Every read and change is audited with ids, counts and field names, never a value.
 */
@Injectable()
export class TaxReturnsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** A change in the firm's scope; a database refusal answers like the API's own check. */
  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (error) {
      throw refusalOf(error) ?? error;
    }
  }

  /** The firm's returns for one client, newest year first. */
  async listForClient(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
  ): Promise<TaxReturn[]> {
    const items = await this.inFirm(businessId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { businessId, id: clientId, ...reach(actor) },
        select: { id: true },
      });
      if (!client) throw notFound();
      const rows = await tx.taxReturn.findMany({
        where: { businessId, clientId },
        orderBy: ORDER,
        select: returnSelect,
      });
      return rows.map(toTaxReturn);
    });
    await this.audit.log(
      'client.tax_returns_viewed',
      { type: 'client', id: clientId },
      { count: items.length },
    );
    return items;
  }

  /** A new return for the client. FILED and ACCEPTED need a filed date (the request checks it). */
  async create(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    body: CreateBody,
  ): Promise<TaxReturn> {
    const row = await this.write(businessId, async (tx) => {
      await this.lockClient(tx, businessId, actor, clientId);
      if (body.engagementId) {
        await this.checkEngagement(tx, businessId, clientId, body.engagementId);
      }
      if (body.documentId) await this.checkDocument(tx, businessId, clientId, body.documentId);
      return tx.taxReturn.create({
        data: {
          businessId,
          clientId,
          engagementId: body.engagementId ?? null,
          taxYear: body.taxYear,
          filingType: body.filingType,
          quarter: body.quarter ?? null,
          formType: body.formType ?? null,
          status: body.status,
          filedOn: body.filedOn ? dateColumn(body.filedOn) : null,
          documentId: body.documentId ?? null,
        },
        select: returnSelect,
      });
    });
    const fields = Object.entries(body)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k)
      .sort();
    await this.audit.log(
      'tax_return.created',
      { type: 'tax_return', id: row.id },
      { clientId, fields },
    );
    return toTaxReturn(row);
  }

  /**
   * Changes a return; the client never changes. A FILED, ACCEPTED or COMPLETED return can't go
   * back to IN_PROGRESS (409 INVALID_STATUS). A change that changes nothing writes nothing.
   */
  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<TaxReturn> {
    const { row, fields } = await this.write(businessId, async (tx) => {
      const current = await this.lockReturn(tx, businessId, actor, id);
      const was = fieldsOf(current);
      if (body.status !== undefined && !canMoveTo(was.status, body.status)) throw invalidStatus();
      const changes = changesOf(was, body);
      const next = { ...was, ...changes };
      if (needsFiledOn(next.status) && !next.filedOn) throw filedOnMissing();
      if (changes.engagementId) {
        await this.checkEngagement(tx, businessId, current.clientId, changes.engagementId);
      }
      if (changes.documentId) {
        await this.checkDocument(tx, businessId, current.clientId, changes.documentId);
      }
      const fields = Object.keys(changes).sort();
      if (fields.length === 0) return { row: current, fields };
      const { filedOn, ...rest } = changes;
      const updated = await tx.taxReturn.update({
        where: { id, businessId },
        data: {
          ...rest,
          ...(filedOn === undefined ? {} : { filedOn: filedOn ? dateColumn(filedOn) : null }),
        },
        select: returnSelect,
      });
      return { row: updated, fields };
    });
    await this.audit.log(
      'tax_return.updated',
      { type: 'tax_return', id },
      { clientId: row.clientId, fields },
    );
    return toTaxReturn(row);
  }

  /** Only a return that was never filed: 409 RETURN_LOCKED otherwise. */
  async remove(businessId: string, actor: ClientsActor, id: string): Promise<OkResponse> {
    const clientId = await this.write(businessId, async (tx) => {
      const current = await this.lockReturn(tx, businessId, actor, id);
      if (!canDelete(current)) throw returnLocked();
      // The database's delete rule (never filed) is the last line: it removes nothing then.
      const { count } = await tx.taxReturn.deleteMany({ where: { businessId, id } });
      if (count !== 1) throw returnLocked();
      return current.clientId;
    });
    await this.audit.log('tax_return.deleted', { type: 'tax_return', id }, { clientId });
    return { ok: true };
  }

  /**
   * The signed-in client's own returns at this firm (portal Taxes tab), with the tab's filters.
   * The PDF only once its scan is CLEAN, and never an internal or another client's document.
   */
  async mine(businessId: string, clientAccountId: string, q: MyQuery): Promise<MyTaxReturn[]> {
    const { clientId, items } = await this.inFirm(businessId, async (tx) => {
      const account = await tx.clientAccount.findFirst({
        where: { businessId, id: clientAccountId },
        select: { clientId: true },
      });
      const own = account?.clientId;
      if (!own) return { clientId: null, items: [] };
      const rows = await tx.taxReturn.findMany({
        where: {
          businessId,
          clientId: own,
          ...(q.taxYear === undefined ? {} : { taxYear: q.taxYear }),
          ...(q.kind === 'annual' ? { quarter: null } : {}),
          ...(q.kind === 'quarterly' ? { quarter: { not: null } } : {}),
          ...(q.filingType ? { filingType: q.filingType } : {}),
        },
        orderBy: ORDER,
        select: myReturnSelect,
      });
      return { clientId: own, items: rows.map((r) => toMyTaxReturn(r, own)) };
    });
    if (clientId) {
      await this.audit.log(
        'portal.tax_returns_viewed',
        { type: 'client', id: clientId },
        { count: items.length },
      );
    }
    return items;
  }

  /**
   * The client for a change, its row locked FOR SHARE: an archive or a reassignment at the same
   * time waits for this change, or has committed and is seen here. 404 when the actor can't
   * reach it (Staff: not assigned to them), 409 CLIENT_ARCHIVED when archived.
   */
  private async lockClient(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    clientId: string,
  ): Promise<void> {
    const [client] = await tx.$queryRaw<
      { archived_at: Date | null; assigned_user_id: string | null }[]
    >`
      SELECT archived_at, assigned_user_id FROM clients
      WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
      FOR SHARE`;
    if (!client || (actor.role === 'STAFF' && client.assigned_user_id !== actor.userId)) {
      throw notFound();
    }
    if (client.archived_at) throw clientArchived();
  }

  /**
   * The return for a change, its row locked FOR UPDATE (a change or delete at the same time
   * waits, then sees this one), then its client as `lockClient`. 404 when out of reach.
   */
  private async lockReturn(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<ReturnRow> {
    const [locked] = await tx.$queryRaw<{ client_id: string }[]>`
      SELECT client_id FROM tax_returns
      WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    if (!locked) throw notFound();
    await this.lockClient(tx, businessId, actor, locked.client_id);
    const row = await tx.taxReturn.findFirst({ where: { businessId, id }, select: returnSelect });
    if (!row) throw notFound();
    return row;
  }

  /** One of this client's engagements (another client's or firm's is 404). Never deleted. */
  private async checkEngagement(
    tx: TxClient,
    businessId: string,
    clientId: string,
    engagementId: string,
  ): Promise<void> {
    const engagement = await tx.engagement.findFirst({
      where: { businessId, clientId, id: engagementId },
      select: { id: true },
    });
    if (!engagement) throw notFound();
  }

  /**
   * The PDF: 404 when the firm has no such document (another firm's included), 409
   * INVALID_DOCUMENT when it is another client's or an internal one. FOR KEY SHARE keeps it
   * from being deleted before this change commits; after that, the link keeps it.
   */
  private async checkDocument(
    tx: TxClient,
    businessId: string,
    clientId: string,
    documentId: string,
  ): Promise<void> {
    const [document] = await tx.$queryRaw<{ client_id: string; direction: string }[]>`
      SELECT client_id, direction FROM documents
      WHERE business_id = ${businessId}::uuid AND id = ${documentId}::uuid
      FOR KEY SHARE`;
    if (!document) throw notFound();
    if (document.client_id !== clientId || document.direction === 'INTERNAL') {
      throw invalidDocument();
    }
  }
}

/** Which clients the actor may reach: Staff only their assigned clients. */
function reach(actor: ClientsActor): Prisma.ClientWhereInput {
  return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
}
