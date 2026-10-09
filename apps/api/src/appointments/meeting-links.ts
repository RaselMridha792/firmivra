import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { AppointmentErrorCode } from '@firmivra/types';

// Meeting links (R14; contract in packages/types/src/appointments/schemas.ts, "Meeting links"):
// each member's default video meeting link. A link can carry the meeting's passcode (Zoom's
// ?pwd=), so it is never logged, never in audit metadata and never in an email or SMS.

/** Nest token of the MeetingLinkStore. */
export const MEETING_LINKS = Symbol('MEETING_LINKS');

/**
 * Where each member's default link lives. Both methods run in the caller's transaction of the
 * firm's business scope and always name businessId: a link belongs to one membership, so the
 * same person at another firm has another link (or none).
 */
export interface MeetingLinkStore {
  /** The link of each of `userIds` at this firm, null for none. */
  get(
    tx: TxClient,
    businessId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string | null>>;
  /** Sets (a normalized MeetingUrl) or clears (null) one member's link. */
  set(tx: TxClient, businessId: string, userId: string, url: string | null): Promise<void>;
}

/**
 * The binding until R0's memberships.meeting_url lands: every member has no link (bookings copy
 * none, a change of staff member keeps the details), and setting one is 503
 * MEETING_LINKS_UNAVAILABLE. Swap it for a Prisma-backed store reading and writing that column
 * (appointments.module.ts); nothing else changes.
 */
@Injectable()
export class UnavailableMeetingLinks implements MeetingLinkStore {
  get(
    _tx: TxClient,
    _businessId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    return Promise.resolve(new Map(userIds.map((id) => [id, null])));
  }

  set(): Promise<void> {
    const code: AppointmentErrorCode = 'MEETING_LINKS_UNAVAILABLE';
    return Promise.reject(
      new ServiceUnavailableException({ code, message: 'Meeting links are not available yet' }),
    );
  }
}

/** One member's link at this firm, or null. */
export async function linkOf(
  store: MeetingLinkStore,
  tx: TxClient,
  businessId: string,
  userId: string,
): Promise<string | null> {
  return (await store.get(tx, businessId, [userId])).get(userId) ?? null;
}

/**
 * The location details after a VIDEO appointment moves from one staff member to another: the
 * new member's link when the details are empty or still the previous member's current link; a
 * custom link (or any other text) stays. Same member, or not VIDEO: unchanged.
 */
export async function detailsAfterStaffChange(
  store: MeetingLinkStore,
  tx: TxClient,
  businessId: string,
  current: { staffUserId: string; locationKind: string; locationDetails: string | null },
  staffUserId: string,
): Promise<string | null> {
  const details = current.locationDetails;
  const previous = current.staffUserId.toLowerCase();
  const next = staffUserId.toLowerCase();
  if (current.locationKind !== 'VIDEO' || previous === next) return details;
  const links = await store.get(tx, businessId, [previous, next]);
  const previousLink = links.get(previous) ?? null;
  const empty = details === null || details.trim() === '';
  if (!empty && (previousLink === null || details !== previousLink)) return details;
  return links.get(next) ?? null;
}
