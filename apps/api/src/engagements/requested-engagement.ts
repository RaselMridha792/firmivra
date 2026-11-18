import type { TxClient } from '@firmivra/db';
import type { AuditService } from '../audit/audit.service.js';

/**
 * Clients Review Two N8-23 (and Invoices Review 2 I-N01): a client not enrolled in a service gets
 * a pending request for it instead: the client's open one (one only, never a second), else a new
 * PENDING engagement with `title`. Not active, not billed by itself, not counted: the firm starts
 * or cancels it as usual, and the client's lifecycle status is not touched. The client row is
 * held so two requests at once make one. Audited `engagement.requested` with `via`.
 */
export async function requestedEngagement(
  tx: TxClient,
  audit: AuditService,
  input: {
    businessId: string;
    /** The member it is made for; null for A9's form sent on a client's own booking. */
    userId: string | null;
    clientId: string;
    serviceId: string;
    title: string;
    via: 'intake_send' | 'invoice';
    /** The plan chosen, by name, for a new request (an existing one keeps its own). */
    plan?: string | null;
  },
): Promise<{ id: string; status: string }> {
  const { businessId, clientId, serviceId } = input;
  await tx.$executeRaw`SELECT 1 FROM clients
    WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid FOR UPDATE`;
  const pending = await tx.engagement.findFirst({
    where: { businessId, clientId, serviceId, status: 'PENDING' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, status: true },
  });
  if (pending) return pending;
  const made = await tx.engagement.create({
    data: {
      businessId,
      clientId,
      serviceId,
      title: input.title,
      status: 'PENDING',
      ...(input.plan ? { package: input.plan } : {}),
      updatedByUserId: input.userId,
    },
    select: { id: true, status: true },
  });
  await audit.logIn(
    tx,
    'engagement.requested',
    { type: 'engagement', id: made.id },
    { clientId, serviceId, via: input.via },
    { businessId },
  );
  return made;
}
