import { z } from 'zod';
import { SearchText, text } from '../clients/text.js';
import { OutboundRecipientStatus } from '../db-enums.js';
import { LastMessage, MessageSender } from './schemas.js';

// Conversations with leads (R60, MSG-F03's Leads tab, on R1's message_threads.lead_id). A lead has
// no portal: every message in a lead's thread is the firm's email or text to the lead, written
// there when it went out (New Message, or a reply here). The lead's own answers come back to the
// firm's email, never into the thread.
// Firm routes: /api/v1/business/lead-message-threads... Owner and Admin reach every lead's
// threads; Staff only their assigned leads' (others are 404, as is another firm's).

const DateTime = z.iso.datetime({ offset: true });

/** Who a lead conversation is with: the lead and how to reach them. */
export const LeadThreadContact = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type LeadThreadContact = z.infer<typeof LeadThreadContact>;

/** The channels that reach a lead. */
export const LeadMessageChannel = z.enum(['EMAIL', 'SMS']);
export type LeadMessageChannel = z.infer<typeof LeadMessageChannel>;

/** One of the firm's messages to a lead: what was sent, on which channel, and how it went. */
export const LeadMessage = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  sender: MessageSender,
  body: z.string(),
  /** The delivery that wrote it (null only for a message with no delivery on record). */
  channel: LeadMessageChannel.nullable(),
  status: OutboundRecipientStatus.nullable(),
  createdAt: DateTime,
});
export type LeadMessage = z.infer<typeof LeadMessage>;

/** A lead's thread as the firm's lists show it. */
export const LeadMessageThread = z.object({
  id: z.uuid(),
  lead: LeadThreadContact,
  subject: z.string(),
  /** The staff member whose message opened it. */
  startedBy: MessageSender.nullable(),
  lastMessage: LastMessage.nullable(),
  /** Archived: out of the active inbox, its history kept (null: active). */
  archivedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type LeadMessageThread = z.infer<typeof LeadMessageThread>;

/** One lead thread and every message in it, oldest first. */
export const LeadMessageThreadDetail = LeadMessageThread.extend({
  messages: z.array(LeadMessage),
});
export type LeadMessageThreadDetail = z.infer<typeof LeadMessageThreadDetail>;

/**
 * GET /business/lead-message-threads: the lead threads the caller may see, newest activity first.
 * `search` matches the subject, the messages' text, the lead's name and email, and a phone number
 * by its digits whatever the format; `archived=true` lists only archived threads.
 */
export const ListLeadMessageThreadsQuery = z.strictObject({
  search: SearchText.optional(),
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListLeadMessageThreadsQuery = z.input<typeof ListLeadMessageThreadsQuery>;

export const LeadMessageThreadList = z.object({
  items: z.array(LeadMessageThread),
  nextCursor: z.string().nullable(),
});
export type LeadMessageThreadList = z.infer<typeof LeadMessageThreadList>;

/**
 * POST /business/lead-message-threads/{id}/messages: the firm's next email or text to the lead,
 * on the thread's subject, sent now through New Message's own path (the same checks and
 * delivery). A lead the channel cannot reach is 409 with the reason as the code (NO_CONTACT,
 * NO_CONSENT, SUPPRESSED, PROVIDER_UNAVAILABLE, NOT_PERMITTED); a send that failed is 409
 * SEND_FAILED, and nothing is written to the thread.
 */
export const SendLeadMessageRequest = z
  .strictObject({
    body: text(10_000, 'many', 'Enter a message'),
    channel: LeadMessageChannel,
  })
  .refine((b) => b.channel !== 'SMS' || b.body.length <= 1600, {
    message: 'A text message is at most 1,600 characters',
    path: ['body'],
  });
export type SendLeadMessageRequest = z.input<typeof SendLeadMessageRequest>;
