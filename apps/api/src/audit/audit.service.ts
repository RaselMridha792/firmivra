import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  copyPortalActivity,
  PORTAL_ACTIVITY,
  type PortalActivityDb,
} from '../client-portal/portal-activity.js';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { redactMetadata } from './audit-values.js';

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
 * Metadata must never hold passwords, codes, tokens, SSNs or document content; as a second wall,
 * every row's metadata goes through `redactMetadata` (audit-values.ts) before it is written.
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
    try {
      await client.auditLog.create({ data });
    } catch (error) {
      // The caller's change has committed; this row is lost unless someone sees this line.
      this.writeFailed(data, error, false);
      throw error;
    }
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
    try {
      await tx.auditLog.create({ data });
    } catch (error) {
      // In the caller's transaction: its change rolls back with the row unless it catches this.
      this.writeFailed(data, error, true);
      throw error;
    }
    // In the caller's transaction, so the copy commits or rolls back with the action.
    if (this.copied(data)) await this.copy(tx, data);
  }

  /**
   * Audit Log Review 2, M04: a row that could not be written leaves one structured line,
   * `audit_write_failed`, that a log metric and alarm watch (infra). It names the action, the
   * firm, the record type and the request, and the error's class and database code: never the
   * metadata, the record id or the error's message, which may quote values (CLAUDE.md rule 4).
   */
  private writeFailed(
    data: ReturnType<AuditService['row']>,
    error: unknown,
    inTransaction: boolean,
  ): void {
    const name = error instanceof Error ? error.name : '';
    const code = (error as { code?: unknown } | null)?.code;
    this.logger.error(
      JSON.stringify({
        event: 'audit_write_failed',
        action: data.action,
        businessId: data.businessId,
        entityType: data.entityType,
        requestId: data.requestId,
        inTransaction,
        error: /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error',
        ...(typeof code === 'string' && /^P\d{4}$/.test(code) ? { code } : {}),
      }),
    );
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
      // M03: secrets never written, tax ids to their last 4, whatever the caller passed.
      metadata: (metadata === undefined ? undefined : redactMetadata(metadata)) as
        Prisma.InputJsonValue | undefined,
      ip: at.withoutOrigin ? null : (store?.ip ?? null),
      userAgent: at.withoutOrigin ? null : (store?.userAgent ?? null),
      requestId: store?.requestId ?? null,
    };
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
