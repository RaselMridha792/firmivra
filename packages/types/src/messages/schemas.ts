import { z } from 'zod';
import { SearchText, text } from '../clients/text.js';
import { MessageDirection } from '../db-enums.js';

export { MessageDirection };

// Messages and notes (R11 step 6): subject threads between the firm and one client, read
// receipts and unread counts; the firm's internal notes per client; the client's private notepad
// with an optional reminder.
// Firm routes: /api/v1/business/message-threads/... and /business/clients/{id}/message-threads
// and /notes. Owner and Admin reach every client's threads and notes, Staff only their own
// clients' (any other, or another firm's, is 404).
// Portal routes: /api/v1/portal/{firmSlug}/me/message-threads and /me/notes. The client comes from
// the session, never the URL: another client's thread is 404.
// A message is never edited or deleted; `readAt` is the receiving side's read state (the read
// receipt). Internal notes are never shown to the client, and the client's private notes are never
// shown to the firm (the database shows them only to their own portal login).
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const MessageThreadId = z.uuid();

/** A thread's subject: one line, 1-200 characters. */
export const MessageSubject = text(200, 'one', 'Enter a subject');
/** A message: several lines, 1-5000 characters. */
export const MessageBody = text(5000, 'many', 'Enter a message');
/** A note (internal or private): several lines, 1-5000 characters. */
export const NoteBody = text(5000, 'many', 'Enter a note');

/** At most this many vault documents on one message. */
export const MAX_MESSAGE_ATTACHMENTS = 10;

/**
 * Vault documents of the thread's client to attach (their ids), each once. The firm attaches
 * documents shared with the client or uploaded by them, never internal ones; the client attaches
 * their own uploads and what the firm shared. Each must be scanned clean (409 ATTACHMENT_NOT_READY
 * while scanning, 404 for anything else).
 */
export const AttachmentDocumentIds = z
  .array(z.uuid())
  .max(MAX_MESSAGE_ATTACHMENTS, `Attach at most ${MAX_MESSAGE_ATTACHMENTS} documents`)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: 'Attach each document once',
  });

/** An attached vault document: open it with the documents API by its `id`. */
export const MessageAttachment = z.object({
  /** The document's id. */
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().min(0),
});
export type MessageAttachment = z.infer<typeof MessageAttachment>;

/** Booleans in a query string: `true` or `false`. */
const QueryFlag = z
  .preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean())
  .optional()
  .default(false);

