import { type MyAnnouncementsClient, MyAnnouncementList } from '@firmivra/types';

/**
 * `api.myAnnouncements(slug)` in mock mode: two live announcements published to the sample
 * client from Communications (synthetic). Built on first use.
 */
export function myAnnouncementsMock(): MyAnnouncementsClient {
  return {
    list: async () =>
      MyAnnouncementList.parse({
        items: [
          {
            id: '01a14ebc-7954-75a4-be30-0ba529ae3a02',
            title: 'Pay invoices online',
            body: 'You can now pay any open invoice from Receipts & Invoices.',
            where: 'billing',
            publishedAt: '2026-10-20T14:00:00.000Z',
            endsAt: null,
          },
          {
            id: '01a14ebc-7954-75a4-be30-0ba529ae3a01',
            title: 'Extended Office Hours',
            body: 'We will be open extended hours during tax season to better serve you.\nSaturdays 10 AM - 2 PM through April 15.',
            where: 'dashboard',
            publishedAt: '2026-10-18T14:00:00.000Z',
            endsAt: '2027-04-15T23:00:00.000Z',
          },
        ],
      }),
  };
}
