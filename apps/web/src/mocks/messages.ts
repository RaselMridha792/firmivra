import {
  ApiRequestError,
  CancelOutboundRequest,
  CheckOutboundRequest,
  ListOutboundQuery,
  type OutboundCheck,
  type OutboundExclusion,
  type OutboundMessage,
  type OutboundMessageList,
  type OutboundReview,
  SaveOutboundRequest,
  ScheduleOutboundRequest,
  SendOutboundRequest,
  UpdateOutboundRequest,
  ClientId,
  type ClientNotesClient,
  CreateInternalNoteRequest,
  CreateMessageThreadRequest,
  CreateMyMessageThreadRequest,
  InternalNote,
  InternalNoteId,
  ListInternalNotesQuery,
  MESSAGE_SETTINGS_DEFAULTS,
  type MessageSettings,
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
  SendFirmMessageRequest,
  SendMessageRequest,
  type DocumentsClient,
  type MessageAttachment,
  SetNoteReminderRequest,
  UpdateInternalNoteRequest,
  UpdateMessageSettingsRequest,
  UpdateMessageThreadRequest,
  type LeadMessage,
  type LeadMessageThread,
  type LeadMessageThreadDetail,
  type LeadThreadContact,
  ListLeadMessageThreadsQuery,
  SendLeadMessageRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import {
  clientFixtures,
  createClientsMock,
  firstClientId,
  type MockFirmRole,
  mockStaff,
} from './clients';
import { createLeadPipelineMock } from './leads-pipeline';
import { BOOKKEEPING_ENGAGEMENT } from './tasks';
import { teamFixtures } from './team';

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
  automated: boolean;
  archivedAt: string | null;
  createdAt: string;
}
/** A lead's own thread (MSG-F03's Leads tab): the firm's emails and texts to the lead. */
interface LeadThreadRow {
  id: string;
  lead: LeadThreadContact;
  subject: string;
  startedBy: MessageSender;
  archivedAt: string | null;
  createdAt: string;
}
interface Store {
  settings?: MessageSettings;
  threads: ThreadRow[];
  messages: Message[];
  leadThreads: LeadThreadRow[];
  leadMessages: LeadMessage[];
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
      automated: false,
      archivedAt: null,
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
        attachments: [],
        createdAt: at,
      });
    }
  };
  // The new-client automation's Send client message opened it (the Automations view).
  thread(
    firstClientId,
    'Welcome to LVP!',
    [
      [
        staff(mockMe),
        'Welcome to the portal. Send us a message here any time.',
        '2026-09-20T14:00:00.000Z',
        false,
      ],
    ],
    { automated: true },
  );
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
  // Archived: out of the active inbox, its history kept (the Archived view).
  thread(
    '0199b6a1-0000-7000-8000-000000000003',
    '2024 Organizer',
    [
      [
        staff(mockStaff),
        'Your 2024 organizer is attached (sample).',
        '2025-02-01T15:00:00.000Z',
        true,
      ],
      [client(RILEY), 'Thanks, all done.', '2025-02-03T09:00:00.000Z', true],
    ],
    { archivedAt: '2025-03-01T12:00:00.000Z' },
  );
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
  // No lead conversation until New Message emails or texts a lead (the Leads tab).
  return { threads, messages, leadThreads: [], leadMessages: [], notes, myNotes, seq: 1000 };
}