const listFilters = {
  /** Only threads with a message from the other side not read yet. */
  unreadOnly: QueryFlag,
  /** The direction filters: threads with at least one message sent this way. */
  direction: MessageDirection.optional(),
  /** Matches the subject. */
  search: SearchText.optional(),
  /** From the previous page's nextCursor. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
};

/** Unread messages from the other side: the menu badge. */
export const UnreadMessageCount = z.object({
  /** Threads with at least one unread message. */
  threads: z.number().int().min(0),
  messages: z.number().int().min(0),
});
export type UnreadMessageCount = z.infer<typeof UnreadMessageCount>;

const threadFields = {
  id: z.uuid(),
  /** The client's engagement the thread is about, or null. */
  engagementId: z.uuid().nullable(),
  subject: z.string(),
  /** False: the client can read but not reply (409 REPLIES_DISABLED). */
  repliesEnabled: z.boolean(),
  /**
   * Set by the database when a message is added. Lists show only threads with a message; null
   * only for a thread another record opened before its first message.
   */
  lastMessageAt: DateTime.nullable(),
  /** Who sent the latest message: the list's "From" column. */
  lastMessageDirection: MessageDirection.nullable(),
  /** Messages from the other side not read yet. */
  unreadCount: z.number().int().min(0),
  createdAt: DateTime,
};

// ---------- Firm ----------

/** One row of the firm's threads list. */
export const MessageThread = z.object({
  ...threadFields,
  client: z.object({ id: z.uuid(), displayName: z.string() }),
});
export type MessageThread = z.infer<typeof MessageThread>;

/** A message as the firm sees it. `readAt` on a FIRM_TO_CLIENT message is the client's receipt. */
export const FirmMessage = z.object({
  id: z.uuid(),
  direction: MessageDirection,
  /** The staff member or the client's portal login who sent it. */
  sender: z.object({ userId: z.uuid(), name: z.string() }),
  body: z.string(),
  /** When the receiving side read it; null while unread. */
  readAt: DateTime.nullable(),
  createdAt: DateTime,
  attachments: z.array(MessageAttachment),
});
export type FirmMessage = z.infer<typeof FirmMessage>;

/** GET /business/message-threads/{id}: the thread and its messages, oldest first. */
export const MessageThreadDetail = MessageThread.extend({ messages: z.array(FirmMessage) });
export type MessageThreadDetail = z.infer<typeof MessageThreadDetail>;

/**
 * GET /business/message-threads: newest activity first. `clientId`: one client's (the client
 * record's Messages tab); left out, every client the member reaches (the Messages page).
 */
export const ListMessageThreadsQuery = z.strictObject({
  clientId: z.uuid().optional(),
  ...listFilters,
});
export type ListMessageThreadsQuery = z.input<typeof ListMessageThreadsQuery>;

export const MessageThreadList = z.object({
  items: z.array(MessageThread).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type MessageThreadList = z.infer<typeof MessageThreadList>;

/**
 * POST /business/clients/{id}/message-threads: a new thread with its first message. The
 * engagement must be this client's (404 otherwise). Replies are on unless `repliesEnabled` is false.
 */
export const CreateMessageThreadRequest = z.strictObject({
  subject: MessageSubject,
  body: MessageBody,
  engagementId: z.uuid().optional(),
  repliesEnabled: z.boolean().optional(),
  attachmentDocumentIds: AttachmentDocumentIds.optional(),
});
export type CreateMessageThreadRequest = z.input<typeof CreateMessageThreadRequest>;

/** PATCH /business/message-threads/{id}: close or reopen the client's replies. */
export const UpdateMessageThreadRequest = z.strictObject({ repliesEnabled: z.boolean() });
export type UpdateMessageThreadRequest = z.input<typeof UpdateMessageThreadRequest>;

/** POST .../message-threads/{id}/messages, on both sites. */
export const SendMessageRequest = z.strictObject({
  body: MessageBody,
  attachmentDocumentIds: AttachmentDocumentIds.optional(),
});
export type SendMessageRequest = z.input<typeof SendMessageRequest>;

/** An internal note about a client (Internal notes tab). Never shown to the client. */
export const InternalNote = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  engagementId: z.uuid().nullable(),
  body: z.string(),
  author: z.object({ userId: z.uuid(), name: z.string() }),
  createdAt: DateTime,
});
export type InternalNote = z.infer<typeof InternalNote>;

/** GET /business/clients/{id}/notes: newest first. */
export const ListInternalNotesQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListInternalNotesQuery = z.input<typeof ListInternalNotesQuery>;

export const InternalNoteList = z.object({
  items: z.array(InternalNote).max(100),
  nextCursor: z.string().nullable(),
});
export type InternalNoteList = z.infer<typeof InternalNoteList>;

/** POST /business/clients/{id}/notes. The engagement must be this client's (404 otherwise). */
export const CreateInternalNoteRequest = z.strictObject({
  body: NoteBody,
  engagementId: z.uuid().optional(),
});
export type CreateInternalNoteRequest = z.input<typeof CreateInternalNoteRequest>;

// ---------- Portal ----------

/** One row of the client's threads list (no staff details, no client). */
export const MyMessageThread = z.object(threadFields);
export type MyMessageThread = z.infer<typeof MyMessageThread>;

/** A message as the client sees it. `readAt` on a CLIENT_TO_FIRM message is the firm's receipt. */
export const MyMessage = z.object({
  id: z.uuid(),
  direction: MessageDirection,
  /** Sent by this portal login ("You"); a spouse's login of the same client is not "me". */
  fromMe: z.boolean(),
  /** The staff member's or the portal login's name. */
  senderName: z.string(),
  body: z.string(),
  readAt: DateTime.nullable(),
  createdAt: DateTime,
  attachments: z.array(MessageAttachment),
});
export type MyMessage = z.infer<typeof MyMessage>;

/** GET /portal/{firmSlug}/me/message-threads/{id}: messages oldest first. */
export const MyMessageThreadDetail = MyMessageThread.extend({ messages: z.array(MyMessage) });
export type MyMessageThreadDetail = z.infer<typeof MyMessageThreadDetail>;

/** GET /portal/{firmSlug}/me/message-threads: newest activity first. */
export const ListMyMessageThreadsQuery = z.strictObject(listFilters);
export type ListMyMessageThreadsQuery = z.input<typeof ListMyMessageThreadsQuery>;

export const MyMessageThreadList = z.object({
  items: z.array(MyMessageThread).max(100),
  nextCursor: z.string().nullable(),
});
export type MyMessageThreadList = z.infer<typeof MyMessageThreadList>;

/** POST /portal/{firmSlug}/me/message-threads ("Send a Message"): a new thread to the firm. */
export const StartMyMessageThreadRequest = z.strictObject({
  subject: MessageSubject,
  body: MessageBody,
  attachmentDocumentIds: AttachmentDocumentIds.optional(),
});
export type StartMyMessageThreadRequest = z.input<typeof StartMyMessageThreadRequest>;

/** A reminder date: in the future, within 5 years. */
export const ReminderAt = DateTime.refine((value) => Date.parse(value) > Date.now(), {
  message: 'Choose a time in the future',
}).refine((value) => Date.parse(value) < Date.now() + 5 * 366 * 86_400_000, {
  message: 'Choose a time within 5 years',
});

/**
 * GET /portal/{firmSlug}/me/notes: the signed-in login's own notepad (each login has its own).
 * Each save keeps the earlier text as a version; this is the latest. Never shown to the firm.
 */
export const MyNotepad = z.object({
  /** Null until the first save. */
  note: z.object({ id: z.uuid(), body: z.string(), savedAt: DateTime }).nullable(),
  /** The optional reminder. `remindedAt` once it went out; a new time arms it again. */
  reminder: z.object({ remindAt: DateTime, remindedAt: DateTime.nullable() }).nullable(),
});
export type MyNotepad = z.infer<typeof MyNotepad>;

/**
 * PUT /portal/{firmSlug}/me/notes ("Save Note"): saves the text as a new version. `remindAt`: a
 * time sets the reminder, null removes it, left out keeps it (a reminder already sent goes).
 */
export const SaveMyNoteRequest = z.strictObject({
  body: NoteBody,
  remindAt: ReminderAt.nullable().optional(),
});
export type SaveMyNoteRequest = z.input<typeof SaveMyNoteRequest>;

/**
 * PUT /portal/{firmSlug}/me/notes/reminder: sets, moves (null: removes) the reminder without
 * saving new text. 409 NOTE_REQUIRED before the first save.
 */
export const SetMyNoteReminderRequest = z.strictObject({ remindAt: ReminderAt.nullable() });
export type SetMyNoteReminderRequest = z.input<typeof SetMyNoteReminderRequest>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const MessageErrorCode = z.enum([
  /** 409: the firm closed replies on this thread (the client can still read it). */
  'REPLIES_DISABLED',
  /** 409: an attached document is still being scanned. */
  'ATTACHMENT_NOT_READY',
  /** 409: a reminder needs a saved note first. */
  'NOTE_REQUIRED',
]);
export type MessageErrorCode = z.infer<typeof MessageErrorCode>;
