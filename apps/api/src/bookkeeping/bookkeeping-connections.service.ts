import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AddBookkeepingAccountRequest,
  BookkeepingAccount,
  BookkeepingAccountList,
  BookkeepingConnection,
  BookkeepingConnectionList,
  BookkeepingListQuery,
  BookkeepingSyncRunList,
  ConnectBookkeepingRequest,
  UpdateBookkeepingAccountRequest,
  UpdateBookkeepingConnectionRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames } from '../workspaces/common.js';
import {
  addActivity,
  type BookkeepingActor,
  findProfile,
  lockProfile,
  lockProfileOf,
  memberRefOf,
  reachEngagement,
  skipTake,
  toAccount,
  toConnection,
} from './bookkeeping.mappers.js';
import { errors, inFirm, mapBookkeepingDbError, providerLabel } from './bookkeeping.shared.js';
import { BookkeepingStatusService, readSettings } from './bookkeeping-status.service.js';

/**
 * A client's accounting connections, their sync history and the bank and credit card accounts.
 * A connection maps a provider's company to the client; the provider's own authorization and
 * its tokens live in the secret store and never pass through here. A disconnected connection
 * keeps its row and history, and connecting the same company again reuses it.
 */
@Injectable()
export class BookkeepingConnectionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly status: BookkeepingStatusService,
  ) {}

  /** The connection a request names, when the caller reaches its client; 404 otherwise. */
  private async findConnection(
    tx: Prisma.TransactionClient,
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ) {
    const row = await tx.bookkeepingConnection.findFirst({
      where: { businessId, id, engagement: reachEngagement(actor) },
    });
    if (!row) throw errors.notFound();
    return row;
  }

  async list(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingConnectionList> {
    const now = new Date();
    const { rows, settings } = await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const settings = await readSettings(tx, businessId);
      const rows = await tx.bookkeepingConnection.findMany({
        where: { businessId, engagementId: p.engagementId },
        orderBy: [{ connectedAt: 'desc' }, { id: 'asc' }],
      });
      return { rows, settings };
    });
    await this.audit.log(
      'bookkeeping.connections.listed',
      { type: 'bookkeeping_client', id },
      { count: rows.length },
    );
    return { items: rows.map((c) => toConnection(c, settings.staleSyncHours, now)) };
  }

  async connect(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof ConnectBookkeepingRequest>,
  ): Promise<BookkeepingConnection> {
    const now = new Date();
    return inFirm(this.database, businessId, async (tx) => {
      const p = await lockProfile(tx, businessId, actor, id);
      const settings = await readSettings(tx, businessId);
      const sameCompany = await tx.bookkeepingConnection.findFirst({
        where: {
          businessId,
          provider: body.provider,
          providerCompanyId: body.providerCompany,
          status: { not: 'DISCONNECTED' },
        },
        select: { engagementId: true },
      });
      if (sameCompany) {
        throw sameCompany.engagementId === p.engagementId
          ? errors.connectionExists()
          : errors.companyConnected();
      }
      const sameProvider = await tx.bookkeepingConnection.findFirst({
        where: {
          businessId,
          engagementId: p.engagementId,
          provider: body.provider,
          status: { not: 'DISCONNECTED' },
        },
        select: { id: true },
      });
      if (sameProvider) throw errors.connectionExists();
      const earlier = await tx.bookkeepingConnection.findFirst({
        where: {
          businessId,
          engagementId: p.engagementId,
          provider: body.provider,
          providerCompanyId: body.providerCompany,
          status: 'DISCONNECTED',
        },
        select: { id: true },
      });
      let connection;
      try {
        connection = earlier
          ? await tx.bookkeepingConnection.update({
              where: { businessId_id: { businessId, id: earlier.id } },
              data: {
                status: 'CONNECTED',
                disconnectedAt: null,
                lastErrorCode: null,
                companyName: body.companyName ?? undefined,
                connectedByUserId: actor.userId,
                connectedAt: now,
              },
            })
          : await tx.bookkeepingConnection.create({
              data: {
                businessId,
                engagementId: p.engagementId,
                provider: body.provider,
                providerCompanyId: body.providerCompany,
                companyName: body.companyName ?? null,
                connectedByUserId: actor.userId,
                connectedAt: now,
              },
            });
      } catch (e) {
        if (isUniqueViolation(e)) throw errors.connectionExists();
        return mapBookkeepingDbError(e);
      }
      // The first sync is the integration worker's: this records that it is wanted.
      await tx.bookkeepingSyncRun.create({
        data: {
          businessId,
          connectionId: connection.id,
          trigger: 'INITIAL',
          requestedByUserId: actor.userId,
          startedAt: now,
        },
      });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'SYNC',
        `Connected ${providerLabel(body.provider)}`,
        {
          provider: body.provider,
        },
      );
      await this.status.refresh(tx, businessId, p.engagementId, actor.userId, settings);
      await this.audit.logIn(
        tx,
        'bookkeeping.connection.connected',
        { type: 'bookkeeping_connection', id: connection.id },
        { clientId: p.engagement.clientId, provider: body.provider },
      );
      return toConnection(connection, settings.staleSyncHours, now);
    });
  }

  async updateConnection(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof UpdateBookkeepingConnectionRequest>,
  ): Promise<BookkeepingConnection> {
    const now = new Date();
    return inFirm(this.database, businessId, async (tx) => {
      const found = await this.findConnection(tx, businessId, actor, id);
      const p = await lockProfileOf(tx, businessId, actor, found.engagementId);
      const settings = await readSettings(tx, businessId);
      const row = await tx.bookkeepingConnection.update({
        where: { businessId_id: { businessId, id } },
        data: { companyName: body.companyName ?? null },
      });
      await this.audit.logIn(
        tx,
        'bookkeeping.connection.updated',
        { type: 'bookkeeping_connection', id },
        { clientId: p.engagement.clientId },
      );
      return toConnection(row, settings.staleSyncHours, now);
    });
  }

  async disconnect(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingConnection> {
    const now = new Date();
    return inFirm(this.database, businessId, async (tx) => {
      const found = await this.findConnection(tx, businessId, actor, id);
      const p = await lockProfileOf(tx, businessId, actor, found.engagementId);
      const settings = await readSettings(tx, businessId);
      if (found.status === 'DISCONNECTED')
        throw errors.clientState('This connection is already disconnected');
      const row = await tx.bookkeepingConnection.update({
        where: { businessId_id: { businessId, id } },
        data: { status: 'DISCONNECTED', disconnectedAt: now, credentialRef: null },
      });
      await tx.bookkeepingAccount.updateMany({
        where: { businessId, connectionId: id },
        data: { status: 'DISCONNECTED' },
      });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'SYNC',
        `Disconnected ${providerLabel(row.provider)}`,
        {
          provider: row.provider,
        },
      );
      await this.status.refresh(tx, businessId, p.engagementId, actor.userId, settings);
      await this.audit.logIn(
        tx,
        'bookkeeping.connection.disconnected',
        { type: 'bookkeeping_connection', id },
        { clientId: p.engagement.clientId },
      );
      return toConnection(row, settings.staleSyncHours, now);
    });
  }

  /**
   * Reconnect: the connection is authorized again (the provider's sign-in happens outside this
   * API), so an expired, failed or disconnected one is CONNECTED again with its error cleared and
   * an initial sync asked for. History and the last successful sync stay.
   */
  async reconnect(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingConnection> {
    const now = new Date();
    return inFirm(this.database, businessId, async (tx) => {
      const found = await this.findConnection(tx, businessId, actor, id);
      const p = await lockProfileOf(tx, businessId, actor, found.engagementId);
      const settings = await readSettings(tx, businessId);
      if (found.status === 'CONNECTED')
        throw errors.clientState('This connection is already connected');
      let row;
      try {
        row = await tx.bookkeepingConnection.update({
          where: { businessId_id: { businessId, id } },
          data: {
            status: 'CONNECTED',
            disconnectedAt: null,
            lastErrorCode: null,
            connectedByUserId: actor.userId,
            ...(found.status === 'DISCONNECTED' ? { connectedAt: now } : {}),
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw errors.companyConnected();
        return mapBookkeepingDbError(e);
      }
      await tx.bookkeepingAccount.updateMany({
        where: { businessId, connectionId: id, archivedAt: null },
        data: { status: 'CONNECTED' },
      });
      await tx.bookkeepingSyncRun.create({
        data: {
          businessId,
          connectionId: id,
          trigger: 'INITIAL',
          requestedByUserId: actor.userId,
          startedAt: now,
        },
      });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'SYNC',
        `Reconnected ${providerLabel(row.provider)}`,
        {
          provider: row.provider,
        },
      );
      await this.status.refresh(tx, businessId, p.engagementId, actor.userId, settings);
      await this.audit.logIn(
        tx,
        'bookkeeping.connection.reconnected',
        { type: 'bookkeeping_connection', id },
        { clientId: p.engagement.clientId },
      );
      return toConnection(row, settings.staleSyncHours, now);
    });
  }

  async syncRuns(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    q: z.output<typeof BookkeepingListQuery>,
  ): Promise<BookkeepingSyncRunList> {
    const { rows, total, names } = await inFirm(this.database, businessId, async (tx) => {
      await this.findConnection(tx, businessId, actor, id);
      const where = { businessId, connectionId: id };
      const [rows, total] = await Promise.all([
        tx.bookkeepingSyncRun.findMany({
          where,
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          ...skipTake(q),
        }),
        tx.bookkeepingSyncRun.count({ where }),
      ]);
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.requestedByUserId),
      );
      return { rows, total, names };
    });
    await this.audit.log(
      'bookkeeping.syncs.listed',
      { type: 'bookkeeping_connection', id },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        outcome: r.outcome,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        errorCode: r.errorCode,
        message: r.message,
        counts: r.counts as Record<string, number>,
        requestedBy: memberRefOf(names, r.requestedByUserId),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  // ---------- Accounts ----------

  async accounts(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingAccountList> {
    const rows = await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      return tx.bookkeepingAccount.findMany({
        where: { businessId, engagementId: p.engagementId, archivedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
    });
    await this.audit.log(
      'bookkeeping.accounts.listed',
      { type: 'bookkeeping_client', id },
      { count: rows.length },
    );
    return { items: rows.map(toAccount) };
  }

  async addAccount(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof AddBookkeepingAccountRequest>,
  ): Promise<BookkeepingAccount> {
    return inFirm(this.database, businessId, async (tx) => {
      const p = await lockProfile(tx, businessId, actor, id);
      let row;
      try {
        row = await tx.bookkeepingAccount.create({
          data: {
            businessId,
            engagementId: p.engagementId,
            name: body.name,
            type: body.type,
            institution: body.institution ?? null,
            mask: body.mask ?? null,
            balanceCents: body.balanceCents ?? null,
            balanceAsOf: body.balanceAsOf ? new Date(body.balanceAsOf) : null,
            status: 'CONNECTED',
            reconcile: body.reconcile,
          },
        });
      } catch (e) {
        return mapBookkeepingDbError(e);
      }
      await addActivity(tx, businessId, p.engagementId, actor.userId, 'OTHER', 'Account added', {
        accountId: row.id,
      });
      await this.audit.logIn(
        tx,
        'bookkeeping.account.added',
        { type: 'bookkeeping_account', id: row.id },
        { clientId: p.engagement.clientId },
      );
      return toAccount(row);
    });
  }

  async updateAccount(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof UpdateBookkeepingAccountRequest>,
  ): Promise<BookkeepingAccount> {
    return inFirm(this.database, businessId, async (tx) => {
      const found = await tx.bookkeepingAccount.findFirst({
        where: { businessId, id, engagement: reachEngagement(actor) },
      });
      if (!found) throw errors.notFound();
      const p = await lockProfileOf(tx, businessId, actor, found.engagementId);
      const data: Prisma.BookkeepingAccountUncheckedUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.institution !== undefined) data.institution = body.institution;
      if (body.mask !== undefined) data.mask = body.mask;
      if (body.reconcile !== undefined) data.reconcile = body.reconcile;
      if (body.archived !== undefined) data.archivedAt = body.archived ? new Date() : null;
      if (body.balanceCents !== undefined) {
        data.balanceCents = body.balanceCents;
        data.balanceAsOf =
          body.balanceCents === null ? null : new Date(body.balanceAsOf ?? Date.now());
      }
      let row;
      try {
        row = await tx.bookkeepingAccount.update({
          where: { businessId_id: { businessId, id } },
          data,
        });
      } catch (e) {
        return mapBookkeepingDbError(e);
      }
      await this.audit.logIn(
        tx,
        'bookkeeping.account.updated',
        { type: 'bookkeeping_account', id },
        { clientId: p.engagement.clientId, fields: Object.keys(body).sort() },
      );
      return toAccount(row);
    });
  }
}
