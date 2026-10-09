import { z } from 'zod';
import { MessageDirection } from '../db-enums.js';
import { MemberRef } from '../clients/schemas.js';
import { SearchText, text } from '../clients/text.js';

// Messages and notes (R20). Contract for the firm's Messages pages (Fahad, F10) and the portal's
// Messages and Notes tab (R17, N09). docs/api/messages.yaml explains every route.
//
// Firm routes: /api/v1/business/message-threads..., /business/clients/{id}/message-threads,
// /business/clients/{id}/notes and /business/notes/{id}. Owner and Admin reach every client; Staff
// only their assigned clients (others are 404, as is another firm's).
// Portal routes: /api/v1/portal/{firmSlug}/me/messages... and /me/notes. The client and the login
// always come from the session, never from the path or the body.
//
// Three kinds of text, never mixed:
// - Messages: between the firm and the client. Never edited or deleted; only the read state
//   changes, and it is one state for the whole receiving side (any staff member's read counts
//   for the firm; any of the client's logins for the client).
// - Internal notes: the firm's own notes on a client. No portal route and no message response
//   ever carries them.
// - Private notes: one client login's own notepad. Only that login ever sees it; no staff role.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const MessageThreadId = z.uuid();
export const MessageId = z.uuid();
export const InternalNoteId = z.uuid();

/** Subject: one line, up to 200 characters (the database agrees). */
const Subject = text(200, 'one', 'Enter a subject');
/** Message body: several lines, up to 10,000 characters (the database agrees). */
const MessageBody = text(10_000, 'many', 'Enter a message');
const InternalNoteBody = text(10_000, 'many', 'Enter a note');
/** Private note: several lines, up to 5,000 characters (the database agrees). */
const PrivateNoteBody = text(5_000, 'many', 'Enter a note');

/**
 * The record a thread is about, e.g. `{ type: 'document_request', id }`. The type is lower snake
 * case (the database agrees); the site decides which records it links.
 */
export const RelatedRecord = z.object({
  type: z
    .string()
    .max(50)
    .regex(/^[a-z][a-z_]*$/, 'Use lower case letters and underscores'),
  id: z.uuid(),
});
export type RelatedRecord = z.infer<typeof RelatedRecord>;

const Page = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
};
const Bool = z.enum(['true', 'false']).transform((v) => v === 'true');

// ---------------------------------------------------------------------------------------------
// Firm side
// ---------------------------------------------------------------------------------------------

/** Who wrote a message, as the firm sees it: a staff member, or one of the client's logins. */
export const MessageSender = z.object({
  kind: z.enum(['STAFF', 'CLIENT']),
  userId: z.uuid(),
  name: z.string(),
});
export type MessageSender = z.infer<typeof MessageSender>;

/** A message as the firm sees it. */
export const Message = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  direction: MessageDirection,
  sender: MessageSender,
  body: z.string(),
  /**
   * The receiving side's read state. On the firm's own (FIRM_TO_CLIENT) messages this is the
   * read receipt: when the client read it. On the client's, when the firm read it.
   */
  readAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type Message = z.infer<typeof Message>;

/** The latest message of a thread, for list rows: no body, only a short excerpt. */
export const LastMessage = z.object({
  direction: MessageDirection,
  senderName: z.string(),
  /** The first 140 characters of the body, on one line. */
  excerpt: z.string(),
  createdAt: DateTime,
});

/** A thread as the firm's lists show it. */
export const MessageThread = z.object({
  id: z.uuid(),
  client: z.object({ id: z.uuid(), displayName: z.string() }),
  engagementId: z.uuid().nullable(),
  subject: z.string(),
  related: RelatedRecord.nullable(),
  /** False: the client can read but not reply. The firm can always write. */
  repliesEnabled: z.boolean(),
  /** Who opened the thread: a staff member, or a client login. */
  startedBy: MessageSender.nullable(),
  lastMessage: LastMessage.nullable(),
  /** The client's messages the firm has not read yet. */
  unreadCount: z.number().int().min(0),
  createdAt: DateTime,
});
export type MessageThread = z.infer<typeof MessageThread>;