const s = () => (store ??= seed());
const next = () => (s().seq += 1);
const inThread = (threadId: string) => s().messages.filter((m) => m.threadId === threadId);
const digitsOf = (v: string) => v.replace(/\D/g, '');
/** A full phone number in any format, as the API reads it: 7 to 15 digits, else null. */
const phoneDigits = (search: string) => {
  const d = digitsOf(search);
  return /^[+\d\s().-]+$/.test(search) && d.length >= 7 && d.length <= 15 ? d : null;
};
/** The subject and text; on the firm side also the client's name, email and phone (MSG-F01). */
const matches = (t: ThreadRow, search?: string, firm = false) => {
  if (!search) return true;
  const q = search.toLowerCase();
  if (
    t.subject.toLowerCase().includes(q) ||
    inThread(t.id).some((m) => m.body.toLowerCase().includes(q))
  )
    return true;
  if (!firm) return false;
  const c = clientFixtures().find((x) => x.id === t.clientId);
  if (!c) return false;
  if (c.displayName.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)) return true;
  const d = phoneDigits(search);
  const p = c.phone ? digitsOf(c.phone) : '';
  if (!d || !p) return false;
  return d.length >= 10 ? p.slice(-10) === d.slice(-10) : p.includes(d);
};
const lastAt = (t: ThreadRow) => inThread(t.id).at(-1)?.createdAt ?? t.createdAt;
const newestFirst = (a: ThreadRow, b: ThreadRow) => lastAt(b).localeCompare(lastAt(a));
/** Cursor = the number of rows already shown. */
function page<T>(rows: T[], cursor: string | undefined, limit: number) {
  const start = cursor ? Number(cursor) || 0 : 0;
  const items = rows.slice(start, start + limit);
  return { items, nextCursor: start + limit < rows.length ? String(start + limit) : null };
}
const addMessage = (
  t: ThreadRow,
  sender: MessageSender,
  body: string,
  attachments: MessageAttachment[] = [],
): Message => {
  const m: Message = {
    id: id('0199b6e2', next()),
    threadId: t.id,
    direction: sender.kind === 'STAFF' ? 'FIRM_TO_CLIENT' : 'CLIENT_TO_FIRM',
    sender,
    body,
    readAt: null,
    attachments,
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
    automated: t.automated,
    archivedAt: t.archivedAt,
    createdAt: t.createdAt,
  };
}

// ----- New Message (R60, MSG-F09, F10, F14): drafts, schedules and sends -----

interface OutboundRow {
  id: string;
  status: OutboundMessage['status'];
  channel: OutboundMessage['channel'];
  subject: string | null;
  body: string;
  templateId: string | null;
  scheduledFor: string | null;
  clientIds: string[];
  leadIds: string[];
  /** After the send: what happened to each person. */
  results: Map<
    string,
    { status: 'SENT' | 'SKIPPED'; reason: OutboundExclusion | null; threadId: string | null }
  >;
  createdBy: { userId: string; name: string };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
}
const outboundRows: OutboundRow[] = [];
/** A version that always moves forward, even within the same millisecond. */
let lastStamp = 0;
const stamp = () => {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
};

interface MockPerson {
  kind: 'CLIENT' | 'LEAD';
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  archived: boolean;
  portal: boolean;
}

/** The API's rules: portal needs a login; email an address and (for a client) the portal; texts reach leads only and are off by default. */
function mockExclusion(
  p: MockPerson,
  channel: OutboundMessage['channel'],
): OutboundExclusion | null {
  if (p.archived) return 'NOT_PERMITTED';
  if (channel === 'PORTAL') return p.portal ? null : 'NO_PORTAL_ACCESS';
  if (channel === 'EMAIL') {
    if (!p.email) return 'NO_CONTACT';
    return p.kind === 'CLIENT' && !p.portal ? 'NO_PORTAL_ACCESS' : null;
  }
  return 'PROVIDER_UNAVAILABLE';
}

/** The lead's active thread with this subject, or a new one, with the message; its id. */
function leadCopy(
  p: MockPerson,
  subject: string | null,
  body: string,
  channel: 'EMAIL' | 'SMS',
  sender: MessageSender,
): string {
  const title = subject?.trim() || 'A message from your firm';
  let t = s().leadThreads.find(
    (x) => x.lead.id === p.id && x.subject === title && x.archivedAt === null,
  );
  if (!t) {
    t = {
      id: id('0199b6e7', next()),
      lead: { id: p.id, displayName: p.name, email: p.email, phone: p.phone },
      subject: title,
      startedBy: sender,
      archivedAt: null,
      createdAt: now(),
    };
    s().leadThreads.push(t);
  }
  s().leadMessages.push({
    id: id('0199b6e8', next()),
    threadId: t.id,
    sender,
    body,
    channel,
    status: 'SENT',
    createdAt: now(),
  });
  return t.id;
}

