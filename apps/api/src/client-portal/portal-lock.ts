import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { ClientId, type ClientPortalLock, LockClientPortalRequest } from '@firmivra/types';
import { isIP } from 'node:net';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import { type AuthContext, requestContext, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';

// Client Portal module, Access & Security (developer instructions 15 and 26): Lock and Unlock
// Portal Access. The lock is a `client_portal_locks` row; while it stands, every login of the
// client is refused at sign-in, on refresh, by `GET me` (auth/portal-clients.ts) and on every
// portal request (TenantGuard), so a lock ends their sessions at once. Nothing else changes:
// records, logins and history stay, and unlocking restores access as it was. Owner and Admin.

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

@Injectable()
export class PortalLockService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** Locks the client's portal; a locked client stays as it was (no second row or entry). */
  lock(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    reason: string | undefined,
  ): Promise<ClientPortalLock> {
    const businessId = tenant.businessId;
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await this.client(tx, clientId);
      const existing = await tx.clientPortalLock.findUnique({
        where: { businessId_clientId: { businessId, clientId } },
        select: { id: true },
      });
      if (!existing) {
        await tx.clientPortalLock.create({
          data: { businessId, clientId, lockedByUserId: userId, reason: reason || null },
        });
        // The reason is the firm's own note: kept on the lock, never copied into the log.
        await this.audit.logIn(
          tx,
          'client_portal.locked',
          { type: 'client', id: clientId },
          { reasonGiven: !!reason },
          { businessId },
        );
        await this.activity(tx, businessId, clientId, userId, 'portal.locked');
      }
      return this.state(tx, businessId, clientId);
    });
  }

  /** Removes the lock; an unlocked client stays as it was. */
  unlock(tenant: TenantContext, userId: string, clientId: string): Promise<ClientPortalLock> {
    const businessId = tenant.businessId;
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await this.client(tx, clientId);
      const { count } = await tx.clientPortalLock.deleteMany({ where: { businessId, clientId } });
      if (count > 0) {
        await this.audit.logIn(
          tx,
          'client_portal.unlocked',
          { type: 'client', id: clientId },
          {},
          { businessId },
        );
        await this.activity(tx, businessId, clientId, userId, 'portal.unlocked');
      }
      return this.state(tx, businessId, clientId);
    });
  }

  /** The firm's client, held for this change so two at once take turns; else 404. */
  private async client(tx: TxClient, clientId: string): Promise<void> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM clients WHERE id = ${clientId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
  }

  private async state(
    tx: TxClient,
    businessId: string,
    clientId: string,
  ): Promise<ClientPortalLock> {
    const lock = await tx.clientPortalLock.findUnique({
      where: { businessId_clientId: { businessId, clientId } },
      select: {
        lockedAt: true,
        reason: true,
        lockedBy: { select: { user: { select: { name: true } } } },
      },
    });
    return {
      clientId,
      locked: !!lock,
      lockedAt: lock?.lockedAt.toISOString() ?? null,
      lockedBy: lock?.lockedBy.user.name ?? null,
      reason: lock?.reason ?? null,
    };
  }

  /** The member's action in the client's portal activity (no content). */
  private async activity(
    tx: TxClient,
    businessId: string,
    clientId: string,
    userId: string,
    type: string,
  ): Promise<void> {
    const ip = requestContext.getStore()?.ip;
    await tx.clientPortalActivity.create({
      data: {
        businessId,
        clientId,
        type,
        entityType: 'client',
        entityId: clientId,
        actorKind: 'STAFF',
        actorUserId: userId,
        ip: ip && isIP(ip) ? ip : null,
      },
    });
  }
}

/** POST /business/client-portal/clients/{id}/lock and /unlock (packages/types client-portal). */
@Controller('business/client-portal/clients')
@Access('CLIENT_PORTAL')
export class PortalLockController {
  constructor(private readonly locks: PortalLockService) {}

  @Post(':id/lock')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  lock(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
    @Body(new ZodValidationPipe(LockClientPortalRequest)) body: LockClientPortalRequest,
  ): Promise<ClientPortalLock> {
    return this.locks.lock(tenant, auth.userId, id, body.reason);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  unlock(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ): Promise<ClientPortalLock> {
    return this.locks.unlock(tenant, auth.userId, id);
  }
}

@Module({ controllers: [PortalLockController], providers: [PortalLockService] })
export class PortalLockModule {}
