import { randomBytes } from 'node:crypto';
import type { Prisma, TxClient } from '@firmivra/db';
import { requestContext } from '../common/request-context.js';

// The two trails a change leaves (B8 "Audit"): the platform audit row (category INTEGRATION, or
// SECURITY for credentials and keys; R55's Audit & Security reads these) and, for a platform
// integration, a row in the central integration log. Neither ever holds a secret.

const TRACE = /^[A-Za-z0-9._:-]{1,128}$/;

/** The request's id when the log's check takes it, else null. */
export const requestIdOf = (): string | null => {
  const id = requestContext.getStore()?.requestId;
  return id && TRACE.test(id) ? id : null;
};
export const newCorrelationId = () => `corr_${randomBytes(9).toString('hex')}`;

export interface IntegrationAudit {
  action: string;
  entity: { type: string; id: string };
  /** The target's name at the time. */
  label: string;
  metadata?: Record<string, unknown>;
  category?: 'INTEGRATION' | 'SECURITY';
  severity?: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
}

/** One platform audit row with B4's event fields, inside the caller's admin transaction. */
export async function auditIn(tx: TxClient, a: IntegrationAudit): Promise<void> {
  const store = requestContext.getStore();
  await tx.auditLog.create({
    data: {
      businessId: null,
      actorUserId: store?.auth?.userId ?? null,
      action: a.action,
      entityType: a.entity.type,
      entityId: a.entity.id,
      metadata: a.metadata as Prisma.InputJsonValue | undefined,
      ip: store?.ip ?? null,
      userAgent: store?.userAgent ?? null,
      requestId: store?.requestId ?? null,
      category: a.category ?? 'INTEGRATION',
      severity: a.severity ?? (a.category === 'SECURITY' ? 'MEDIUM' : 'LOW'),
      outcome: 'SUCCESS',
      actorType: 'PLATFORM',
      actorRole: 'Super Admin',
      targetLabel: a.label.slice(0, 200),
    },
  });
}

export interface IntegrationLogEntry {
  integration: { id: string; provider: string; environment: 'LIVE' | 'TEST' };
  eventType: string;
  action: string;
  message: string;
  severity?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  succeeded?: boolean;
  errorCode?: string | null;
  details?: Record<string, string | number | null>;
  correlationId?: string;
  /** Set where the scope does not stamp it (the worker's platform scope). */
  actorUserId?: string | null;
}

/** One row of the central integration log about a platform integration; returns its id. */
export async function logIn(tx: TxClient, e: IntegrationLogEntry): Promise<string> {
  const row = await tx.platformIntegrationLog.create({
    data: {
      source: 'PLATFORM_INTEGRATION',
      integrationId: e.integration.id,
      provider: e.integration.provider,
      environment: e.integration.environment,
      severity: e.severity ?? 'INFO',
      eventType: e.eventType,
      action: e.action,
      succeeded: e.succeeded ?? true,
      errorCode: e.errorCode ?? null,
      message: e.message.slice(0, 2000),
      details: e.details as Prisma.InputJsonValue | undefined,
      requestId: requestIdOf(),
      correlationId: e.correlationId ?? newCorrelationId(),
      actorUserId: e.actorUserId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}