/** An in-memory `api.messages.outbound`; nothing is sent anywhere. */
function createOutboundMock(role: MockFirmRole, me: { userId: string; name: string }) {
  const leadsMock = createLeadPipelineMock({ role });
  const clientsMock = createClientsMock({ role });
  const people = async (clientIds: string[], leadIds: string[]): Promise<MockPerson[]> => {
    const cids = [...new Set(clientIds)];
    const lids = [...new Set(leadIds)];
    const clients = await Promise.all(
      cids.map(async (id) => {
        const c = await clientsMock.get(id).catch(() => {
          throw notFound();
        });
        return {
          kind: 'CLIENT' as const,
          id,
          name: c.displayName,
          email: c.email,
          phone: c.phone,
          archived: c.archivedAt !== null,
          portal: c.portalLogins.some((l) => l.status === 'ACTIVE'),
        };
      }),
    );
    const rows = lids.length ? (await leadsMock.list({ pageSize: 100 })).items : [];
    const leads = lids.map((id) => {
      const l = rows.find((x) => x.id === id);
      if (!l) throw notFound();
      return {
        kind: 'LEAD' as const,
        id,
        name: `${l.firstName} ${l.lastName}`.trim(),
        email: l.email,
        phone: l.phone,
        archived: false,
        portal: false,
      };
    });
    return [...clients, ...leads];
  };
  const shape = async (r: OutboundRow): Promise<OutboundMessage> => {
    const editable = r.status === 'DRAFT' || r.status === 'SCHEDULED';
    const found = await people(r.clientIds, r.leadIds);
    const recipients = found.map((p) => {
      const result = r.results.get(p.id);
      const reason = result ? result.reason : mockExclusion(p, r.channel);
      return {
        kind: p.kind,
        id: p.id,
        name: p.name,
        canReceive: result ? result.status === 'SENT' : !reason,
        reason,
        status: result?.status ?? ('QUEUED' as const),
        threadId: result?.threadId ?? null,
      };
    });
    const can = recipients.filter((x) => x.canReceive).length;
    return {
      id: r.id,
      status: r.status,
      channel: r.channel,
      subject: r.subject,
      body: r.body,
      templateId: r.templateId,
      scheduledFor: r.status === 'SCHEDULED' ? r.scheduledFor : null,
      timezone: 'America/New_York',
      recipients,
      counts: { total: recipients.length, canReceive: can, cannotReceive: recipients.length - can },
      createdBy: { ...r.createdBy },
      editable,
      completedAt: r.completedAt,
      canceledAt: r.canceledAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  };
  const find = (id: string) => {
    const r = outboundRows.find(
      (x) => x.id === id && (role !== 'STAFF' || x.createdBy.userId === me.userId),
    );
    if (!r) throw notFound();
    return r;
  };
  const editable = (r: OutboundRow, version: string) => {
    if (r.status !== 'DRAFT' && r.status !== 'SCHEDULED')
      throw fail(409, 'NOT_EDITABLE', 'This message was already sent or canceled.');
    if (r.updatedAt !== version)
      throw fail(409, 'STALE_VERSION', 'This message changed since you opened it.');
  };
  const ready = async (r: OutboundRow) => {
    if (r.channel === 'EMAIL' && !r.subject?.trim())
      throw fail(400, 'SUBJECT_REQUIRED', 'An email needs a subject');
    if ((await shape(r)).counts.canReceive === 0)
      throw fail(409, 'NO_RECIPIENTS', 'Nobody you chose can receive it on this channel.');
  };
  /** The merge fields each person gets, as the API fills them (MSG-F15). */
  const fillFor = (p: MockPerson, text: string) => {
    const [first = '', ...rest] = p.name.split(' ');
    const values = new Map<string, string>([
      ['client first name', first],
      ['client last name', rest.join(' ')],
      ['client full name', p.name],
      ['business name', 'LVP Accounting & Taxes'],
      ['staff name', me.name],
      ...(p.email ? ([['email address', p.email]] as [string, string][]) : []),
    ]);
    const unresolved = new Set<string>();
    const filled = text.replace(/\[([^\]]+)\]/g, (token, name: string) => {
      const v = values.get(name.trim().toLowerCase());
      if (!v) unresolved.add(name.trim());
      return v ?? token;
    });
    return { text: filled, unresolved: [...unresolved] };
  };
  const unresolvedOf = async (r: OutboundRow) => {
    const out = new Set<string>();
    for (const p of await people(r.clientIds, r.leadIds)) {
      if (mockExclusion(p, r.channel)) continue;
      for (const u of fillFor(p, `${r.subject ?? ''} ${r.body}`).unresolved) out.add(u);
    }
    return [...out];
  };
  const confirmed = async (r: OutboundRow, confirm: boolean | undefined) => {
    if (!confirm && (await unresolvedOf(r)).length > 0)
      throw fail(409, 'UNRESOLVED_FIELDS', 'Some merge fields cannot be filled.');
  };
  const insert = async (b: {
    channel: OutboundMessage['channel'];
    subject?: string | null;
    body: string;
    templateId?: string | null;
    clientIds: string[];
    leadIds: string[];
  }): Promise<OutboundRow> => {
    await people(b.clientIds, b.leadIds);
    const at = stamp();
    const r: OutboundRow = {
      id: id('0199b6e4', next()),
      status: 'DRAFT',
      channel: b.channel,
      subject: b.subject ?? null,
      body: b.body,
      templateId: b.templateId ?? null,
      scheduledFor: null,
      clientIds: [...new Set(b.clientIds)],
      leadIds: [...new Set(b.leadIds)],
      results: new Map(),
      createdBy: { ...me },
      createdAt: at,
      updatedAt: at,
      completedAt: null,
      canceledAt: null,
    };
    outboundRows.push(r);
    return r;
  };
  return {
    check: async (body: CheckOutboundRequest): Promise<OutboundCheck> => {
      await mockDelay();
      const b = parseInput(CheckOutboundRequest, body);
      return {
        recipients: (await people(b.clientIds, b.leadIds)).map((p) => {
          const reason = mockExclusion(p, b.channel);
          return {
            kind: p.kind,
            id: p.id,
            name: p.name,
            canReceive: !reason,
            reason,
            status: null,
            threadId: null,
          };
        }),
        channels: [
          { channel: 'PORTAL', unavailable: null },
          { channel: 'EMAIL', unavailable: null },
          { channel: 'SMS', unavailable: 'TURNED_OFF' },
        ],
      };
    },
    list: async (query: ListOutboundQuery = {}): Promise<OutboundMessageList> => {
      await mockDelay();
      const q = parseInput(ListOutboundQuery, query);
      const rows = outboundRows
        .filter((r) =>
          q.status ? r.status === q.status : r.status === 'DRAFT' || r.status === 'SCHEDULED',
        )
        .filter((r) => role !== 'STAFF' || r.createdBy.userId === me.userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { items: await Promise.all(rows.map(shape)) };
    },
    get: async (outboundId: string) => (await mockDelay(), shape(find(outboundId))),
    review: async (outboundId: string): Promise<OutboundReview> => {
      await mockDelay();
      const r = find(outboundId);
      const m = await shape(r);
      const found = await people(r.clientIds, r.leadIds);
      const recipients = m.recipients.map((x) => {
        const p = found.find((y) => y.id === x.id)!;
        const subject = r.subject ? fillFor(p, r.subject) : null;
        const body = fillFor(p, r.body);
        return {
          kind: x.kind,
          id: x.id,
          name: x.name,
          canReceive: x.canReceive,
          reason: x.reason,
          subject: subject?.text ?? null,
          body: body.text,
          unresolved: [...new Set([...(subject?.unresolved ?? []), ...body.unresolved])],
        };
      });
      const unresolved = await unresolvedOf(r);
      const checks: OutboundReview['checks'] = [];
      if (m.counts.canReceive === 0)
        checks.push({
          code: 'NO_RECIPIENTS',
          severity: 'BLOCK',
          message: 'Nobody you chose can receive it on this channel.',
        });
      if (m.channel === 'EMAIL' && !m.subject?.trim())
        checks.push({
          code: 'SUBJECT_REQUIRED',
          severity: 'BLOCK',
          message: 'An email needs a subject.',
        });
      if (unresolved.length > 0)
        checks.push({
          code: 'UNRESOLVED_FIELDS',
          severity: 'WARN',
          message: `Some fields cannot be filled for everyone: ${unresolved.map((u) => `[${u}]`).join(', ')}. They would go as written.`,
        });
      if (m.counts.cannotReceive > 0)
        checks.push({
          code: 'SOME_SKIPPED',
          severity: 'WARN',
          message: `${m.counts.cannotReceive} of ${m.counts.total} cannot receive it on this channel and will be skipped.`,
        });
      if (!checks.some((c) => c.severity === 'BLOCK'))
        checks.push({ code: 'READY', severity: 'OK', message: 'Ready to send.' });
      return {
        channel: m.channel,
        timing: {
          mode: m.status === 'SCHEDULED' ? 'SCHEDULED' : 'NOW',
          scheduledFor: m.scheduledFor,
          timezone: m.timezone,
        },
        recipients,
        unresolved,
        checks,
      };
    },
    create: async (body: SaveOutboundRequest) => {
      await mockDelay();
      return shape(await insert(parseInput(SaveOutboundRequest, body)));
    },
    update: async (outboundId: string, body: UpdateOutboundRequest) => {
      await mockDelay();
      const { version, ...b } = parseInput(UpdateOutboundRequest, body);
      const r = find(outboundId);
      await people(b.clientIds, b.leadIds);
      editable(r, version);
      const key = (cs: string[], ls: string[]) =>
        [...cs.map((c) => `c${c}`), ...ls.map((l) => `l${l}`)].sort().join();
      if (
        b.channel === r.channel &&
        key(r.clientIds, r.leadIds) === key([...new Set(b.clientIds)], [...new Set(b.leadIds)])
      ) {
        r.subject = b.subject ?? null;
        r.body = b.body;
        r.templateId = b.templateId ?? null;
        r.updatedAt = stamp();
        return shape(r);
      }
      const next = await insert(b);
      r.status = 'CANCELED';
      r.canceledAt = now();
      r.updatedAt = stamp();
      return shape(next);
    },
    send: async (outboundId: string, body: SendOutboundRequest) => {
      await mockDelay();
      const { version, confirmUnresolved } = parseInput(SendOutboundRequest, body);
      const r = find(outboundId);
      if (r.status === 'CANCELED') throw fail(409, 'CANCELED', 'This message was canceled.');
      if (r.status !== 'DRAFT' && r.status !== 'SCHEDULED') return shape(r);
      editable(r, version);
      await ready(r);
      await confirmed(r, confirmUnresolved);
      for (const p of await people(r.clientIds, r.leadIds)) {
        const reason = mockExclusion(p, r.channel);
        if (reason) {
          r.results.set(p.id, { status: 'SKIPPED', reason, threadId: null });
          continue;
        }
        let threadId: string | null = null;
        if (p.kind === 'CLIENT') {
          const t: ThreadRow = {
            id: id('0199b6e1', next()),
            clientId: p.id,
            engagementId: null,
            subject: r.subject?.trim() || 'A message from your firm',
            related: null,
            repliesEnabled: true,
            automated: false,
            archivedAt: null,
            createdAt: now(),
          };
          s().threads.push(t);
          addMessage(t, staff(me), fillFor(p, r.body).text);
          threadId = t.id;
        } else if (r.channel !== 'PORTAL') {
          // A lead's email or text is kept in the lead's own thread (the Leads tab).
          threadId = leadCopy(p, r.subject, fillFor(p, r.body).text, r.channel, staff(me));
        }
        r.results.set(p.id, { status: 'SENT', reason: null, threadId });
      }
      r.status = 'SENT';
      r.completedAt = now();
      r.updatedAt = stamp();
      return shape(r);
    },
    schedule: async (outboundId: string, body: ScheduleOutboundRequest) => {
      await mockDelay();
      const b = parseInput(ScheduleOutboundRequest, body);
      if (new Date(b.scheduledFor).getTime() < Date.now() + 60_000)
        throw fail(400, 'SCHEDULE_IN_PAST', 'Choose a time at least a minute from now');
      const r = find(outboundId);
      editable(r, b.version);
      await ready(r);
      await confirmed(r, b.confirmUnresolved);
      r.status = 'SCHEDULED';
      r.scheduledFor = new Date(b.scheduledFor).toISOString();
      r.updatedAt = stamp();
      return shape(r);
    },
    cancel: async (outboundId: string, body: CancelOutboundRequest) => {
      await mockDelay();
      const { version } = parseInput(CancelOutboundRequest, body);
      const r = find(outboundId);
      if (r.status === 'CANCELED') return shape(r);
      editable(r, version);
      r.status = 'CANCELED';
      r.canceledAt = now();
      r.updatedAt = stamp();
      return shape(r);
    },
  };
}

/** Messages Settings: the defaults until the first save; texts not set up in mock mode. */
const settingsOf = (): MessageSettings =>
  (s().settings ??= {
    ...MESSAGE_SETTINGS_DEFAULTS,
    allowedAttachmentTypes: [...MESSAGE_SETTINGS_DEFAULTS.allowedAttachmentTypes],
    smsReady: false,
    defaultAssignee: null,
    timezone: 'America/New_York',
    updatedAt: null,
    updatedBy: null,
  });

/** An in-memory `api.messages`. */
export function createMessagesMock(
  options: {
    role?: MockFirmRole;
    /** The app's own documents mock, so a file uploaded from the reply is found (MSG-F12). */
    documents?: Pick<DocumentsClient, 'get'>;
  } = {},
): MessagesClient {
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
      .filter((t) => (q.archived ? t.archivedAt !== null : t.archivedAt === null))
      .filter((t) => matches(t, q.search, true))
      .map(firmThread)
      .filter((t) => !q.unread || t.unreadCount > 0);
    kept.sort((a, b) =>
      (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(
        a.lastMessage?.createdAt ?? a.createdAt,
      ),
    );
    return page(kept, q.cursor, q.limit);
  };
  const outbound = createOutboundMock(role, me);
  // Conversations with leads: the leads the role reaches in mocks/leads-pipeline.ts.
  const leadsMock = createLeadPipelineMock({ role });
  const leadReach = async () =>
    new Set((await leadsMock.list({ pageSize: 100 })).items.map((l) => l.id));
  const leadMessagesOf = (threadId: string) =>
    s().leadMessages.filter((m) => m.threadId === threadId);
  const leadThread = (t: LeadThreadRow): LeadMessageThread => {
    const last = leadMessagesOf(t.id).at(-1);
    return {
      id: t.id,
      lead: { ...t.lead },
      subject: t.subject,
      startedBy: { ...t.startedBy },
      lastMessage: last
        ? {
            direction: 'FIRM_TO_CLIENT',
            senderName: last.sender.name,
            excerpt: last.body.replace(/\s+/g, ' ').trim().slice(0, 140),
            createdAt: last.createdAt,
          }
        : null,
      archivedAt: t.archivedAt,
      createdAt: t.createdAt,
    };
  };
  const findLead = async (threadId: string) => {
    const reach = await leadReach();
    const t = s().leadThreads.find(
      (x) => x.id === parseInput(MessageThreadId, threadId) && reach.has(x.lead.id),
    );
    if (!t) throw notFound();
    return t;
  };
  const leadDetail = (t: LeadThreadRow): LeadMessageThreadDetail => ({
    ...leadThread(t),
    messages: leadMessagesOf(t.id).map((m) => ({ ...m, sender: { ...m.sender } })),
  });
  /** The subject, the text, the lead's name and email, and a phone number by its digits. */
  const leadMatches = (t: LeadThreadRow, search?: string) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const digits = phoneDigits(search);
    return (
      t.subject.toLowerCase().includes(q) ||
      leadMessagesOf(t.id).some((m) => m.body.toLowerCase().includes(q)) ||
      t.lead.displayName.toLowerCase().includes(q) ||
      (t.lead.email ?? '').toLowerCase().includes(q) ||
      (digits !== null &&
        t.lead.phone !== null &&
        digitsOf(t.lead.phone).slice(-10).endsWith(digits.slice(-10)))
    );
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
        automated: false,
        archivedAt: null,
        createdAt: now(),
      };
      s().threads.push(t);
      addMessage(t, staff(me), b.body);
      return detail(t);
    },
    send: async (threadId, body) => {
      await mockDelay();
      const t = find(threadId);
      const b = parseInput(SendFirmMessageRequest, body);
      // MSG-F12: the thread client's documents the client can see, within Messages Settings.
      const files: MessageAttachment[] = [];
      for (const documentId of b.documentIds ?? []) {
        const d = await options.documents?.get(documentId).catch(() => undefined);
        if (!d || d.clientId !== t.clientId) throw notFound();
        if (d.direction === 'INTERNAL')
          throw fail(409, 'ATTACHMENT_NOT_SHARED', `${d.fileName} is internal: share it first`);
        if (d.scanStatus === 'INFECTED' || d.scanStatus === 'FAILED')
          throw fail(409, 'FILE_BLOCKED', `${d.fileName} failed its security check`);
        const { allowedAttachmentTypes, attachmentMaxMb } = settingsOf();
        const ending = d.fileName.toLowerCase().split('.').pop() ?? '';
        if (!(allowedAttachmentTypes as readonly string[]).includes(ending))
          throw fail(400, 'ATTACHMENT_TYPE', `Messages Settings don't allow .${ending} files`);
        if (d.sizeBytes > attachmentMaxMb * 1024 * 1024)
          throw fail(400, 'ATTACHMENT_TOO_LARGE', `${d.fileName} is over ${attachmentMaxMb} MB`);
        files.push({
          documentId: d.id,
          fileName: d.fileName,
          contentType: d.contentType,
          sizeBytes: d.sizeBytes,
          status: d.scanStatus === 'CLEAN' ? 'READY' : 'CHECKING',
        });
      }
      return addMessage(t, staff(me), b.body, files);
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
    leads: {
      list: async (query = {}) => {
        await mockDelay();
        const q = parseInput(ListLeadMessageThreadsQuery, query);
        const reach = await leadReach();
        const kept = s()
          .leadThreads.filter((t) => reach.has(t.lead.id))
          .filter((t) => (q.archived ? t.archivedAt !== null : t.archivedAt === null))
          .filter((t) => leadMatches(t, q.search))
          .map(leadThread);
        kept.sort((a, b) =>
          (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(
            a.lastMessage?.createdAt ?? a.createdAt,
          ),
        );
        return page(kept, q.cursor, q.limit);
      },
      get: async (threadId) => (await mockDelay(), leadDetail(await findLead(threadId))),
      // As the API: through New Message, the copy lands in this thread.
      send: async (threadId, body) => {
        const t = await findLead(threadId);
        const b = parseInput(SendLeadMessageRequest, body);
        const who = { channel: b.channel, clientIds: [], leadIds: [t.lead.id] };
        const reason = (await outbound.check(who)).recipients[0]?.reason;
        if (reason) throw fail(409, reason, 'This lead cannot get messages on this channel.');
        const d = await outbound.create({ ...who, subject: t.subject, body: b.body });
        await outbound.send(d.id, { version: d.updatedAt, confirmUnresolved: true });
        const sent = leadMessagesOf(t.id).at(-1)!;
        return { ...sent, sender: { ...sent.sender } };
      },
    },
    outbound,
    settings: async () => (await mockDelay(), structuredClone(settingsOf())),
    updateSettings: async (body) => {
      await mockDelay();
      const { version, defaultAssigneeUserId, ...change } = parseInput(
        UpdateMessageSettingsRequest,
        body,
      );
      if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'Forbidden');
      const current = settingsOf();
      const assignee =
        defaultAssigneeUserId === undefined
          ? current.defaultAssignee
          : defaultAssigneeUserId === null
            ? null
            : teamFixtures()
                .filter((m) => m.status === 'ACTIVE' && m.user.id === defaultAssigneeUserId)
                .map((m) => ({ userId: m.user.id, name: m.user.name }))[0];
      if (assignee === undefined) throw notFound();
      if (version !== undefined && version !== current.updatedAt)
        throw fail(409, 'STALE_VERSION', 'Someone saved these settings since you opened them.');
      const set = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
      s().settings = {
        ...current,
        ...set,
        defaultAssignee: assignee ? { ...assignee } : null,
        updatedAt: now(),
        updatedBy: { ...me },
      };
      return structuredClone(settingsOf());
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
  // Jamie is the household's primary login: every file the firm sent is theirs to open.
  attachments: m.attachments,
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
        automated: false,
        archivedAt: null,
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
