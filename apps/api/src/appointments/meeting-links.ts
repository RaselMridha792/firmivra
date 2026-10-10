import { Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';

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
 * The Prisma-backed store: `memberships.meeting_url` (R0's intake engine migration; https only,
 * at most 500 characters, enforced by a CHECK). Reads and writes name businessId, so a link is
 * the member's at this firm only. Never log it.
 */
@Injectable()
export class PrismaMeetingLinks implements MeetingLinkStore {
  async get(
    tx: TxClient,
    businessId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const rows = await tx.membership.findMany({
      where: { businessId, userId: { in: [...userIds] } },
      select: { userId: true, meetingUrl: true },
    });
    const found = new Map(rows.map((r) => [r.userId, r.meetingUrl]));
    return new Map(userIds.map((id) => [id, found.get(id) ?? null]));
  }

  async set(tx: TxClient, businessId: string, userId: string, url: string | null): Promise<void> {
    await tx.membership.updateMany({ where: { businessId, userId }, data: { meetingUrl: url } });
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
