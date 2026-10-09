import {
  ApiRequestError,
  ClientId,
  CreateInternalNoteRequest,
  CreateMessageThreadRequest,
  type FirmMessage,
  type InternalNote,
  ListInternalNotesQuery,
  ListMessageThreadsQuery,
  ListMyMessageThreadsQuery,
  type MessageAttachment,
  type MessageDirection,
  type MessagesClient,
  type MessageThread,
  MessageThreadDetail,
  MessageThreadId,
  type MyMessage,
  type MyMessagesClient,
  type MyMessageThread,
  MyMessageThreadDetail,
  MyNotepad,
  parseInput,
  SaveMyNoteRequest,
  SendMessageRequest,
  SetMyNoteReminderRequest,
  StartMyMessageThreadRequest,
  UpdateMessageThreadRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { clientFixtures, firstClientId, type MockFirmRole, mockStaff } from './clients';
import { documentFixtures } from './documents';
import { engagementFixtures } from './engagements';

/**
 * Mock data for `api.messages` (firm) and `api.myMessages(slug)` (portal), R11. Synthetic data
 * only. Same input checks, rules and error codes as the API: Staff reach only their own clients'
 * threads, another client's thread is 404, the client's reply on a closed thread is 409
 * REPLIES_DISABLED, attachments are clean vault documents of the thread's client (never INTERNAL
 * ones), and private notes keep a version per save. Each mock keeps its own rows; callers get
 * copies. Nothing is built until the first call.
 */
const at = (month: number, day: number, hour: number) =>
  `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const threadId = (n: number) => `0199b6f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const messageId = (n: number) => `0199b6f1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const noteId = (n: number) => `0199b6f2-0000-7000-8000-${String(n).padStart(12, '0')}`;
/** The firm's owner (the signed-in member unless the mock role is STAFF). */
const mockOwner = { userId: '0199b6a0-0000-7000-8000-0000000000e1', name: 'Olivia Owner' };
/** Client 1's primary portal login: the signed-in client in mock mode. */
const myLogin = { userId: '0199b6a1-0000-7000-8000-0000000000b1', name: 'Jamie Sample' };

interface Row {
  id: string;
  direction: MessageDirection;
  sender: { userId: string; name: string };
  body: string;
  readAt: string | null;
  createdAt: string;
  attachmentIds: string[];
}
interface Thread {
  id: string;
  clientId: string;
  engagementId: string | null;
  subject: string;
  repliesEnabled: boolean;
  createdAt: string;
  messages: Row[];
}
interface Note {
  id: string;
  clientId: string;
  engagementId: string | null;
  body: string;
  author: { userId: string; name: string };
  createdAt: string;
}

let fixtures: { threads: Thread[]; notes: Note[] } | undefined;
let nextN = 1;

const msg = (
  direction: MessageDirection,
  body: string,
  createdAt: string,
  extra: Partial<Row> = {},
): Row => ({
  id: messageId(nextN++),
  direction,
  sender: direction === 'FIRM_TO_CLIENT' ? mockStaff : myLogin,
  body,
  readAt: null,
  createdAt,
  attachmentIds: [],
  ...extra,
});

/** Client 1's threads as on the Messages and Notes mockup, and one of client 3's. */
export function messageFixtures(): Readonly<{ threads: Thread[]; notes: Note[] }> {
  if (fixtures) return fixtures;
  const docs = documentFixtures().documents;
  const shared = docs.find((d) => d.direction === 'FIRM_TO_CLIENT' && d.scanStatus === 'CLEAN');
  const tax = engagementFixtures()[0]!;
  const thread = (n: number, data: Partial<Thread> & { subject: string; messages: Row[] }) => ({
    id: threadId(n),
    clientId: firstClientId,
    engagementId: null,
    repliesEnabled: true,
    createdAt: data.messages[0]!.createdAt,
    ...data,
  });
  const read = { readAt: at(1, 21, 9) };
  fixtures = {
    threads: [
      thread(1, {
        subject: 'Welcome to the firm!',
        repliesEnabled: false,
        messages: [msg('FIRM_TO_CLIENT', 'Welcome! Your portal is ready to use.', at(12, 20, 9))],
      }),
      thread(2, {
        subject: 'Follow Up',
        messages: [
          msg('CLIENT_TO_FIRM', 'Just following up on my last question.', at(12, 28, 16), read),
          msg('FIRM_TO_CLIENT', 'Thanks, we will look into it this week.', at(12, 29, 10), read),
        ],
      }),
      thread(3, {
        subject: 'Document Request',
        engagementId: tax.id,
        messages: [
          msg('FIRM_TO_CLIENT', 'Please review the attached letter.', at(1, 5, 11), {
            attachmentIds: shared ? [shared.id] : [],
          }),
        ],
      }),
      thread(4, {
        subject: 'Question About Deduction',
        messages: [msg('CLIENT_TO_FIRM', 'Can I deduct my home office?', at(1, 8, 14))],
      }),
      thread(5, {
        subject: 'Tax Return Update',
        engagementId: tax.id,
        messages: [msg('FIRM_TO_CLIENT', 'Your return is in review.', at(1, 10, 10))],
      }),
      thread(6, {
        subject: 'Quarterly estimate',
        clientId: clientFixtures()[2]!.id,
        messages: [
          msg('CLIENT_TO_FIRM', 'When is my next estimate due?', at(1, 9, 13), {
            sender: { userId: '0199b6a1-0000-7000-8000-0000000000b3', name: 'Riley Example' },
          }),
        ],
      }),
    ],
    notes: [
      {
        id: noteId(1),
        clientId: firstClientId,
        engagementId: tax.id,
        body: 'Prefers a call in the afternoon.',
        author: mockOwner,
        createdAt: at(1, 3, 15),
      },
    ],
  };
  return fixtures;
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const now = () => new Date().toISOString();
const newestFirst = (a: Thread, b: Thread) =>
  lastAt(b).localeCompare(lastAt(a)) || b.id.localeCompare(a.id);
const lastAt = (t: Thread) => t.messages.at(-1)?.createdAt ?? t.createdAt;
const other = (side: MessageDirection): MessageDirection =>
  side === 'FIRM_TO_CLIENT' ? 'CLIENT_TO_FIRM' : 'FIRM_TO_CLIENT';

/** The vault documents a message may carry: clean, of the thread's client, never INTERNAL. */
function attachments(clientId: string, ids: string[] | undefined): string[] {
  const docs = documentFixtures().documents;
  return (ids ?? []).map((id) => {
    const d = docs.find((x) => x.id === id.toLowerCase());
    if (!d || d.clientId !== clientId || d.direction === 'INTERNAL') throw notFound();
    if (d.scanStatus === 'PENDING') {
      throw fail(409, 'ATTACHMENT_NOT_READY', 'A document is still being checked');
    }
    if (d.scanStatus !== 'CLEAN') throw notFound();
    return d.id;
  });
}
const attachmentsOf = (r: Row): MessageAttachment[] =>
  r.attachmentIds.flatMap((id) => {
    const d = documentFixtures().documents.find((x) => x.id === id);
    return d
      ? [{ id, fileName: d.fileName, contentType: d.contentType, sizeBytes: d.sizeBytes }]
      : [];
  });

/** Paging over newest-first threads; the cursor is the last row's id. */
function page<T extends { id: string }>(rows: T[], cursor: string | undefined, limit: number) {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  if (cursor && start === 0) throw fail(400, 'VALIDATION_FAILED', 'The cursor is not valid');
  const items = rows.slice(start, start + limit);
  return { items, nextCursor: start + limit < rows.length ? (items.at(-1)?.id ?? null) : null };
}

type Filters = { unreadOnly: boolean; direction?: MessageDirection; search?: string };
/** `side`: who is looking (their unread messages are the other side's). */
function matches(t: Thread, side: MessageDirection, q: Filters): boolean {
  if (t.messages.length === 0) return false;
  if (q.unreadOnly && !t.messages.some((m) => m.direction === other(side) && !m.readAt)) {
    return false;
  }
  if (q.direction && !t.messages.some((m) => m.direction === q.direction)) return false;
  return !q.search || t.subject.toLowerCase().includes(q.search.toLowerCase());
}

const summary = (t: Thread, side: MessageDirection) => ({
  id: t.id,
  engagementId: t.engagementId,
  subject: t.subject,
  repliesEnabled: t.repliesEnabled,
  lastMessageAt: t.messages.at(-1)?.createdAt ?? null,
  lastMessageDirection: t.messages.at(-1)?.direction ?? null,
  unreadCount: t.messages.filter((m) => m.direction === other(side) && !m.readAt).length,
  createdAt: t.createdAt,
});

function unread(threads: Thread[], side: MessageDirection) {
  const counts = threads.map((t) => summary(t, side).unreadCount);
  return {
    threads: counts.filter((n) => n > 0).length,
    messages: counts.reduce((a, b) => a + b, 0),
  };
}

function markRead(t: Thread, side: MessageDirection) {
  for (const m of t.messages) if (m.direction === other(side) && !m.readAt) m.readAt = now();
}
function markUnread(t: Thread, side: MessageDirection) {
  const last = t.messages.filter((m) => m.direction === other(side)).at(-1);
  if (last) last.readAt = null;
}

/** An in-memory `api.messages`. `role: 'STAFF'` reaches only Sam Staff's clients. */
export function createMessagesMock(options: { role?: MockFirmRole } = {}): MessagesClient {
  const SIDE = 'FIRM_TO_CLIENT';
  const me = options.role === 'STAFF' ? mockStaff : mockOwner;
  const reach = new Set(
    clientFixtures()
      .filter((c) => options.role !== 'STAFF' || c.assignedTo?.userId === mockStaff.userId)
      .map((c) => c.id),
  );
  const threads: Thread[] = structuredClone(messageFixtures().threads);
  let notes: Note[] = structuredClone(messageFixtures().notes);
  const clientOf = (id: string) => {
    const c = clientFixtures().find((x) => x.id === id);
    if (!c || !reach.has(c.id)) throw notFound();
    return c;
  };
  const find = (id: string) => {
    const t = threads.find((x) => x.id === parseInput(MessageThreadId, id).toLowerCase());
    if (!t || !reach.has(t.clientId)) throw notFound();
    return t;
  };
  const engagementOf = (clientId: string, id: string | undefined) => {
    if (id && !engagementFixtures().some((e) => e.id === id && e.clientId === clientId)) {
      throw notFound();
    }
    return id ?? null;
  };
  const row = (t: Thread): MessageThread => ({
    ...summary(t, SIDE),
    client: { id: t.clientId, displayName: clientOf(t.clientId).displayName },
  });
  const message = (r: Row): FirmMessage => ({
    id: r.id,
    direction: r.direction,
    sender: r.sender,
    body: r.body,
    readAt: r.readAt,
    createdAt: r.createdAt,
    attachments: attachmentsOf(r),
  });
  const detail = (t: Thread) =>
    MessageThreadDetail.parse({ ...row(t), messages: t.messages.map(message) });
  const add = (t: Thread, body: string, ids?: string[]) => {
    const r = msg(SIDE, body, now(), { sender: me, attachmentIds: attachments(t.clientId, ids) });
    t.messages.push(r);
    return r;
  };
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListMessageThreadsQuery, query);
      if (q.clientId) clientOf(q.clientId);
      const rows = threads
        .filter((t) => reach.has(t.clientId) && (!q.clientId || t.clientId === q.clientId))
        .filter((t) => matches(t, SIDE, q))
        .sort(newestFirst);
      const { items, nextCursor } = page(rows, q.cursor, q.limit);
      return { items: items.map(row), nextCursor };
    },
    unreadCount: async () => {
      await mockDelay();
      return unread(
        threads.filter((t) => reach.has(t.clientId)),
        SIDE,
      );
    },
    get: async (id) => {
      await mockDelay();
      return detail(find(id));
    },
    create: async (clientId, body) => {
      await mockDelay();
      const cid = parseInput(ClientId, clientId);
      const b = parseInput(CreateMessageThreadRequest, body);
      clientOf(cid);
      const t: Thread = {
        id: threadId(100 + nextN++),
        clientId: cid,
        engagementId: engagementOf(cid, b.engagementId),
        subject: b.subject,
        repliesEnabled: b.repliesEnabled ?? true,
        createdAt: now(),
        messages: [],
      };
      add(t, b.body, b.attachmentDocumentIds);
      threads.push(t);
      return detail(t);
    },
    update: async (id, body) => {
      await mockDelay();
      const b = parseInput(UpdateMessageThreadRequest, body);
      const t = find(id);
      t.repliesEnabled = b.repliesEnabled;
      return row(t);
    },
    reply: async (id, body) => {
      await mockDelay();
      const b = parseInput(SendMessageRequest, body);
      const t = find(id);
      return message(add(t, b.body, b.attachmentDocumentIds));
    },
    markRead: async (id) => {
      await mockDelay();
      const t = find(id);
      markRead(t, SIDE);
      return row(t);
    },
    markUnread: async (id) => {
      await mockDelay();
      const t = find(id);
      markUnread(t, SIDE);
      return row(t);
    },
    notes: async (clientId, query = {}) => {
      await mockDelay();
      const cid = parseInput(ClientId, clientId);
      const q = parseInput(ListInternalNotesQuery, query);
      clientOf(cid);
      const rows = notes
        .filter((n) => n.clientId === cid)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const { items, nextCursor } = page(rows, q.cursor, q.limit);
      return { items: structuredClone(items) as InternalNote[], nextCursor };
    },
    addNote: async (clientId, body) => {
      await mockDelay();
      const cid = parseInput(ClientId, clientId);
      const b = parseInput(CreateInternalNoteRequest, body);
      clientOf(cid);
      const note: Note = {
        id: noteId(100 + nextN++),
        clientId: cid,
        engagementId: engagementOf(cid, b.engagementId),
        body: b.body,
        author: me,
        createdAt: now(),
      };
      notes = [note, ...notes];
      return structuredClone(note);
    },
  };
}

/** An in-memory `api.myMessages(slug)` for the signed-in portal client (client 1). */
export function createMyMessagesMock(): MyMessagesClient {
  const SIDE = 'CLIENT_TO_FIRM';
  const threads: Thread[] = structuredClone(messageFixtures().threads).filter(
    (t) => t.clientId === firstClientId,
  );
  const versions: { id: string; body: string; savedAt: string }[] = [];
  let reminder: { remindAt: string; remindedAt: string | null } | null = null;
  const find = (id: string) => {
    const t = threads.find((x) => x.id === parseInput(MessageThreadId, id).toLowerCase());
    if (!t) throw notFound();
    return t;
  };
  const row = (t: Thread): MyMessageThread => summary(t, SIDE);
  const message = (r: Row): MyMessage => ({
    id: r.id,
    direction: r.direction,
    fromMe: r.sender.userId === myLogin.userId,
    senderName: r.sender.name,
    body: r.body,
    readAt: r.readAt,
    createdAt: r.createdAt,
    attachments: attachmentsOf(r),
  });
  const detail = (t: Thread) =>
    MyMessageThreadDetail.parse({ ...row(t), messages: t.messages.map(message) });
  const add = (t: Thread, body: string, ids?: string[]) => {
    const r = msg(SIDE, body, now(), { attachmentIds: attachments(t.clientId, ids) });
    t.messages.push(r);
    return r;
  };
  const notepad = () =>
    MyNotepad.parse({ note: versions.at(-1) ?? null, reminder: structuredClone(reminder) });
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListMyMessageThreadsQuery, query);
      const rows = threads.filter((t) => matches(t, SIDE, q)).sort(newestFirst);
      const { items, nextCursor } = page(rows, q.cursor, q.limit);
      return { items: items.map(row), nextCursor };
    },
    unreadCount: async () => {
      await mockDelay();
      return unread(threads, SIDE);
    },
    get: async (id) => {
      await mockDelay();
      return detail(find(id));
    },
    start: async (body) => {
      await mockDelay();
      const b = parseInput(StartMyMessageThreadRequest, body);
      const t: Thread = {
        id: threadId(100 + nextN++),
        clientId: firstClientId,
        engagementId: null,
        subject: b.subject,
        repliesEnabled: true,
        createdAt: now(),
        messages: [],
      };
      add(t, b.body, b.attachmentDocumentIds);
      threads.push(t);
      return detail(t);
    },
    reply: async (id, body) => {
      await mockDelay();
      const b = parseInput(SendMessageRequest, body);
      const t = find(id);
      if (!t.repliesEnabled) {
        throw fail(409, 'REPLIES_DISABLED', 'Replies are closed on this conversation');
      }
      return message(add(t, b.body, b.attachmentDocumentIds));
    },
    markRead: async (id) => {
      await mockDelay();
      const t = find(id);
      markRead(t, SIDE);
      return row(t);
    },
    markUnread: async (id) => {
      await mockDelay();
      const t = find(id);
      markUnread(t, SIDE);
      return row(t);
    },
    notepad: async () => {
      await mockDelay();
      return notepad();
    },
    saveNote: async (body) => {
      await mockDelay();
      const b = parseInput(SaveMyNoteRequest, body);
      versions.push({ id: noteId(100 + nextN++), body: b.body, savedAt: now() });
      if (b.remindAt !== undefined) {
        reminder = b.remindAt === null ? null : { remindAt: b.remindAt, remindedAt: null };
      } else if (reminder?.remindedAt) {
        reminder = null;
      }
      return notepad();
    },
    setReminder: async (body) => {
      await mockDelay();
      const b = parseInput(SetMyNoteReminderRequest, body);
      if (versions.length === 0) throw fail(409, 'NOTE_REQUIRED', 'Save a note first');
      reminder = b.remindAt === null ? null : { remindAt: b.remindAt, remindedAt: null };
      return notepad();
    },
  };
}

let myMocks: Map<string, MyMessagesClient> | undefined;

/** `api.myMessages(slug)` in mock mode: one per firm slug, made on first use. */
export function myMessagesMock(firmSlug: string): MyMessagesClient {
  myMocks ??= new Map();
  const slug = firmSlug.toLowerCase();
  const found = myMocks.get(slug) ?? createMyMessagesMock();
  myMocks.set(slug, found);
  return found;
}
