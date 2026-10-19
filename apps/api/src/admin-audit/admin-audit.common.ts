import { ConflictException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { AdminAuditCategory, AdminAuditOutcome, AdminAuditSeverity } from '@firmivra/types';
import { requestContext } from '../common/request-context.js';

export const conflict = (code: string, message: string) => new ConflictException({ code, message });

/**
 * A Super Admin's own audit row, in admin scope (R0's `audit_logs_admin_insert`: a platform row
 * whose actor is the signed-in admin), with the normalized event fields, which the database wants
 * together (category, severity, outcome, actor type). `parentEventId` names the event it responds
 * to. Ids, field names and counts only in `metadata`.
 */
export async function writeAdminEvent(
  tx: TxClient,
  adminUserId: string,
  e: {
    action: string;
    entityType: string;
    entityId?: string | null;
    category: AdminAuditCategory;
    severity: AdminAuditSeverity;
    outcome?: AdminAuditOutcome;
    parentEventId?: string | null;
    subjectBusinessId?: string | null;
    targetLabel?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const store = requestContext.getStore();
  return tx.auditLog.create({
    data: {
      businessId: null,
      actorUserId: adminUserId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      metadata: (e.metadata ?? {}) as object,
      ip: store?.ip ?? null,
      userAgent: store?.userAgent ?? null,
      requestId: store?.requestId ?? null,
      category: e.category,
      severity: e.severity,
      outcome: e.outcome ?? 'SUCCESS',
      actorType: 'PLATFORM',
      actorRole: 'SUPER_ADMIN',
      parentEventId: e.parentEventId ?? null,
      subjectBusinessId: e.subjectBusinessId ?? null,
      targetLabel: e.targetLabel?.slice(0, 200) ?? null,
    },
    select: { id: true },
  });
}
