import type { TxClient } from '@firmivra/db';
import type { MeetingLinkStore } from '../src/appointments/meeting-links.js';

/**
 * Tests only: members' meeting links in memory, keyed by firm and member, so the same person at
 * another firm has none (the Prisma-backed store will key on the membership the same way).
 */
export class FakeMeetingLinks implements MeetingLinkStore {
  readonly links = new Map<string, string>();

  private key(businessId: string, userId: string): string {
    return `${businessId.toLowerCase()}/${userId.toLowerCase()}`;
  }

  get(
    _tx: TxClient,
    businessId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    return Promise.resolve(
      new Map(userIds.map((id) => [id, this.links.get(this.key(businessId, id)) ?? null])),
    );
  }

  set(_tx: TxClient, businessId: string, userId: string, url: string | null): Promise<void> {
    if (url === null) this.links.delete(this.key(businessId, userId));
    else this.links.set(this.key(businessId, userId), url);
    return Promise.resolve();
  }
}
