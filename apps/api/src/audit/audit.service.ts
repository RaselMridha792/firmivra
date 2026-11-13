import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  copyPortalActivity,
  PORTAL_ACTIVITY,
  type PortalActivityDb,
} from '../client-portal/portal-activity.js';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';

export interface AuditEntity {
  /** For example 'client', 'document', 'membership'. */
  type: string;
  id?: string;
}

/** Where the row goes and who acted, when not the request context's (see `log`). */
export interface AuditAt {
  /** The firm; `null` for the platform's row, never the context's firm. */
  businessId?: string | null;
  actorUserId?: string;
  /** Leaves out the IP and user agent, for a row the actor's audience must not trace to them. */
  withoutOrigin?: boolean;
}

/**
 * Append-only audit log. Every action on client data calls `log` (CLAUDE.md rule 8).
 * Actor, firm, IP, user agent and request id come from the request context.
 * Metadata must never hold passwords, codes, tokens, SSNs or document content.
 * A firm row whose action is one of a client's portal actions, written by that firm's client
 * login, is also copied into the client's portal activity (client-portal/portal-activity.ts).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `at` names the firm and the actor where the request context has none, for example a signed-out
   * client signing up on a firm's portal. Left out, both come from the context. `businessId: null`
   * is the platform's row (no firm) even in a firm's request, for example the platform's copy of
   * a firm Owner's answer to a support access request.
   */
  async log(
    action: string,
    entity: AuditEntity,
    metadata?: Record<string, unknown>,
    at: AuditAt = {},
  ): Promise<void> {
    const data = this.row(action, entity, metadata, at);
    const client = data.businessId ? this.db.forBusiness(data.businessId) : this.db.forPlatform();
    await client.auditLog.create({ data });
    const businessId = data.businessId;
    if (businessId && this.copied(data)) {
      // The audit row stands; a feed copy that fails never fails the client's action.
      try {
        await this.db.withScope({ kind: 'business', businessId }, (tx) => this.copy(tx, data));
      } catch {
        this.logger.warn(`Could not copy ${action} into the portal activity of firm ${businessId}`);
      }
    }
  }

  /**
   * `log` inside the caller's scoped transaction, so the row commits with its work (rows that
   * limits count, written under the same lock as the count). The transaction's scope must allow
   * the row: the firm's for a firm row, platform for a platform row.
   */
  async logIn(
    tx: TxClient,
    action: string,
    entity: AuditEntity,
    metadata?: Record<string, unknown>,
    at: AuditAt = {},
  ): Promise<void> {
    const data = this.row(action, entity, metadata, at);
    await tx.auditLog.create({ data });
    // In the caller's transaction, so the copy commits or rolls back with the action.
    if (this.copied(data)) await this.copy(tx, data);
  }

  /** A firm row of a listed action by someone not known to be staff (sign-in has no tenant). */
  private copied(data: ReturnType<AuditService['row']>): boolean {
    const pool = requestContext.getStore()?.auth?.pool;
    return (
      !!data.businessId &&
      !!data.actorUserId &&
      data.action in PORTAL_ACTIVITY &&
      pool !== 'STAFF' &&
      pool !== 'ADMIN'
    );
  }

  private copy(db: PortalActivityDb, data: ReturnType<AuditService['row']>): Promise<boolean> {
    const tenant = requestContext.getStore()?.tenant;
    return copyPortalActivity(
      db,
      {
        businessId: data.businessId!,
        actorUserId: data.actorUserId!,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        ip: data.ip,
      },
      tenant?.kind === 'client' ? tenant.clientAccountId : undefined,
    );
  }

  private row(
    action: string,
    entity: AuditEntity,
    metadata: Record<string, unknown> | undefined,
    at: AuditAt,
  ) {
    const store = requestContext.getStore();
    return {
      businessId:
        at.businessId === null ? null : (at.businessId ?? store?.tenant?.businessId ?? null),
      actorUserId: at.actorUserId ?? store?.auth?.userId ?? null,
      action,
      entityType: entity.type,
      entityId: entity.id ?? null,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      ip: at.withoutOrigin ? null : (store?.ip ?? null),
      userAgent: at.withoutOrigin ? null : (store?.userAgent ?? null),
      requestId: store?.requestId ?? null,
    };
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
