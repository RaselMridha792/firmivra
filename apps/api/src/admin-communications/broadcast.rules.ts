import { destinationFor } from './comm.rules.js';

export type BroadcastChannel = 'EMAIL' | 'SMS' | 'IN_APP';

/** One person an audience reaches, before channels: a firm owner, a sales lead or a team member. */
export interface AudiencePerson {
  type: 'FIRM' | 'LEAD' | 'TEAM';
  businessId: string | null;
  businessName: string | null;
  userId: string | null;
  salesContactId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
}

/** One send: a person on one channel, at the address the database checks for that channel. */
export interface Reach {
  channel: BroadcastChannel;
  person: AudiencePerson;
  address: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who a broadcast reaches on each of its channels. A person counts once per channel (the same
 * address twice is one send). Email needs a valid address, SMS an E.164 number; in-app reaches
 * team members only (their bell; a firm owner's in-app notices are the firm's own module).
 */
export function reachOf(
  people: readonly AudiencePerson[],
  channels: readonly BroadcastChannel[],
): Reach[] {
  const out: Reach[] = [];
  for (const channel of channels) {
    const seen = new Set<string>();
    for (const person of people) {
      let address: string | null;
      if (channel === 'EMAIL') {
        const email = destinationFor('EMAIL', person)?.toLowerCase() ?? null;
        address = email && EMAIL.test(email) ? email : null;
      } else if (channel === 'SMS') address = destinationFor('SMS', person);
      else address = person.type === 'TEAM' ? person.userId : null;
      if (!address || seen.has(address)) continue;
      seen.add(address);
      out.push({ channel, person, address });
    }
  }
  return out;
}

/** Distinct people in a reach (the broadcast's recipient count). */
export function peopleIn(reach: readonly Reach[]): number {
  return new Set(reach.map((r) => `${r.person.type}:${r.person.userId ?? r.person.salesContactId}`))
    .size;
}

export type SendOutcome = 'SENT' | 'PARTIALLY_SENT' | 'FAILED';

/** A channel's (or the whole broadcast's) status from its sent and failed counts. */
export function outcomeFromCounts(sent: number, failed: number): SendOutcome {
  if (failed === 0) return 'SENT';
  return sent === 0 ? 'FAILED' : 'PARTIALLY_SENT';
}

/** The library key the database accepts: platform/communications/<id>/<safe name>. */
export function mediaKey(id: string, fileName: string): string {
  const safe =
    fileName
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 120) || 'file';
  return `platform/communications/${id}/${safe}`;
}
