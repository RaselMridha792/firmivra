import { z } from 'zod';
import { ClientTimelineKind } from '../db-enums.js';

// MSG-F16 (Octavia's Oct 27 Messages review) and the client's Activity tab: the client's own
// timeline (R1's client_timeline_entries, insert-only). An entry says what happened, when and by
// whom, and links to its record; it never holds a message's body or file names.

/** One entry, newest first. */
export const ClientTimelineEntry = z.object({
  id: z.uuid(),
  kind: ClientTimelineKind,
  /** The subject, or what it was ("Email"), up to 200 characters. */
  title: z.string(),
  /** A short line ("Sent by email by Sam Staff"), up to 500 characters. */
  summary: z.string().nullable(),
  occurredAt: z.iso.datetime(),
  /** The record it stands for: its page, for whoever may open it. Null when there is none. */
  href: z
    .string()
    .regex(/^\/[a-z]/)
    .nullable(),
  /** Null when the system wrote it. */
  createdBy: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
});
export type ClientTimelineEntry = z.infer<typeof ClientTimelineEntry>;

/** GET /business/clients/{id}/timeline: a page of the client's entries, newest first. */
export const ClientTimelineQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
});
export type ClientTimelineQuery = z.input<typeof ClientTimelineQuery>;

export const ClientTimelinePage = z.object({
  items: z.array(ClientTimelineEntry).max(50),
  nextCursor: z.string().nullable(),
});
export type ClientTimelinePage = z.infer<typeof ClientTimelinePage>;
