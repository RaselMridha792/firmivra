import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { clientPath, portalMe } from '../clients/client.js';
import { OkResponse } from '../schemas.js';
import {
  CreateInternalNoteRequest,
  CreateMessageThreadRequest,
  CreateMyMessageThreadRequest,
  FirmUnreadCount,
  InternalNote,
  InternalNoteId,
  InternalNoteList,
  ListInternalNotesQuery,
  ListMessageThreadsQuery,
  ListMyMessagesQuery,
  Message,
  MessageThread,
  MessageThreadDetail,
  MessageThreadId,
  MessageThreadList,
  MyMessage,
  MyMessageThread,
  MyMessageThreadDetail,
  MyMessageThreadList,
  MyNoteResponse,
  SaveMyNoteRequest,
  SendMessageRequest,
  SetNoteReminderRequest,
  UnreadCount,
  UpdateInternalNoteRequest,
  UpdateMessageThreadRequest,
} from './schemas.js';

const THREADS = '/business/message-threads';
const thread = (id: string) => `${THREADS}/${parseInput(MessageThreadId, id)}`;
const note = (id: string) => `/business/notes/${parseInput(InternalNoteId, id)}`;

/**
 * `api.messages` (apps/web/src/lib/api.ts): the firm's message threads with its clients (F10).
 * Owner and Admin: every client's; Staff: only their assigned clients' (others are 404 NOT_FOUND,
 * as is another firm's). Reading never marks anything read: call `markRead` when a thread opens.
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createMessagesClient(request: ApiRequest) {
  return {
    /** The inbox: every thread the caller may see, newest activity first. */
    inbox: async (query: ListMessageThreadsQuery = {}): Promise<MessageThreadList> =>
      request(
        MessageThreadList,
        `${THREADS}${toQuery(parseInput(ListMessageThreadsQuery, query))}`,
      ),
    /** One client's threads, newest activity first. */
    listForClient: async (
      clientId: string,
      query: ListMessageThreadsQuery = {},
    ): Promise<MessageThreadList> =>
      request(
        MessageThreadList,
        `${clientPath(clientId)}/message-threads${toQuery(parseInput(ListMessageThreadsQuery, query))}`,
      ),
    /** The thread and its messages, oldest first. */
    get: async (id: string): Promise<MessageThreadDetail> =>
      request(MessageThreadDetail, thread(id)),
    /** A new thread with its first message. 409 CLIENT_ARCHIVED for an archived client. */
    create: async (
      clientId: string,
      body: CreateMessageThreadRequest,
    ): Promise<MessageThreadDetail> =>
      request(MessageThreadDetail, `${clientPath(clientId)}/message-threads`, {
        method: 'POST',
        body: parseInput(CreateMessageThreadRequest, body),
      }),
    /** The firm may write even while the client's replies are closed. */
    send: async (id: string, body: SendMessageRequest): Promise<Message> =>
      request(Message, `${thread(id)}/messages`, {
        method: 'POST',
        body: parseInput(SendMessageRequest, body),
      }),
    /** Close or reopen the client's replies. */
    update: async (id: string, body: UpdateMessageThreadRequest): Promise<MessageThread> =>
      request(MessageThread, thread(id), {
        method: 'PATCH',
        body: parseInput(UpdateMessageThreadRequest, body),
      }),
    /** Marks every client message in the thread read, for the whole firm. Repeating is harmless. */
    markRead: async (id: string): Promise<MessageThread> =>
      request(MessageThread, `${thread(id)}/read`, { method: 'POST', body: {} }),
    /** Marks the client's latest message unread again. 409 NOTHING_TO_MARK if it has none. */
    markUnread: async (id: string): Promise<MessageThread> =>
      request(MessageThread, `${thread(id)}/unread`, { method: 'POST', body: {} }),
    /** Unread client messages, in total and per client. Poll at most once a minute. */
    unreadCount: async (): Promise<FirmUnreadCount> =>
      request(FirmUnreadCount, `${THREADS}/unread-count`),
  };
}

export type MessagesClient = ReturnType<typeof createMessagesClient>;

/**
 * `api.clientNotes`: the firm's internal notes on a client (client record and service
 * workspaces). Never shown in the portal. Same reach as `api.messages`. The author, the Owner and
 * Admins may edit and delete a note (403 FORBIDDEN for anyone else).
 */
