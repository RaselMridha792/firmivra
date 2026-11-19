import type { TxClient } from '@firmivra/db';
import type { FirmActor } from './calendar-data.js';
import { errors } from './errors.js';

// P4-1 (r55_appointment_lead, Nov 17): an appointment has a client, a lead, or both (a converted
// lead's, which keeps the lead it came from). Who it is with is read through these two, never with
// an ad-hoc `?.`: a name for what is shown, and `withClient` for a path that needs a client.

/** Who the appointment is with: the client's name, else the lead's. */
export function clientOrLeadName(a: {
  client: { displayName: string } | null;
  lead?: { firstName: string; lastName: string } | null;
}): string {
  if (a.client) return a.client.displayName;
  if (a.lead) return `${a.lead.firstName} ${a.lead.lastName}`.trim();
  return 'Lead';
}

type Party = 'clientId' | 'client';
/** The row with its client present: `clientId` a string, `client` (when selected) not null. */
export type WithClient<T> = Omit<T, Party> & { [K in keyof T & Party]-?: NonNullable<T[K]> };

/**
 * The row, on a path that needs a client (the portal, the waitlist, invoices, a client's own list,
 * a client's reminders): a lead's own appointment, which has none yet, is refused with 409
 * LEAD_APPOINTMENT, never skipped silently.
 */
export function withClient<T extends { clientId?: string | null; client?: object | null }>(
  row: T,
): WithClient<T> {
  if (('clientId' in row && !row.clientId) || ('client' in row && !row.client)) {
    throw errors.leadAppointment();
  }
  return row as unknown as WithClient<T>;
}

/**
 * P4-2 (N8-18; the lead's answer, Nov 18): whether the member reaches the appointment's lead by the
 * lead pages' rule (Owner and Admin every lead; Staff the leads assigned to them). Only they may
 * choose Convert to New client (the lead's Convert page is theirs); the appointment's own staff
 * member records Keep as Lead and Follow Up through the appointment's reach.
 */
export function reachesLead(actor: FirmActor, lead: { assignedUserId: string | null }): boolean {
  return (
    actor.role !== 'STAFF' || lead.assignedUserId?.toLowerCase() === actor.userId.toLowerCase()
  );
}

/** P4-1: the lead behind a LEAD contact of the booking forms. */
export interface BookableLead {
  id: string;
  /** Set once the lead converted: it then books as this client. */
  clientId: string | null;
  phone: string | null;
}

/**
 * P4-1: the lead a booking names, row locked FOR SHARE (its conversion waits for the booking, or
 * the booking reads the client the conversion gave it). 404 for a lead of another firm, a Begin
 * Online draft or an expired one, and an archived lead (a merged one is archived too). A lead not
 * yet converted is booked only by a member who reaches it, by the lead pages' rule (Staff: the
 * leads assigned to them); a converted one books as its client, whose own rule applies.
 */
export async function leadToBook(
  tx: TxClient,
  businessId: string,
  actor: FirmActor,
  leadId: string,
): Promise<BookableLead> {
  const [lead] = await tx.$queryRaw<
    {
      id: string;
      client_id: string | null;
      archived_at: Date | null;
      assigned_user_id: string | null;
      phone: string | null;
    }[]
  >`
    SELECT id::text AS id, client_id::text AS client_id, archived_at,
           assigned_user_id::text AS assigned_user_id, phone
    FROM leads WHERE business_id = ${businessId}::uuid AND id = ${leadId}::uuid
      AND status::text NOT IN ('DRAFT', 'EXPIRED')
    FOR SHARE`;
  if (!lead || lead.archived_at) throw errors.notFound();
  if (lead.client_id) return { id: lead.id, clientId: lead.client_id, phone: null };
  if (actor.role === 'STAFF' && lead.assigned_user_id !== actor.userId.toLowerCase()) {
    throw errors.notFound();
  }
  return { id: lead.id, clientId: null, phone: lead.phone };
}