/** One thread and every message in it, oldest first. Reading it marks nothing read. */
export const MessageThreadDetail = MessageThread.extend({ messages: z.array(Message) });
export type MessageThreadDetail = z.infer<typeof MessageThreadDetail>;

/**
 * GET /business/message-threads (the inbox: every thread the caller may see) and
 * GET /business/clients/{id}/message-threads (one client's). Newest activity first. `search`
 * matches the subject and the messages' text; `unread=true` keeps threads with unread client
 * messages.
 */
export const ListMessageThreadsQuery = z.strictObject({
  search: SearchText.optional(),
  unread: Bool.optional(),
  ...Page,
});
export type ListMessageThreadsQuery = z.input<typeof ListMessageThreadsQuery>;

export const MessageThreadList = z.object({
  items: z.array(MessageThread),
  nextCursor: z.string().nullable(),
});
export type MessageThreadList = z.infer<typeof MessageThreadList>;

/** POST /business/clients/{id}/message-threads: a new thread with its first message. */
export const CreateMessageThreadRequest = z.strictObject({
  subject: Subject,
  body: MessageBody,
  /** One of this client's engagements (404 otherwise). */
  engagementId: z.uuid().optional(),
  related: z.strictObject({ type: RelatedRecord.shape.type, id: z.uuid() }).optional(),
  /** Default true. */
  repliesEnabled: z.boolean().optional(),
});
export type CreateMessageThreadRequest = z.input<typeof CreateMessageThreadRequest>;

/** POST /business/message-threads/{id}/messages and POST /portal/{slug}/me/messages/{id}/messages. */
export const SendMessageRequest = z.strictObject({ body: MessageBody });
export type SendMessageRequest = z.input<typeof SendMessageRequest>;

/** PATCH /business/message-threads/{id}: close or reopen the client's replies. */
export const UpdateMessageThreadRequest = z.strictObject({ repliesEnabled: z.boolean() });
export type UpdateMessageThreadRequest = z.input<typeof UpdateMessageThreadRequest>;

/**
 * GET /business/message-threads/unread-count: the client messages the firm has not read, in every
 * thread the caller may see, in total and per client (clients with none are left out).
 */
export const FirmUnreadCount = z.object({
  total: z.number().int().min(0),
  byClient: z.array(z.object({ clientId: z.uuid(), count: z.number().int().min(1) })),
});
export type FirmUnreadCount = z.infer<typeof FirmUnreadCount>;

// ---------------------------------------------------------------------------------------------
// Internal notes (firm only)
// ---------------------------------------------------------------------------------------------

