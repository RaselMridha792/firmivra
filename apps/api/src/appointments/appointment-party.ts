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
