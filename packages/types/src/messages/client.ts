import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { clientPath, portalMe } from '../clients/client.js';
import {
  CreateInternalNoteRequest,
  CreateMessageThreadRequest,
  FirmMessage,
  InternalNote,
  InternalNoteList,
  ListInternalNotesQuery,
  ListMessageThreadsQuery,
  ListMyMessageThreadsQuery,
  MessageThread,
  MessageThreadDetail,
  MessageThreadId,
  MessageThreadList,
  MyMessage,
  MyMessageThread,
  MyMessageThreadDetail,
  MyMessageThreadList,
  MyNotepad,
  SaveMyNoteRequest,
  SendMessageRequest,
  SetMyNoteReminderRequest,
  StartMyMessageThreadRequest,
  UnreadMessageCount,
  UpdateMessageThreadRequest,
} from './schemas.js';

const BASE = '/business/message-threads';
const one = (id: string) => `${BASE}/${parseInput(MessageThreadId, id)}`;

/**
 * `api.messages` (apps/web/src/lib/api.ts): the firm's message threads with its clients, and its
 * internal notes per client. Owner and Admin: every client's; Staff: only their own clients'
 * (others are 404 NOT_FOUND, as is another firm's). Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createMessagesClient(request: ApiRequest) {
  return {
    /** One page, newest activity first; pass `nextCursor` back as `cursor` for the next. */
    list: async (query: ListMessageThreadsQuery = {}): Promise<MessageThreadList> =>
      request(MessageThreadList, `${BASE}${toQuery(parseInput(ListMessageThreadsQuery, query))}`),
    /** Unread messages from clients: the Messages menu badge. */
    unreadCount: async (): Promise<UnreadMessageCount> =>
      request(UnreadMessageCount, `${BASE}/unread-count`),
    /** The thread and its messages, oldest first. Opening it does not mark it read. */
    get: async (id: string): Promise<MessageThreadDetail> => request(MessageThreadDetail, one(id)),
    /** A new thread with its first message; the client gets an email notice (no content). */
    create: async (
      clientId: string,
      body: CreateMessageThreadRequest,
    ): Promise<MessageThreadDetail> =>
      request(MessageThreadDetail, `${clientPath(clientId)}/message-threads`, {
        method: 'POST',
        body: parseInput(CreateMessageThreadRequest, body),
      }),
    /** Close or reopen the client's replies. */
    update: async (id: string, body: UpdateMessageThreadRequest): Promise<MessageThread> =>
      request(MessageThread, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateMessageThreadRequest, body),
      }),
    /** The firm can always reply, even with the client's replies closed. */
    reply: async (id: string, body: SendMessageRequest): Promise<FirmMessage> =>
      request(FirmMessage, `${one(id)}/messages`, {
        method: 'POST',
        body: parseInput(SendMessageRequest, body),
      }),
    /** Marks the client's messages read (their read receipts). Repeating is harmless. */
    markRead: async (id: string): Promise<MessageThread> =>
      request(MessageThread, `${one(id)}/read`, { method: 'POST', body: {} }),
    /** Marks the client's latest message unread again. */
    markUnread: async (id: string): Promise<MessageThread> =>
      request(MessageThread, `${one(id)}/unread`, { method: 'POST', body: {} }),
    /** A client's internal notes, newest first; never shown to the client. */
    notes: async (
      clientId: string,
      query: ListInternalNotesQuery = {},
    ): Promise<InternalNoteList> =>
      request(
        InternalNoteList,
        `${clientPath(clientId)}/notes${toQuery(parseInput(ListInternalNotesQuery, query))}`,
      ),
    addNote: async (clientId: string, body: CreateInternalNoteRequest): Promise<InternalNote> =>
      request(InternalNote, `${clientPath(clientId)}/notes`, {
        method: 'POST',
        body: parseInput(CreateInternalNoteRequest, body),
      }),
  };
}

export type MessagesClient = ReturnType<typeof createMessagesClient>;

/**
 * `api.myMessages(firmSlug)`: the signed-in client's threads with the firm (portal Messages and
 * Notes) and the login's own private notepad. The client comes from the session, never the URL.
 */
export function createMyMessagesClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/message-threads`;
  const mine = (id: string) => `${base()}/${parseInput(MessageThreadId, id)}`;
  const notes = () => `${portalMe(firmSlug)}/notes`;
  return {
    /** One page, newest activity first; pass `nextCursor` back as `cursor` for the next. */
    list: async (query: ListMyMessageThreadsQuery = {}): Promise<MyMessageThreadList> =>
      request(
        MyMessageThreadList,
        `${base()}${toQuery(parseInput(ListMyMessageThreadsQuery, query))}`,
      ),
    /** Unread messages from the firm: the sidebar badge. */
    unreadCount: async (): Promise<UnreadMessageCount> =>
      request(UnreadMessageCount, `${base()}/unread-count`),
    /** Messages oldest first. Opening it does not mark it read. */
    get: async (id: string): Promise<MyMessageThreadDetail> =>
      request(MyMessageThreadDetail, mine(id)),
    /** "Send a Message": a new thread; the firm gets an email notice (no content). */
    start: async (body: StartMyMessageThreadRequest): Promise<MyMessageThreadDetail> =>
      request(MyMessageThreadDetail, base(), {
        method: 'POST',
        body: parseInput(StartMyMessageThreadRequest, body),
      }),
    /** 409 REPLIES_DISABLED when the firm closed replies. */
    reply: async (id: string, body: SendMessageRequest): Promise<MyMessage> =>
      request(MyMessage, `${mine(id)}/messages`, {
        method: 'POST',
        body: parseInput(SendMessageRequest, body),
      }),
    /** Marks the firm's messages read (the firm sees the receipt). Repeating is harmless. */
    markRead: async (id: string): Promise<MyMessageThread> =>
      request(MyMessageThread, `${mine(id)}/read`, { method: 'POST', body: {} }),
    /** "Mark unread": the firm's latest message is unread again. */
    markUnread: async (id: string): Promise<MyMessageThread> =>
      request(MyMessageThread, `${mine(id)}/unread`, { method: 'POST', body: {} }),
    /** The login's own notepad: the latest text and the reminder. */
    notepad: async (): Promise<MyNotepad> => request(MyNotepad, notes()),
    /** "Save Note": a new version, and the reminder (left out: kept; null: removed). */
    saveNote: async (body: SaveMyNoteRequest): Promise<MyNotepad> =>
      request(MyNotepad, notes(), { method: 'PUT', body: parseInput(SaveMyNoteRequest, body) }),
    /** Sets, moves or (null) removes the reminder. 409 NOTE_REQUIRED before the first save. */
    setReminder: async (body: SetMyNoteReminderRequest): Promise<MyNotepad> =>
      request(MyNotepad, `${notes()}/reminder`, {
        method: 'PUT',
        body: parseInput(SetMyNoteReminderRequest, body),
      }),
  };
}

export type MyMessagesClient = ReturnType<typeof createMyMessagesClient>;
