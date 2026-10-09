import {
  ApiRequestError,
  ClientId,
  type ClientNotesClient,
  CreateInternalNoteRequest,
  CreateMessageThreadRequest,
  CreateMyMessageThreadRequest,
  InternalNote,
  InternalNoteId,
  ListInternalNotesQuery,
  ListMessageThreadsQuery,
  ListMyMessagesQuery,
  type Message,
  type MessageSender,
  type MessagesClient,
  MessageThreadId,
  type MessageThread,
  type MessageThreadDetail,
  type MyMessage,
  type MyMessageFrom,
  type MyMessagesClient,
  type MyMessageThread,
  type MyMessageThreadDetail,
  type MyNote,
  type MyNotesClient,
  parseInput,
  SaveMyNoteRequest,
  SendMessageRequest,
  SetNoteReminderRequest,
  UpdateInternalNoteRequest,
  UpdateMessageThreadRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { firstClientId, type MockFirmRole, mockStaff } from './clients';
import { BOOKKEEPING_ENGAGEMENT } from './tasks';

/**
 * Mock data for `api.messages`, `api.clientNotes`, `api.myMessages(slug)` and `api.myNotes(slug)`
 * (R20). Synthetic data only. One shared store, so a message sent on the firm site shows in the
 * portal in the same mock session. Same checks and error codes as the API. `role: 'STAFF'` is Sam
 * Staff: he reaches only his clients (1 and 2), as in mocks/clients.ts. The portal client is
 * client 1, Jamie Sample, signed in as their PRIMARY login; Casey Sample is the spouse's login.
 */
const CLIENTS = {
  [firstClientId]: 'Jamie Sample',
  '0199b6a1-0000-7000-8000-000000000002': 'Acme Widgets LLC (fake)',
  '0199b6a1-0000-7000-8000-000000000003': 'Riley Example',
} as const;
const STAFF_CLIENTS: readonly string[] = [firstClientId, '0199b6a1-0000-7000-8000-000000000002'];
const ARCHIVED: readonly string[] = ['0199b6a1-0000-7000-8000-000000000004'];
const JAMIE = { userId: '0199b6a3-0000-7000-8000-000000000001', name: 'Jamie Sample' };
const CASEY = { userId: '0199b6a3-0000-7000-8000-000000000002', name: 'Casey Sample' };
const RILEY = { userId: '0199b6a3-0000-7000-8000-000000000003', name: 'Riley Example' };
const staff = (m: { userId: string; name: string }): MessageSender => ({ kind: 'STAFF', ...m });
const client = (m: { userId: string; name: string }): MessageSender => ({ kind: 'CLIENT', ...m });

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const id = (prefix: string, n: number) => `${prefix}-0000-7000-8000-${String(n).padStart(12, '0')}`;
const now = () => new Date().toISOString();

interface ThreadRow {
  id: string;
  clientId: string;
  engagementId: string | null;
  subject: string;
  related: MessageThread['related'];
  repliesEnabled: boolean;
  createdAt: string;
}
interface Store {
  threads: ThreadRow[];
  messages: Message[];
  notes: InternalNote[];
  myNotes: Map<string, MyNote>;
  seq: number;
}

let store: Store | undefined;

function seed(): Store {
  const threads: ThreadRow[] = [];
  const messages: Message[] = [];
  let n = 0;
  const thread = (
    clientId: string,
    subject: string,
    posts: [MessageSender, string, string, boolean][],
    extra: Partial<ThreadRow> = {},
  ) => {
    const t: ThreadRow = {
      id: id('0199b6e1', threads.length + 1),
      clientId,
      engagementId: null,
      subject,
      related: null,
      repliesEnabled: true,
      createdAt: posts[0]?.[2] ?? now(),
      ...extra,
    };
    threads.push(t);
    for (const [sender, body, at, read] of posts) {
      n += 1;
      messages.push({
        id: id('0199b6e2', n),
        threadId: t.id,
        direction: sender.kind === 'STAFF' ? 'FIRM_TO_CLIENT' : 'CLIENT_TO_FIRM',
        sender,
        body,
        readAt: read ? at : null,
        createdAt: at,
      });
    }
  };
  thread(firstClientId, 'Welcome to LVP!', [
    [
      staff(mockMe),
      'Welcome to the portal. Send us a message here any time.',
      '2026-09-20T14:00:00.000Z',
      false,
    ],
  ]);
  thread(firstClientId, 'Follow Up', [
    [
      client(JAMIE),
      'Following up on our call: is anything else needed from me?',
      '2026-09-28T10:00:00.000Z',
      true,
    ],
    [staff(mockStaff), 'Nothing else for now, thank you.', '2026-09-28T15:30:00.000Z', true],
  ]);
  thread(
    firstClientId,
    'Document Request',
    [
      [
        staff(mockStaff),
        'Please upload your 2025 bank statements (sample).',
        '2026-10-02T09:00:00.000Z',
        false,
      ],
    ],
    {
      engagementId: BOOKKEEPING_ENGAGEMENT,
      related: { type: 'document_request', id: id('0199b6c1', 1) },
      repliesEnabled: false,
    },
  );
  thread(firstClientId, 'Question About Deduction', [
    [
      client(CASEY),
      'Can the home office count as a deduction? (synthetic)',
      '2026-10-05T18:10:00.000Z',
      false,
    ],
  ]);
  thread(firstClientId, 'Tax Return Update', [
    [
      staff(mockMe),
      'Your return is in review. We will be in touch.',
      '2026-10-07T13:00:00.000Z',
      false,
    ],
  ]);
  thread('0199b6a1-0000-7000-8000-000000000003', 'Engagement letter', [
    [client(RILEY), 'I signed the letter. What happens next?', '2026-10-06T08:00:00.000Z', false],
  ]);
  const notes: InternalNote[] = [
    InternalNote.parse({
      id: id('0199b6e3', 1),
      clientId: firstClientId,
      engagementId: BOOKKEEPING_ENGAGEMENT,
      body: 'Prefers calls after 3 pm. Bank statements arrive monthly (sample note).',
      author: mockStaff,
      canEdit: true,
      createdAt: '2026-10-03T12:00:00.000Z',
      updatedAt: '2026-10-03T12:00:00.000Z',
    }),
  ];
  const myNotes = new Map<string, MyNote>([
    [
      JAMIE.userId,
      {
        body: 'Remember to gather my 1099 forms.\nAsk about retirement contribution options.',
        savedAt: '2026-10-06T20:00:00.000Z',
        reminder: { remindAt: '2027-01-20T14:00:00.000Z', sentAt: null },
      },
    ],
  ]);
  return { threads, messages, notes, myNotes, seq: 1000 };
}

const s = () => (store ??= seed());
const next = () => (s().seq += 1);
const inThread = (threadId: string) => s().messages.filter((m) => m.threadId === threadId);
const matches = (t: ThreadRow, search?: string) => {
  if (!search) return true;
  const q = search.toLowerCase();
  return (
    t.subject.toLowerCase().includes(q) ||
    inThread(t.id).some((m) => m.body.toLowerCase().includes(q))
  );
};
const lastAt = (t: ThreadRow) => inThread(t.id).at(-1)?.createdAt ?? t.createdAt;
const newestFirst = (a: ThreadRow, b: ThreadRow) => lastAt(b).localeCompare(lastAt(a));
/** Cursor = the number of rows already shown. */
function page<T>(rows: T[], cursor: string | undefined, limit: number) {
  const start = cursor ? Number(cursor) || 0 : 0;
  const items = rows.slice(start, start + limit);
  return { items, nextCursor: start + limit < rows.length ? String(start + limit) : null };
}
const addMessage = (t: ThreadRow, sender: MessageSender, body: string): Message => {
  const m: Message = {
    id: id('0199b6e2', next()),
    threadId: t.id,
    direction: sender.kind === 'STAFF' ? 'FIRM_TO_CLIENT' : 'CLIENT_TO_FIRM',
    sender,
    body,
    readAt: null,
    createdAt: now(),
  };
  s().messages.push(m);
  return m;
};
/** Marks the receiving side's messages read (`read`), or the latest one unread. */
function mark(t: ThreadRow, inbound: Message['direction'], read: boolean) {
  const theirs = inThread(t.id).filter((m) => m.direction === inbound);
  if (read) {
    for (const m of theirs) m.readAt ??= now();
    return;
  }
  const last = theirs.at(-1);
  if (!last) throw fail(409, 'NOTHING_TO_MARK', 'There is no message to mark unread');
  last.readAt = null;
}

// ----- Firm side -----

function firmThread(t: ThreadRow): MessageThread {
  const msgs = inThread(t.id);
  const first = msgs[0];
  const last = msgs.at(-1);
  return {
    id: t.id,
    client: {
      id: t.clientId,
      displayName: CLIENTS[t.clientId as keyof typeof CLIENTS] ?? 'Client',
    },
    engagementId: t.engagementId,
    subject: t.subject,
    related: t.related,
    repliesEnabled: t.repliesEnabled,
    startedBy: first ? { ...first.sender } : null,
    lastMessage: last
      ? {
          direction: last.direction,
          senderName: last.sender.name,
          excerpt: last.body.replace(/\s+/g, ' ').slice(0, 140),
          createdAt: last.createdAt,
        }
      : null,
    unreadCount: msgs.filter((m) => m.direction === 'CLIENT_TO_FIRM' && !m.readAt).length,
    createdAt: t.createdAt,
  };
}

/** An in-memory `api.messages`. */
export function createMessagesMock(options: { role?: MockFirmRole } = {}): MessagesClient {
  const role = options.role ?? 'OWNER';
  const me = role === 'STAFF' ? mockStaff : mockMe;
  const reaches = (clientId: string) =>
    clientId in CLIENTS || ARCHIVED.includes(clientId)
      ? role !== 'STAFF' || STAFF_CLIENTS.includes(clientId)
      : false;
  const visible = () => s().threads.filter((t) => reaches(t.clientId));
  const find = (threadId: string) => {
    const t = visible().find((x) => x.id === parseInput(MessageThreadId, threadId));
    if (!t) throw notFound();
    return t;
  };
  const detail = (t: ThreadRow): MessageThreadDetail => ({
    ...firmThread(t),
    messages: inThread(t.id).map((m) => ({ ...m, sender: { ...m.sender } })),
  });
  const list = (rows: ThreadRow[], query: ListMessageThreadsQuery) => {
    const q = parseInput(ListMessageThreadsQuery, query);
    const kept = rows
      .filter((t) => matches(t, q.search))
      .map(firmThread)
      .filter((t) => !q.unread || t.unreadCount > 0);
    kept.sort((a, b) =>
      (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(
        a.lastMessage?.createdAt ?? a.createdAt,
      ),
    );
    return page(kept, q.cursor, q.limit);
  };
  return {
    inbox: async (query = {}) => (await mockDelay(), list(visible(), query)),
    listForClient: async (clientId, query = {}) => {
      await mockDelay();
      const cid = parseInput(ClientId, clientId);
      if (!reaches(cid)) throw notFound();
      return list(
        visible().filter((t) => t.clientId === cid),
        query,
      );
    },
    get: async (threadId) => (await mockDelay(), detail(find(threadId))),
    create: async (clientId, body) => {
      await mockDelay();
      const cid = parseInput(ClientId, clientId);
      const b = parseInput(CreateMessageThreadRequest, body);
      if (!reaches(cid)) throw notFound();
      if (ARCHIVED.includes(cid)) throw fail(409, 'CLIENT_ARCHIVED', 'The client is archived');
      const t: ThreadRow = {
        id: id('0199b6e1', next()),
        clientId: cid,
        engagementId: b.engagementId ?? null,
        subject: b.subject,
        related: b.related ?? null,
        repliesEnabled: b.repliesEnabled ?? true,
        createdAt: now(),
      };
      s().threads.push(t);
      addMessage(t, staff(me), b.body);
      return detail(t);
    },
    send: async (threadId, body) => {
      await mockDelay();
      const t = find(threadId);
      return addMessage(t, staff(me), parseInput(SendMessageRequest, body).body);
    },
    update: async (threadId, body) => {
      await mockDelay();
      const t = find(threadId);
      t.repliesEnabled = parseInput(UpdateMessageThreadRequest, body).repliesEnabled;
      return firmThread(t);
    },
    markRead: async (threadId) => {
      await mockDelay();
      const t = find(threadId);
      mark(t, 'CLIENT_TO_FIRM', true);
      return firmThread(t);
    },
    markUnread: async (threadId) => {
      await mockDelay();
      const t = find(threadId);
      mark(t, 'CLIENT_TO_FIRM', false);
      return firmThread(t);
    },
    unreadCount: async () => {
      await mockDelay();
      const byClient = new Map<string, number>();
      for (const t of visible()) {
        const c = firmThread(t).unreadCount;
        if (c > 0) byClient.set(t.clientId, (byClient.get(t.clientId) ?? 0) + c);
      }
      const items = [...byClient].map(([clientId, count]) => ({ clientId, count }));
      return { total: items.reduce((sum, x) => sum + x.count, 0), byClient: items };
    },
  };
}

/** An in-memory `api.clientNotes`. */
export function createClientNotesMock(options: { role?: MockFirmRole } = {}): ClientNotesClient {
  const role = options.role ?? 'OWNER';
  const me = role === 'STAFF' ? mockStaff : mockMe;
  const reaches = (clientId: string) =>
    (clientId in CLIENTS || ARCHIVED.includes(clientId)) &&
    (role !== 'STAFF' || STAFF_CLIENTS.includes(clientId));
  const view = (n: InternalNote): InternalNote => ({
    ...n,
    author: { ...n.author },
    canEdit: role !== 'STAFF' || n.author.userId === me.userId,
  });
  const find = (noteId: string) => {
    const n = s().notes.find((x) => x.id === parseInput(InternalNoteId, noteId));
    if (!n || !reaches(n.clientId)) throw notFound();
    if (!view(n).canEdit) throw fail(403, 'FORBIDDEN', 'This action is not permitted');
    return n;
  };
  return {
    list: async (clientId, query = {}) => {
      await mockDelay();
      const cid = parseInput(ClientId, clientId);
      const q = parseInput(ListInternalNotesQuery, query);
      if (!reaches(cid)) throw notFound();
      return s()
        .notes.filter(
          (n) => n.clientId === cid && (!q.engagementId || n.engagementId === q.engagementId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(view);
    },
    create: async (clientId, body) => {
      await mockDelay();
      const cid = parseInput(ClientId, clientId);
      const b = parseInput(CreateInternalNoteRequest, body);
      if (!reaches(cid)) throw notFound();
      const at = now();
      const n: InternalNote = {
        id: id('0199b6e3', next()),
        clientId: cid,
        engagementId: b.engagementId ?? null,
        body: b.body,
        author: { ...me },
        canEdit: true,
        createdAt: at,
        updatedAt: at,
      };
      s().notes.push(n);
      return view(n);
    },
    update: async (noteId, body) => {
      await mockDelay();
      const b = parseInput(UpdateInternalNoteRequest, body);
      const n = find(noteId);
      n.body = b.body;
      n.updatedAt = now();
      return view(n);
    },
    remove: async (noteId) => {
      await mockDelay();
      const n = find(noteId);
      s().notes = s().notes.filter((x) => x !== n);
      return { ok: true };
    },
  };
}

// ----- Portal side (client 1, Jamie's PRIMARY login) -----

const fromOf = (m: Message): { from: MyMessageFrom; senderName: string | null } =>
  m.sender.kind === 'STAFF'
    ? { from: 'FIRM', senderName: null }
    : m.sender.userId === JAMIE.userId
      ? { from: 'ME', senderName: null }
      : { from: 'HOUSEHOLD', senderName: m.sender.name };
const toMine = (m: Message): MyMessage => ({
  id: m.id,
  ...fromOf(m),
  body: m.body,
  unread: m.direction === 'FIRM_TO_CLIENT' && !m.readAt,
  createdAt: m.createdAt,
});
function myThread(t: ThreadRow): MyMessageThread {
  const msgs = inThread(t.id);
  const first = msgs[0];
  return {
    id: t.id,
    subject: t.subject,
    ...(first ? fromOf(first) : { from: 'FIRM' as const, senderName: null }),
    related: t.related,
    repliesEnabled: t.repliesEnabled,
    unreadCount: msgs.filter((m) => m.direction === 'FIRM_TO_CLIENT' && !m.readAt).length,
    lastMessageAt: lastAt(t),
    createdAt: t.createdAt,
  };
}

/** An in-memory `api.myMessages(slug)`. */
export function createMyMessagesMock(): MyMessagesClient {
  const mine = () => s().threads.filter((t) => t.clientId === firstClientId);
  const find = (threadId: string) => {
    const t = mine().find((x) => x.id === parseInput(MessageThreadId, threadId));
    if (!t) throw notFound();
    return t;
  };
  const detail = (t: ThreadRow): MyMessageThreadDetail => ({
    ...myThread(t),
    messages: inThread(t.id).map(toMine),
  });
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListMyMessagesQuery, query);
      const rows = mine()
        .filter((t) => matches(t, q.search))
        .sort(newestFirst)
        .map(myThread)
        .filter(
          (t) =>
            q.filter === 'all' || (q.filter === 'from-firm' ? t.from === 'FIRM' : t.from === 'ME'),
        );
      return page(rows, q.cursor, q.limit);
    },
    get: async (threadId) => (await mockDelay(), detail(find(threadId))),
    create: async (body) => {
      await mockDelay();
      const b = parseInput(CreateMyMessageThreadRequest, body);
      const t: ThreadRow = {
        id: id('0199b6e1', next()),
        clientId: firstClientId,
        engagementId: null,
        subject: b.subject,
        related: null,
        repliesEnabled: true,
        createdAt: now(),
      };
      s().threads.push(t);
      addMessage(t, client(JAMIE), b.body);
      return detail(t);
    },
    reply: async (threadId, body) => {
      await mockDelay();
      const b = parseInput(SendMessageRequest, body);
      const t = find(threadId);
      if (!t.repliesEnabled) throw fail(409, 'REPLIES_CLOSED', 'Replies are closed on this thread');
      return toMine(addMessage(t, client(JAMIE), b.body));
    },
    markRead: async (threadId) => {
      await mockDelay();
      const t = find(threadId);
      mark(t, 'FIRM_TO_CLIENT', true);
      return myThread(t);
    },
    markUnread: async (threadId) => {
      await mockDelay();
      const t = find(threadId);
      mark(t, 'FIRM_TO_CLIENT', false);
      return myThread(t);
    },
    unreadCount: async () => {
      await mockDelay();
      return { count: mine().reduce((sum, t) => sum + myThread(t).unreadCount, 0) };
    },
  };
}

/** An in-memory `api.myNotes(slug)` for Jamie's own login. */
export function createMyNotesMock(): MyNotesClient {
  const get = () => {
    const n = s().myNotes.get(JAMIE.userId);
    return { note: n ? { ...n, reminder: n.reminder && { ...n.reminder } } : null };
  };
  return {
    get: async () => (await mockDelay(), get()),
    save: async (body) => {
      await mockDelay();
      const b = parseInput(SaveMyNoteRequest, body);
      const before = s().myNotes.get(JAMIE.userId)?.reminder ?? null;
      // Only an unsent reminder still in the future moves to the new version, unsent.
      const pending =
        before && !before.sentAt && Date.parse(before.remindAt) > Date.now()
          ? { remindAt: before.remindAt, sentAt: null }
          : null;
      const reminder =
        b.remindAt === undefined
          ? pending
          : b.remindAt === null
            ? null
            : { remindAt: b.remindAt, sentAt: null };
      s().myNotes.set(JAMIE.userId, { body: b.body, savedAt: now(), reminder });
      return get();
    },
    setReminder: async (body) => {
      await mockDelay();
      const b = parseInput(SetNoteReminderRequest, body);
      const n = s().myNotes.get(JAMIE.userId);
      if (!n) throw notFound();
      n.reminder = { remindAt: b.remindAt, sentAt: null };
      return get();
    },
    removeReminder: async () => {
      await mockDelay();
      const n = s().myNotes.get(JAMIE.userId);
      if (n) n.reminder = null;
      return get();
    },
  };
}

let myMessagesMocks: Map<string, MyMessagesClient> | undefined;
let myNotesMocks: Map<string, MyNotesClient> | undefined;

/** `api.myMessages(slug)` in mock mode: one mock per firm. */
export function myMessagesMock(firmSlug: string): MyMessagesClient {
  myMessagesMocks ??= new Map();
  const slug = firmSlug.toLowerCase();
  let mock = myMessagesMocks.get(slug);
  if (!mock) myMessagesMocks.set(slug, (mock = createMyMessagesMock()));
  return mock;
}

/** `api.myNotes(slug)` in mock mode: one mock per firm. */
export function myNotesMock(firmSlug: string): MyNotesClient {
  myNotesMocks ??= new Map();
  const slug = firmSlug.toLowerCase();
  let mock = myNotesMocks.get(slug);
  if (!mock) myNotesMocks.set(slug, (mock = createMyNotesMock()));
  return mock;
}