export function createClientNotesClient(request: ApiRequest) {
  return {
    /** Newest first; `engagementId` keeps one service's notes. */
    list: async (clientId: string, query: ListInternalNotesQuery = {}): Promise<InternalNote[]> =>
      (
        await request(
          InternalNoteList,
          `${clientPath(clientId)}/notes${toQuery(parseInput(ListInternalNotesQuery, query))}`,
        )
      ).items,
    create: async (clientId: string, body: CreateInternalNoteRequest): Promise<InternalNote> =>
      request(InternalNote, `${clientPath(clientId)}/notes`, {
        method: 'POST',
        body: parseInput(CreateInternalNoteRequest, body),
      }),
    update: async (id: string, body: UpdateInternalNoteRequest): Promise<InternalNote> =>
      request(InternalNote, note(id), {
        method: 'PATCH',
        body: parseInput(UpdateInternalNoteRequest, body),
      }),
    remove: async (id: string): Promise<OkResponse> =>
      request(OkResponse, note(id), { method: 'DELETE', body: {} }),
  };
}

export type ClientNotesClient = ReturnType<typeof createClientNotesClient>;

/**
 * `api.myMessages(firmSlug)`: the signed-in client's Messages tab at one firm (N09). Every login
 * of the client (primary, spouse, authorized) reads and writes the same threads.
 */
export function createMyMessagesClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/messages`;
  const one = (id: string) => `${base()}/${parseInput(MessageThreadId, id)}`;
  return {
    list: async (query: ListMyMessagesQuery = {}): Promise<MyMessageThreadList> =>
      request(MyMessageThreadList, `${base()}${toQuery(parseInput(ListMyMessagesQuery, query))}`),
    /** The thread and its messages, oldest first. Opening marks nothing: call `markRead`. */
    get: async (id: string): Promise<MyMessageThreadDetail> =>
      request(MyMessageThreadDetail, one(id)),
    /** "Send a Message": a new thread to the firm. */
    create: async (body: CreateMyMessageThreadRequest): Promise<MyMessageThreadDetail> =>
      request(MyMessageThreadDetail, base(), {
        method: 'POST',
        body: parseInput(CreateMyMessageThreadRequest, body),
      }),
    /** 409 REPLIES_CLOSED when the firm closed replies on the thread. */
    reply: async (id: string, body: SendMessageRequest): Promise<MyMessage> =>
      request(MyMessage, `${one(id)}/messages`, {
        method: 'POST',
        body: parseInput(SendMessageRequest, body),
      }),
    markRead: async (id: string): Promise<MyMessageThread> =>
      request(MyMessageThread, `${one(id)}/read`, { method: 'POST', body: {} }),
    /** Marks the firm's latest message unread again. 409 NOTHING_TO_MARK if it has none. */
    markUnread: async (id: string): Promise<MyMessageThread> =>
      request(MyMessageThread, `${one(id)}/unread`, { method: 'POST', body: {} }),
    /** The sidebar badge: unread firm messages. Poll at most once a minute and on focus. */
    unreadCount: async (): Promise<UnreadCount> => request(UnreadCount, `${base()}/unread-count`),
  };
}

export type MyMessagesClient = ReturnType<typeof createMyMessagesClient>;

/**
 * `api.myNotes(firmSlug)`: the signed-in login's private note (the Notes card). Only this login
 * ever sees it: never the firm, never another login of the same client.
 */
export function createMyNotesClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/notes`;
  return {
    get: async (): Promise<MyNoteResponse> => request(MyNoteResponse, base()),
    /** "Save Note": a new version. `remindAt` null removes the reminder; leave it out to keep it. */
    save: async (body: SaveMyNoteRequest): Promise<MyNoteResponse> =>
      request(MyNoteResponse, base(), { method: 'PUT', body: parseInput(SaveMyNoteRequest, body) }),
    /** 404 NOT_FOUND before the first save. */
    setReminder: async (body: SetNoteReminderRequest): Promise<MyNoteResponse> =>
      request(MyNoteResponse, `${base()}/reminder`, {
        method: 'PUT',
        body: parseInput(SetNoteReminderRequest, body),
      }),
    /** Repeating is harmless. */
    removeReminder: async (): Promise<MyNoteResponse> =>
      request(MyNoteResponse, `${base()}/reminder`, { method: 'DELETE', body: {} }),
  };
}

export type MyNotesClient = ReturnType<typeof createMyNotesClient>;
