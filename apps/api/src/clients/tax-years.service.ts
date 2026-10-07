import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { databaseErrorCode, type Database, type TxClient } from '@firmivra/db';
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
const archivedStatus = () =>
  new ConflictException({ code: 'TAX_STATUS_ARCHIVED', message: 'This tax status is archived' });

/** The advisory lock that lets one change at a time through to a client's year (tests use it). */
export const taxYearLockKey = (businessId: string, clientId: string, taxYear: number) =>
  `client-tax-year:${businessId}:${clientId}:${taxYear}`;

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
      // One change of this year at a time (the first insert too), so `current` is what it replaces.
      const key = taxYearLockKey(businessId, clientId, taxYear);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      await this.client(tx, businessId, actor, clientId);
      // FOR SHARE: archiving the client or the status at the same time waits for this change,
      // or has already committed and is seen here.
      const [client] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM clients
        WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
        FOR SHARE`;
      if (!client) throw notFound();
      if (client.archived_at) {
        throw new ConflictException({
          code: 'CLIENT_ARCHIVED',
          message: 'Restore the client first',
        });
      }
      const [status] = await tx.$queryRaw<{ id: string; name: string; archived_at: Date | null }[]>`
        SELECT id, name, archived_at FROM tax_statuses
        WHERE business_id = ${businessId}::uuid AND id = ${body.taxStatusId}::uuid
        FOR SHARE`;
      if (!status) throw notFound();
      const fields = {
        taxStatusId: true,
        clientNote: true,
        updatedByUserId: true,
        updatedAt: true,
      };
      const where = { businessId_clientId_taxYear: { businessId, clientId, taxYear } };
      const current = await tx.clientTaxStatus.findUnique({ where, select: fields });
      // An archived status can stay where it is, never be newly assigned (the database agrees).
      if (status.archived_at && current?.taxStatusId !== status.id) throw archivedStatus();
      const note = body.clientNote === undefined ? {} : { clientNote: body.clientNote };
      const clientNote =
        note.clientNote === undefined ? (current?.clientNote ?? null) : note.clientNote;
      const changed = {
        status: current?.taxStatusId !== status.id,
        note: (current?.clientNote ?? null) !== clientNote,
      };
      // Nothing changed: no write, so who last changed the year, and when, stay as they are.
      const row =
        current && !changed.status && !changed.note
          ? current
          : await tx.clientTaxStatus.upsert({
              where,
              create: {
                businessId,
                clientId,
                taxYear,
                taxStatusId: status.id,
                clientNote,
                updatedByUserId: actor.userId,
              },
              update: { taxStatusId: status.id, ...note, updatedByUserId: actor.userId },
              select: fields,
            });
      const names = await memberNames(tx, businessId, [row.updatedByUserId]);
      return {
        year: {
          taxYear,
          status: { id: status.id, name: status.name },
          clientNote: row.clientNote,
          updatedBy: memberRef(names, row.updatedByUserId),
          updatedAt: row.updatedAt.toISOString(),
        },
        changed,
      };
    }).catch((error: unknown) => {
      // Backstop: the database refuses a newly assigned archived status (check_violation).
      if (databaseErrorCode(error) === '23514') throw archivedStatus();
      throw error;
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
        // `seq` is the order the database wrote them in: the first is the year's current state.
        orderBy: { seq: 'desc' },
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
