import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';

export interface AuditEntity {
  /** For example 'client', 'document', 'membership'. */
  type: string;
  id?: string;
}

/**
 * Append-only audit log. Every action on client data calls `log` (CLAUDE.md rule 8).
 * Actor, firm, IP, user agent and request id come from the request context.
 * Metadata must never hold passwords, codes, tokens, SSNs or document content.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `at` names the firm and the actor where the request context has none, for example a signed-out
   * client signing up on a firm's portal. Left out, both come from the context.
   */
  async log(
    action: string,
    entity: AuditEntity,
    metadata?: Record<string, unknown>,
    at: { businessId?: string; actorUserId?: string } = {},
  ): Promise<void> {
    const data = this.row(action, entity, metadata, at);
    const client = data.businessId ? this.db.forBusiness(data.businessId) : this.db.forPlatform();
    await client.auditLog.create({ data });
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
    at: { businessId?: string; actorUserId?: string } = {},
  ): Promise<void> {
    await tx.auditLog.create({ data: this.row(action, entity, metadata, at) });
  }

  private row(
    action: string,
    entity: AuditEntity,
    metadata: Record<string, unknown> | undefined,
    at: { businessId?: string; actorUserId?: string },
  ) {
    const store = requestContext.getStore();
    return {
      businessId: at.businessId ?? store?.tenant?.businessId ?? null,
      actorUserId: at.actorUserId ?? store?.auth?.userId ?? null,
      action,
      entityType: entity.type,
      entityId: entity.id ?? null,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      ip: store?.ip ?? null,
      userAgent: store?.userAgent ?? null,
      requestId: store?.requestId ?? null,
    };
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
