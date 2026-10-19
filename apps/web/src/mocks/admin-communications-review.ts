import type { CommChannel } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

/** Review-page display fixture, pending a broadcast API contract. */
export interface BroadcastReviewFixture {
  name: string;
  category: string;
  description: string;
  createdBy: string;
  audience: string;
  recipients: number;
  filters: string;
  uploadedList: string;
  channels: Extract<CommChannel, 'EMAIL' | 'SMS' | 'IN_APP'>[];
  messageSummary: string;
  scheduledLabel: string;
  message: {
    title: string;
    greeting: string;
    body: string;
    action: string;
    footer: string;
    signature: string;
  };
}

export async function getBroadcastReview(): Promise<BroadcastReviewFixture | null> {
  await mockDelay();
  // Dev-only fixture states for browser checks; this does not add an API contract.
  const state =
    mocked('adminCommunications') && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('mockState')
      : null;
  if (!mocked('adminCommunications') || state === 'api-unavailable') {
    throw new TypeError('Broadcast review is unavailable. Please try again.');
  }
  if (mockedEmpty('adminCommunications') || state === 'empty') return null;

  return {
    name: 'Monthly Newsletter - October 2026',
    category: 'Newsletter',
    description: 'Our latest updates, tips, and important deadlines.',
    createdBy: 'Octavia Holder',
    audience: 'Active Clients',
    recipients: 892,
    filters: 'None',
    uploadedList: 'None',
    channels: ['EMAIL', 'SMS', 'IN_APP'],
    messageSummary: 'Monthly newsletter with company updates, tax tips, and key dates.',
    scheduledLabel: 'Oct 14, 2026 at 10:00 AM (EDT)',
    message: {
      title: 'Your Business. Our Priority.',
      greeting: 'Hi {First Name},',
      body: 'We’re excited to share our latest updates, helpful resources, and upcoming deadlines to keep your business on track.',
      action: 'Read More',
      footer: 'Thank you for being a valued client!',
      signature: 'The Firmivra Team',
    },
  };
}
