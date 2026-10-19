import type { CommChannel } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

export type BroadcastMessageChannel = Extract<CommChannel, 'EMAIL' | 'SMS' | 'IN_APP'>;

/** Display fixture for the broadcast message step until a message API contract exists. */
export interface BroadcastMessageFixture {
  channels: BroadcastMessageChannel[];
  senderName: string;
  senderEmail: string;
}

const fixture: BroadcastMessageFixture = {
  channels: ['EMAIL', 'SMS', 'IN_APP'],
  senderName: 'Your Firm Name',
  senderEmail: 'you@yourfirm.com',
};

export async function getBroadcastMessage(): Promise<BroadcastMessageFixture | null> {
  await mockDelay();
  const state =
    mocked('adminCommunications') && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('mockState')
      : null;

  if (!mocked('adminCommunications') || state === 'api-unavailable') {
    throw new TypeError("We couldn't load broadcast message details. Please try again.");
  }
  if (mockedEmpty('adminCommunications') || state === 'empty') return null;
  return fixture;
}
