import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';

/**
 * Help & Support's in-app message (Octavia's dashboard review of Oct 25, D2): a member writes to
 * the Firmivra team from the "?" panel; it becomes a ticket in the Super Admin's support queue.
 * Opening Help sends nothing.
 */
export const SendSupportMessageRequest = z.strictObject({
  /** The same key on a retry answers the same ticket, so a double click sends one message. */
  requestId: z.uuid(),
  subject: z.string().trim().min(1, 'Enter a subject').max(120, 'Use 120 characters or fewer'),
  message: z
    .string()
    .trim()
    .min(1, 'Write your message')
    .max(4000, 'Use 4,000 characters or fewer'),
  /** The page the member wrote from: a path only (no query, so nothing typed in a search). */
  page: z
    .string()
    .max(200)
    .regex(/^\/[^?#]*$/, 'A path such as /clients')
    .optional(),
});
export type SendSupportMessageRequest = z.input<typeof SendSupportMessageRequest>;

export const SupportMessageSent = z.object({
  /** The ticket's number in Firmivra's support queue ("#1042"). */
  number: z.number().int().positive(),
  sentAt: z.iso.datetime({ offset: true }),
});
export type SupportMessageSent = z.infer<typeof SupportMessageSent>;

/** `api.supportMessages` (apps/web/src/lib/api.ts): Owner, Admin and Staff. */
export function createSupportMessagesClient(request: ApiRequest) {
  return {
    send: async (body: SendSupportMessageRequest): Promise<SupportMessageSent> =>
      request(SupportMessageSent, '/business/support/messages', {
        method: 'POST',
        body: parseInput(SendSupportMessageRequest, body),
      }),
  };
}
export type SupportMessagesClient = ReturnType<typeof createSupportMessagesClient>;
