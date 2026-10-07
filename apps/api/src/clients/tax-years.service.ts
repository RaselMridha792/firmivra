import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  ClientTaxYear,
  ClientTaxYearHistory,
  MyTaxYearList,
  SetClientTaxYearRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { ClientsActor } from './clients.service.js';

type SetBody = z.output<typeof SetClientTaxYearRequest>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

/** Names of the firm members behind `userIds` (a former member keeps their name). */
async function memberNames(
  tx: TxClient,
  businessId: string,
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const members = await tx.membership.findMany({
    where: { businessId, userId: { in: ids } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(members.map((m) => [m.userId, m.user.name]));
}

const memberRef = (names: Map<string, string>, userId: string | null) => {
  const name = userId ? names.get(userId) : undefined;
  return userId && name ? { userId, name } : null;
};

/**
 * A client's tax status per year (R10 step 5; contract in packages/types/src/clients), with the
 * firm's own statuses (T04). The firm sets a year's status and the note the client sees; the
 * database writes the history and refuses an archived status for a new assignment. Staff reach
 * only clients assigned to them. Every read and change is audited, never the note's text.
 */
@Injectable()
export class TaxYearsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The client, if this actor may reach it (Staff: assigned to them); else 404. */
  private async client(tx: TxClient, businessId: string, actor: ClientsActor, clientId: string) {
    const row = await tx.client.findFirst({
      where: {
        businessId,
        id: clientId,
        ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
      },
      select: { id: true, archivedAt: true },
    });
    if (!row) throw notFound();
    return row;
  }

  async list(businessId: string, actor: ClientsActor, clientId: string): Promise<ClientTaxYear[]> {
    const years = await this.inFirm(businessId, async (tx) => {
      await this.client(tx, businessId, actor, clientId);
      const rows = await tx.clientTaxStatus.findMany({
        where: { businessId, clientId },
        orderBy: { taxYear: 'desc' },
        select: {
          taxYear: true,
          clientNote: true,
          updatedByUserId: true,
          updatedAt: true,
          taxStatus: { select: { id: true, name: true } },
        },
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.updatedByUserId),
      );
      return rows.map((r) => ({
        taxYear: r.taxYear,
        status: r.taxStatus,
        clientNote: r.clientNote,
        updatedBy: memberRef(names, r.updatedByUserId),
        updatedAt: r.updatedAt.toISOString(),
      }));
    });
    await this.audit.log(
      'client.tax_years_viewed',
      { type: 'client', id: clientId },
      {
        count: years.length,
      },
    );
    return years;
  }

  /** Sets (or first adds) a year's status and the client's note; `clientNote` left out keeps it. */
  async set(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    taxYear: number,
    body: SetBody,
  ): Promise<ClientTaxYear> {
    const { year, changed } = await this.inFirm(businessId, async (tx) => {
      const client = await this.client(tx, businessId, actor, clientId);
      if (client.archivedAt) {
        throw new ConflictException({
          code: 'CLIENT_ARCHIVED',
          message: 'Restore the client first',
        });
      }
      const status = await tx.taxStatus.findFirst({
        where: { businessId, id: body.taxStatusId },
        select: { id: true, name: true, archivedAt: true },
      });
      if (!status) throw notFound();
      const current = await tx.clientTaxStatus.findUnique({
        where: { businessId_clientId_taxYear: { businessId, clientId, taxYear } },
        select: { taxStatusId: true, clientNote: true },
      });
      // An archived status can stay where it is, never be newly assigned (the database agrees).
      if (status.archivedAt && current?.taxStatusId !== status.id) {
        throw new ConflictException({
          code: 'TAX_STATUS_ARCHIVED',
          message: 'This tax status is archived',
        });
      }
      const clientNote =
        body.clientNote === undefined ? (current?.clientNote ?? null) : body.clientNote;
      const row = await tx.clientTaxStatus.upsert({
        where: { businessId_clientId_taxYear: { businessId, clientId, taxYear } },
        create: {
          businessId,
          clientId,
          taxYear,
          taxStatusId: status.id,
          clientNote,
          updatedByUserId: actor.userId,
        },
        update: { taxStatusId: status.id, clientNote, updatedByUserId: actor.userId },
        select: { taxYear: true, clientNote: true, updatedByUserId: true, updatedAt: true },
      });
      const names = await memberNames(tx, businessId, [row.updatedByUserId]);
      return {
        year: {
          taxYear: row.taxYear,
          status: { id: status.id, name: status.name },
          clientNote: row.clientNote,
          updatedBy: memberRef(names, row.updatedByUserId),
          updatedAt: row.updatedAt.toISOString(),
        },
        changed: {
          status: current?.taxStatusId !== status.id,
          note: (current?.clientNote ?? null) !== clientNote,
        },
      };
    });
    await this.audit.log(
      'client.tax_year_set',
      { type: 'client', id: clientId },
      {
        taxYear,
        statusChanged: changed.status,
        noteChanged: changed.note,
      },
    );
    return year;
  }

  /** Every change of the year's status or note, newest first (written by the database). */
  async history(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    taxYear: number,
  ): Promise<ClientTaxYearHistory['items']> {
    const items = await this.inFirm(businessId, async (tx) => {
      await this.client(tx, businessId, actor, clientId);
      const rows = await tx.clientTaxStatusHistory.findMany({
        where: { businessId, clientId, taxYear },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        select: {
          clientNote: true,
          changedByUserId: true,
          changedAt: true,
          taxStatus: { select: { id: true, name: true } },
        },
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.changedByUserId),
      );
      return rows.map((r) => ({
        status: r.taxStatus,
        clientNote: r.clientNote,
        changedBy: memberRef(names, r.changedByUserId),
        changedAt: r.changedAt.toISOString(),
      }));
    });
    await this.audit.log(
      'client.tax_year_history_viewed',
      { type: 'client', id: clientId },
      {
        taxYear,
      },
    );
    return items;
  }

  /** The signed-in client's own years at this firm: status name and the firm's note. */
  async mine(businessId: string, clientAccountId: string): Promise<MyTaxYearList['items']> {
    const { clientId, items } = await this.inFirm(businessId, async (tx) => {
      const account = await tx.clientAccount.findFirst({
        where: { businessId, id: clientAccountId },
        select: { clientId: true },
      });
      if (!account?.clientId) return { clientId: null, items: [] };
      const rows = await tx.clientTaxStatus.findMany({
        where: { businessId, clientId: account.clientId },
        orderBy: { taxYear: 'desc' },
        select: {
          taxYear: true,
          clientNote: true,
          updatedAt: true,
          taxStatus: { select: { name: true } },
        },
      });
      return {
        clientId: account.clientId,
        items: rows.map((r) => ({
          taxYear: r.taxYear,
          status: r.taxStatus.name,
          clientNote: r.clientNote,
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    });
    if (clientId) {
      await this.audit.log(
        'portal.tax_years_viewed',
        { type: 'client', id: clientId },
        {
          count: items.length,
        },
      );
    }
    return items;
  }
}
