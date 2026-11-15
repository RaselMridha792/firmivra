import type { TxClient } from '@firmivra/db';
import type { AuditService } from '../audit/audit.service.js';

/**
 * Clients Review Two N8-17 (Octavia, Nov 8): what moves a New client to Active, as the lead mapped
 * it onto the states Firmivra has (Nov 15). Accepting a submitted intake, or the work actually
 * starting: a service's Start Service (PENDING → ACTIVE, her "Currently Working On It"), a
 * document's review started (her document "Processing"), or a payroll client set to Processing.
 * A plain upload never activates; neither does submitting an intake (the client stays New).
 */
export type ClientActivationVia =
  'intake_accepted' | 'service_started' | 'document_review_started' | 'payroll_processing';

/**
 * Moves the client New → Active in the caller's transaction, audited as a status change
 * (`client.updated`, ids and from/to only, with what did it). A client past New (Active, On Hold,
 * Inactive...) or archived is left as it is, so a manual status always stands. True when it moved.
 */
export async function activateNewClient(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  clientId: string,
  actorUserId: string | null,
  via: ClientActivationVia,
): Promise<boolean> {
  const { count } = await tx.client.updateMany({
    where: { businessId, id: clientId, status: 'NEW', archivedAt: null },
    data: { status: 'ACTIVE', updatedByUserId: actorUserId },
  });
  if (count !== 1) return false;
  await audit.logIn(
    tx,
    'client.updated',
    { type: 'client', id: clientId },
    { fields: ['status'], from: 'NEW', to: 'ACTIVE', via },
    { businessId },
  );
  return true;
}