/** One of the firm's internal notes on a client. Never shown in the portal. */
export const InternalNote = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  engagementId: z.uuid().nullable(),
  body: z.string(),
  author: MemberRef,
  /** The author, the Owner and Admins may edit and delete it. */
  canEdit: z.boolean(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type InternalNote = z.infer<typeof InternalNote>;

/** GET /business/clients/{id}/notes: newest first; `engagementId` keeps one service's notes. */
export const ListInternalNotesQuery = z.strictObject({ engagementId: z.uuid().optional() });
export type ListInternalNotesQuery = z.input<typeof ListInternalNotesQuery>;
export const InternalNoteList = z.object({ items: z.array(InternalNote) });

/** POST /business/clients/{id}/notes. */
export const CreateInternalNoteRequest = z.strictObject({
  body: InternalNoteBody,
  /** One of this client's engagements (404 otherwise). */
  engagementId: z.uuid().optional(),
});
export type CreateInternalNoteRequest = z.input<typeof CreateInternalNoteRequest>;

/** PATCH /business/notes/{id}. The engagement never changes. */
export const UpdateInternalNoteRequest = z.strictObject({ body: InternalNoteBody });
export type UpdateInternalNoteRequest = z.input<typeof UpdateInternalNoteRequest>;

// ---------------------------------------------------------------------------------------------
// Portal: the client's messages
// ---------------------------------------------------------------------------------------------

/**
 * Who wrote a message, as the client sees it: the firm (shown with the firm's name, never a staff
 * member's), this login ("You"), or another login of the same client (a spouse), by name.
 */
export const MyMessageFrom = z.enum(['FIRM', 'ME', 'HOUSEHOLD']);
export type MyMessageFrom = z.infer<typeof MyMessageFrom>;

export const MyMessage = z.object({
  id: z.uuid(),
  from: MyMessageFrom,
  /** The other login's name for HOUSEHOLD; null for FIRM and ME. */
  senderName: z.string().nullable(),
  body: z.string(),
  /** Only on the firm's messages: unread until the client opens or marks it read. */
  unread: z.boolean(),
  createdAt: DateTime,
});
export type MyMessage = z.infer<typeof MyMessage>;

/** A thread as the portal's table shows it (Subject, From, Date, the unread dot). */
export const MyMessageThread = z.object({
  id: z.uuid(),
  subject: z.string(),
  /** Who opened the thread: the From column. */
  from: MyMessageFrom,
  senderName: z.string().nullable(),
  related: RelatedRecord.nullable(),
  /** False: the client can read but not reply. */
  repliesEnabled: z.boolean(),
  /** The firm's messages in it the client has not read: the blue dot when above 0. */
  unreadCount: z.number().int().min(0),
  lastMessageAt: DateTime,
  createdAt: DateTime,
});
export type MyMessageThread = z.infer<typeof MyMessageThread>;

export const MyMessageThreadDetail = MyMessageThread.extend({ messages: z.array(MyMessage) });
export type MyMessageThreadDetail = z.infer<typeof MyMessageThreadDetail>;

/**
 * GET /portal/{slug}/me/messages. Newest first. `filter`: `all` (default), `from-firm` (threads
 * the firm opened: "Messages from LVP") or `sent` (threads this login opened: "Messages I Sent").
 * `search` matches the subject and the messages' text, within the filter.
 */
export const ListMyMessagesQuery = z.strictObject({
  filter: z.enum(['all', 'from-firm', 'sent']).optional().default('all'),
  search: SearchText.optional(),
  ...Page,
});
export type ListMyMessagesQuery = z.input<typeof ListMyMessagesQuery>;

export const MyMessageThreadList = z.object({
  items: z.array(MyMessageThread),
  nextCursor: z.string().nullable(),
});
export type MyMessageThreadList = z.infer<typeof MyMessageThreadList>;

/** POST /portal/{slug}/me/messages: "Send a Message" to the firm. */
export const CreateMyMessageThreadRequest = z.strictObject({
  subject: Subject,
  body: MessageBody,
});
export type CreateMyMessageThreadRequest = z.input<typeof CreateMyMessageThreadRequest>;

/** GET /portal/{slug}/me/messages/unread-count: the sidebar's Messages badge. */
export const UnreadCount = z.object({ count: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof UnreadCount>;

// ---------------------------------------------------------------------------------------------
// Portal: the client's private note
// ---------------------------------------------------------------------------------------------

/** The optional reminder on the note. `sentAt` is set once the reminder went out. */
export const NoteReminder = z.object({ remindAt: DateTime, sentAt: DateTime.nullable() });
export type NoteReminder = z.infer<typeof NoteReminder>;

/** This login's latest note. Each save keeps the earlier version (no history screen yet). */
export const MyNote = z.object({
  body: z.string(),
  savedAt: DateTime,
  reminder: NoteReminder.nullable(),
});
export type MyNote = z.infer<typeof MyNote>;

/** GET /portal/{slug}/me/notes: `note` is null until the first save. */
export const MyNoteResponse = z.object({ note: MyNote.nullable() });
export type MyNoteResponse = z.infer<typeof MyNoteResponse>;

/** A reminder time: in the future. */
const RemindAt = DateTime.refine((s) => Date.parse(s) > Date.now(), 'Pick a time in the future');

/**
 * PUT /portal/{slug}/me/notes: "Save Note", a new version. `remindAt`: a time sets or moves the
 * reminder, `null` removes it, and leaving it out keeps the current one.
 */
export const SaveMyNoteRequest = z.strictObject({
  body: PrivateNoteBody,
  remindAt: RemindAt.nullable().optional(),
});
export type SaveMyNoteRequest = z.input<typeof SaveMyNoteRequest>;

/** PUT /portal/{slug}/me/notes/reminder: set or move the reminder on the latest note. */
export const SetNoteReminderRequest = z.strictObject({ remindAt: RemindAt });
export type SetNoteReminderRequest = z.input<typeof SetNoteReminderRequest>;
