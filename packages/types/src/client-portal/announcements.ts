import { z } from 'zod';
import type { ApiRequest } from '../client.js';

/**
 * Where an announcement shows (Communications > Announcement > "Where"): the portal's dashboard
 * (the My Client Portal tabs), or one of its pages as well. None chosen: the dashboard.
 */
export const AnnouncementPlace = z.enum(['dashboard', 'messages', 'documents', 'billing']);
export type AnnouncementPlace = z.infer<typeof AnnouncementPlace>;

/** One announcement the signed-in client can see now: plain text, and its cleaned HTML. */
export const MyAnnouncement = z.object({
  id: z.uuid(),
  /** The announcement's subject; null when the firm gave none. */
  title: z.string().nullable(),
  /** Plain text: the firm's formatting becomes lines, never markup. */
  body: z.string(),
  /**
   * CM-F08: the announcement as the firm formatted it, for its own page, cleaned by the API for the
   * portal (alignment, the content fonts, https links and button links, images only from the firm's
   * own email-images address). Snippets (the dashboard card, bells, notices) use `body`.
   */
  html: z.string(),
  where: AnnouncementPlace,
  publishedAt: z.iso.datetime({ offset: true }),
  /** When it stops showing; null: until the firm expires it. */
  endsAt: z.iso.datetime({ offset: true }).nullable(),
});
export type MyAnnouncement = z.infer<typeof MyAnnouncement>;

/** GET /portal/{firmSlug}/me/announcements: newest first, at most 50. */
export const MyAnnouncementList = z.object({ items: z.array(MyAnnouncement) });
export type MyAnnouncementList = z.infer<typeof MyAnnouncementList>;

/**
 * `api.myAnnouncements(slug)` (apps/web/src/lib/api.ts): the announcements published to the
 * signed-in client from Communications, while inside their window and not expired.
 */
export function createMyAnnouncementsClient(request: ApiRequest, firmSlug: string) {
  return {
    list: async (): Promise<MyAnnouncementList> =>
      request(MyAnnouncementList, `/portal/${encodeURIComponent(firmSlug)}/me/announcements`),
  };
}
export type MyAnnouncementsClient = ReturnType<typeof createMyAnnouncementsClient>;
