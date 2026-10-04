import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
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

  async log(
    action: string,
    entity: AuditEntity,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const store = requestContext.getStore();
    const businessId = store?.tenant?.businessId ?? null;
    const client = businessId ? this.db.forBusiness(businessId) : this.db.forPlatform();
    await client.auditLog.create({
      data: {
        businessId,
        actorUserId: store?.auth?.userId ?? null,
        action,
        entityType: entity.type,
        entityId: entity.id ?? null,
        metadata: metadata as Prisma.InputJsonValue | undefined,
        ip: store?.ip ?? null,
        userAgent: store?.userAgent ?? null,
        requestId: store?.requestId ?? null,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
