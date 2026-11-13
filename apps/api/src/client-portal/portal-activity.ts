import { isIP } from 'node:net';
import type { TxClient } from '@firmivra/db';

// The Client Portal module's Activity (Client Portal developer instructions 24 and 26): what a
// client did in their portal, from `client_portal_activity`. AuditService copies into it, as it
// writes the audit row, only the actions below and only when the actor is that firm's client
// login. A copy holds the type, the entity, the login and the IP: never the audit metadata (no
// content, names, amounts or file names). The audit log stays the authoritative record.

/** The client actions copied, and the activity type each becomes. */
export const PORTAL_ACTIVITY: Readonly<Record<string, string>> = {
  'auth.signed_in': 'portal.signed_in',
  'auth.signed_out': 'portal.signed_out',
  'document.uploaded': 'document.uploaded',
  'document.viewed': 'document.viewed',
  'document_request.not_available': 'document_request.not_available',
  'request_packet.submitted': 'request_packet.submitted',
  'message.sent': 'message.sent',
  'intake.submitted': 'intake.submitted',
  'my_invoice.viewed': 'invoice.viewed',
  'invoice.checkout_started': 'invoice.checkout_started',
  'appointment.booked': 'appointment.booked',
  'appointment.changed': 'appointment.changed',
  'portal.profile_updated': 'profile.updated',
  'portal.name_change_requested': 'profile.name_change_requested',
  'portal.cancellation_requested': 'service.cancellation_requested',
};

/** A member's action on the client's portal, in the client's activity (no content). */
export async function recordStaffActivity(
  db: Pick<TxClient, 'clientPortalActivity'>,
  row: { businessId: string; clientId: string; userId: string; type: string; ip?: string | null },
): Promise<void> {
  await db.clientPortalActivity.create({
    data: {
      businessId: row.businessId,
      clientId: row.clientId,
      type: row.type,
      entityType: 'client',
      entityId: row.clientId,
      actorKind: 'STAFF',
      actorUserId: row.userId,
      ip: row.ip && isIP(row.ip) ? row.ip : null,
    },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TYPE = /^[a-z_]{1,40}$/;

/** The delegates the copy needs: a scoped client or a transaction in the firm's scope. */
export type PortalActivityDb = Pick<TxClient, 'clientAccount' | 'clientPortalActivity'>;

/** The audit row as the copy reads it. */
export interface CopiedAuditRow {
  businessId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
}

/**
 * Copies one audit row into the client's portal activity when its action is listed and its actor
 * is a client login of the row's firm (`clientAccountId` when the request already knows it). In
 * the row's firm scope, so another firm's login is never found. Returns whether it wrote.
 */
export async function copyPortalActivity(
  db: PortalActivityDb,
  row: CopiedAuditRow,
  clientAccountId?: string,
): Promise<boolean> {
  const type = PORTAL_ACTIVITY[row.action];
  if (!type) return false;
  const account = await db.clientAccount.findFirst({
    where: {
      businessId: row.businessId,
      userId: row.actorUserId,
      ...(clientAccountId ? { id: clientAccountId } : {}),
    },
    select: { id: true, clientId: true },
  });
  if (!account?.clientId) return false;
  // The table's checks: the entity's type and id together or neither; a client row has no member.
  const entity =
    row.entityId && UUID.test(row.entityId) && ENTITY_TYPE.test(row.entityType)
      ? { entityType: row.entityType, entityId: row.entityId }
      : {};
  await db.clientPortalActivity.create({
    data: {
      businessId: row.businessId,
      clientId: account.clientId,
      clientAccountId: account.id,
      type,
      ...entity,
      actorKind: 'CLIENT',
      ip: row.ip && isIP(row.ip) ? row.ip : null,
    },
  });
  return true;
}
