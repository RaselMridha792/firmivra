import {
  ADMIN_COMM_MERGE_FIELDS,
  type AdminCommContact,
  type AdminCommConversation,
  type AdminCommConversationDetail,
  type AdminCommMessage,
  type AdminCommTemplate,
  type AdminCommTemplateCategory,
  type AdminCommunicationsClient,
  ApiRequestError,
  CreateAdminCommMessageRequest,
  CreateAdminCommTemplateCategoryRequest,
  CreateAdminCommTemplateRequest,
  ListAdminCommContactsQuery,
  ListAdminCommConversationsQuery,
  ListAdminCommTemplatesQuery,
  parseInput,
  ScheduleAdminCommMessageRequest,
  UpdateAdminCommConversationRequest,
  UpdateAdminCommMessageRequest,
  UpdateAdminCommTemplateCategoryRequest,
  UpdateAdminCommTemplateRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import {
  type CommunicationContactType,
  type CommunicationsMock,
  loadAdminCommunicationsMock,
} from './admin-communications-inbox';

/**
 * `api.adminCommunications` in mock mode (R56): the inbox contract's calls on Arfan's inbox
 * fixtures (mocks/admin-communications-inbox.ts, unchanged), mapped to the contract's shape (see
 * docs/work/R56-super-admin-api.md). Same rules and codes as the API: drafts and schedules change,
 * sent messages never do; only drafts are deleted; a retry is a new message. Nothing is sent.
 * Synthetic data only. Nothing is built until the first call.
 */
const ME = { userId: '0199c2a0-0000-7000-8000-0000000000ff', name: 'Octavia Holder' };
const uuid = (block: string, n: number) =>
  `0199c2a0-0000-7000-${block}-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message = code) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND');
const CONTACT_TYPE: Record<CommunicationContactType, AdminCommContact['type']> = {
  Client: 'FIRM',
  Support: 'FIRM',
  Lead: 'LEAD',
  Internal: 'TEAM',
};
const CHANNEL = { Email: 'EMAIL', SMS: 'SMS', Internal: 'INTERNAL' } as const;
const CATEGORIES = [
  'Sales',
  'Onboarding',
  'Support',
  'Billing',
  'Firm Applications',
  'System Notices',
];

interface Store {
  conversations: (Omit<
    AdminCommConversation,
    'lastMessage' | 'lastMessageAt' | 'hasScheduled' | 'hasFailed'
  > & {
    readAt: string | null;
  })[];
  messages: AdminCommMessage[];
  categories: AdminCommTemplateCategory[];
  templates: AdminCommTemplate[];
  keys: Map<string, string>;
}

function build(source: CommunicationsMock): Store {
  const now = Date.now();
  const messages: AdminCommMessage[] = [];
  let m = 0;
  const conversations = source.conversations.map((c, i) => {
    const id = uuid('8000', i + 1);
    const type = CONTACT_TYPE[c.contactType];
    c.messages.forEach((msg, j) => {
      const at = new Date(now - (i * 6 + c.messages.length - j) * 3_600_000).toISOString();
      const inbound = msg.from === 'contact';
      const channel = CHANNEL[msg.channel];
      messages.push({
        id: uuid('8001', ++m),
        conversationId: id,
        channel,
        direction: channel === 'INTERNAL' ? 'INTERNAL' : inbound ? 'INBOUND' : 'OUTBOUND',
        status: inbound ? 'RECEIVED' : 'SENT',
        subject: channel === 'EMAIL' ? 'Onboarding' : null,
        body: msg.body,
        template: null,
        scheduledAt: null,
        scheduledTimeZone: null,
        sender: inbound ? null : ME,
        fromAddress: inbound ? `${c.initials.toLowerCase()}@sample.example.test` : null,
        sentAt: inbound ? null : at,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        retryOfMessageId: null,
        broadcastId: null,
        recipients: [],
        mentions: [],
        createdAt: at,
        updatedAt: at,
      });
    });
    return {
      id,
      contact: {
        type,
        business: type === 'FIRM' ? { id: uuid('8002', i + 1), name: c.name } : null,
        userId: type === 'LEAD' ? null : uuid('8003', i + 1),
        salesContactId: type === 'LEAD' ? uuid('8004', i + 1) : null,
        name: c.name,
        email: `${c.initials.toLowerCase()}@sample.example.test`,
        phone: c.channel === 'SMS' ? '+15125550147' : null,
      },
      subject: c.channel === 'Email' ? 'Onboarding' : null,
      status: 'OPEN' as const,
      assignedTo: c.assignedTo ? { userId: ME.userId, name: c.assignedTo } : null,
      tags: [],
      unread: c.unread,
      mentionsMe: c.mention,
      createdAt: new Date(now - (i + 2) * 86_400_000).toISOString(),
      readAt: c.unread ? null : new Date(now).toISOString(),
    };
  });
  const at = new Date(now - 86_400_000).toISOString();
  const categories = CATEGORIES.map((name, i) => ({
    id: uuid('8005', i + 1),
    name,
    systemKey: name.toLowerCase().replace(/ /g, '_'),
    position: i,
    isActive: true,
    templateCount: 0,
  }));
  const templates: AdminCommTemplate[] = [
    {
      id: uuid('8006', 1),
      category: { id: categories[1]!.id, name: 'Onboarding' },
      name: 'Welcome to Firmivra',
      channel: 'EMAIL',
      status: 'ACTIVE',
      subject: 'Welcome to Firmivra, {{firm.name}}',
      body: 'Hi {{contact.first_name}},\n\nWelcome aboard. — {{sender.name}}',
      mergeFields: ['firm.name', 'contact.first_name', 'sender.name'],
      createdBy: ME,
      updatedBy: ME,
      createdAt: at,
      updatedAt: at,
    },
    {
      id: uuid('8006', 2),
      category: { id: categories[3]!.id, name: 'Billing' },
      name: 'Payment reminder (text)',
      channel: 'SMS',
      status: 'ACTIVE',
      subject: null,
      body: 'Hi {{contact.first_name}}, a reminder that your Firmivra invoice is due.',
      mergeFields: ['contact.first_name'],
      createdBy: ME,
      updatedBy: ME,
      createdAt: at,
      updatedAt: at,
    },
  ];
  return { conversations, messages, categories, templates, keys: new Map() };
}

const fieldsIn = (...texts: (string | null | undefined)[]) => [
  ...new Set(
    texts.flatMap((t) => [...(t ?? '').matchAll(/\{\{\s*([a-z_.]+)\s*\}\}/g)].map((x) => x[1]!)),
  ),
];
const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_, k: string) => values[k] ?? '');
const samples = () =>
  Object.fromEntries(
    Object.entries(ADMIN_COMM_MERGE_FIELDS).map(([k, v]) => [k, v.sample]),
  ) as Record<string, string>;

export function createAdminCommunicationsMock(): AdminCommunicationsClient {
  let store: Store | undefined;
  const s = async () => (store ??= build(await loadAdminCommunicationsMock()));
  const conv = (st: Store, id: string) => st.conversations.find((c) => c.id === id) ?? null;
  const msg = (st: Store, id: string) => st.messages.find((x) => x.id === id) ?? null;
  const shape = (st: Store, c: Store['conversations'][number]): AdminCommConversation => {
    const mine = st.messages
      .filter((x) => x.conversationId === c.id && x.status !== 'DRAFT')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = mine.at(-1);
    const { readAt, ...rest } = c;
    return {
      ...rest,
      unread: !!last && last.direction === 'INBOUND' && (!readAt || last.createdAt > readAt),
      lastMessage: last
        ? {
            excerpt: last.body.slice(0, 140),
            channel: last.channel,
            direction: last.direction,
            status: last.status,
            at: last.createdAt,
          }
        : null,
      lastMessageAt: last?.createdAt ?? null,
      hasScheduled: st.messages.some((x) => x.conversationId === c.id && x.status === 'SCHEDULED'),
      hasFailed: st.messages.some(
        (x) =>
          x.conversationId === c.id && (x.status === 'FAILED' || x.status === 'PARTIALLY_SENT'),
      ),
    };
  };
  const editable = (x: AdminCommMessage) => {
    if (x.status !== 'DRAFT' && x.status !== 'SCHEDULED') throw fail(409, 'NOT_EDITABLE');
  };
  const goOut = (x: AdminCommMessage) => {
    const at = new Date().toISOString();
    Object.assign(x, { status: 'SENT', sentAt: at, updatedAt: at });
    for (const r of x.recipients) Object.assign(r, { status: 'SENT', sentAt: at });
  };

  return {
    summary: async () => {
      await mockDelay();
      const st = await s();
      const list = st.conversations.map((c) => shape(st, c));
      const open = list.filter((c) => c.status === 'OPEN');
      const byChannel = { EMAIL: 0, SMS: 0, INTERNAL: 0, IN_APP: 0 };
      for (const c of open) if (c.lastMessage) byChannel[c.lastMessage.channel] += 1;
      return {
        unread: list.filter((c) => c.unread).length,
        open: open.length,
        waitingOnReply: open.filter((c) => c.lastMessage?.direction === 'OUTBOUND').length,
        scheduled: st.messages.filter((x) => x.status === 'SCHEDULED').length,
        failed: st.messages.filter((x) => x.status === 'FAILED' || x.status === 'PARTIALLY_SENT')
          .length,
        byChannel,
      };
    },
    contacts: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListAdminCommContactsQuery, query);
      const term = q.search?.toLowerCase();
      const st = await s();
      return {
        items: st.conversations
          .map((c) => c.contact)
          .filter(
            (c) => (!q.type || c.type === q.type) && (!term || c.name.toLowerCase().includes(term)),
          )
          .slice(0, 20),
      };
    },
    conversations: {
      list: async (query = {}) => {
        await mockDelay();
        const q = parseInput(ListAdminCommConversationsQuery, query);
        const st = await s();
        const term = q.search?.toLowerCase();
        const rows = st.conversations
          .map((c) => shape(st, c))
          .filter(
            (c) =>
              (q.view === 'INBOX'
                ? c.status === 'OPEN'
                : q.view === 'ASSIGNED_TO_ME'
                  ? c.assignedTo?.userId === ME.userId
                  : q.view === 'UNASSIGNED'
                    ? !c.assignedTo
                    : q.view === 'MENTIONS'
                      ? c.mentionsMe
                      : q.view === 'SCHEDULED'
                        ? c.hasScheduled
                        : true) &&
              (!q.channel || c.lastMessage?.channel === q.channel) &&
              (!q.contactType || c.contact.type === q.contactType) &&
              (!term ||
                `${c.contact.name} ${c.contact.email ?? ''} ${c.subject ?? ''} ${c.tags.join(' ')}`
                  .toLowerCase()
                  .includes(term)),
          )
          .sort((a, b) =>
            q.sort === 'UNREAD_FIRST' && a.unread !== b.unread
              ? Number(b.unread) - Number(a.unread)
              : (q.sort === 'OLDEST' ? 1 : -1) *
                (a.lastMessageAt ?? a.createdAt).localeCompare(b.lastMessageAt ?? b.createdAt),
          );
        const start = (q.page - 1) * q.pageSize;
        return {
          items: rows.slice(start, start + q.pageSize),
          total: rows.length,
          page: q.page,
          pageSize: q.pageSize,
        };
      },
      get: async (id) => {
        await mockDelay();
        const st = await s();
        const c = conv(st, id);
        if (!c) throw notFound();
        const detail: AdminCommConversationDetail = {
          ...shape(st, c),
          messages: st.messages
            .filter((x) => x.conversationId === id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        };
        return detail;
      },
      read: async (id) => {
        await mockDelay();
        const st = await s();
        const c = conv(st, id);
        if (!c) throw notFound();
        c.readAt = new Date().toISOString();
        return shape(st, c);
      },
      update: async (id, body) => {
        await mockDelay();
        const b = parseInput(UpdateAdminCommConversationRequest, body);
        const st = await s();
        const c = conv(st, id);
        if (!c) throw notFound();
        if (b.assignedToUserId !== undefined)
          c.assignedTo = b.assignedToUserId ? { userId: b.assignedToUserId, name: ME.name } : null;
        if (b.tags) c.tags = [...new Set(b.tags)];
        if (b.status) c.status = b.status;
        return shape(st, c);
      },
    },
    messages: {
      create: async (body) => {
        await mockDelay();
        const b = parseInput(CreateAdminCommMessageRequest, body);
        const st = await s();
        const again = st.keys.get(b.idempotencyKey);
        if (again) return msg(st, again)!;
        if (b.mode === 'SCHEDULE' && Date.parse(b.scheduledAt!) <= Date.now())
          throw fail(409, 'SCHEDULE_IN_PAST');
        let c = b.conversationId ? conv(st, b.conversationId) : null;
        if (b.conversationId && !c) throw notFound();
        if (!c) {
          const known = st.conversations.find(
            (x) =>
              x.contact.type === b.contact!.type &&
              (x.contact.business?.id ===
                ('businessId' in b.contact! ? b.contact.businessId : '') ||
                x.contact.salesContactId ===
                  ('salesContactId' in b.contact! ? b.contact.salesContactId : '') ||
                x.contact.userId === ('userId' in b.contact! ? b.contact.userId : '')),
          );
          if (!known) throw notFound();
          c = known;
        }
        const address =
          b.channel === 'SMS'
            ? c.contact.phone
            : b.channel === 'EMAIL'
              ? c.contact.email
              : c.contact.name;
        if (!address) throw fail(409, 'NO_DESTINATION');
        const at = new Date().toISOString();
        const id = uuid('8007', st.messages.length + 1);
        const x: AdminCommMessage = {
          id,
          conversationId: c.id,
          channel: b.channel,
          direction: b.channel === 'INTERNAL' ? 'INTERNAL' : 'OUTBOUND',
          status: b.mode === 'DRAFT' ? 'DRAFT' : b.mode === 'SCHEDULE' ? 'SCHEDULED' : 'SENDING',
          subject: b.subject ?? null,
          body: b.body,
          template: null,
          scheduledAt: b.scheduledAt ?? null,
          scheduledTimeZone: b.scheduledTimeZone ?? null,
          sender: ME,
          fromAddress: null,
          sentAt: null,
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          retryOfMessageId: null,
          broadcastId: null,
          recipients:
            b.channel === 'INTERNAL'
              ? []
              : [
                  { kind: 'TO' as const, address },
                  ...(b.cc ?? []).map((a) => ({ kind: 'CC' as const, address: a })),
                  ...(b.bcc ?? []).map((a) => ({ kind: 'BCC' as const, address: a })),
                ].map((r, n) => ({
                  id: uuid('8008', st.messages.length * 50 + n + 1),
                  kind: r.kind,
                  name: r.kind === 'TO' ? c.contact.name : r.address,
                  address: r.address,
                  status: 'PENDING' as const,
                  errorCode: null,
                  sentAt: null,
                  deliveredAt: null,
                  failedAt: null,
                })),
          mentions: (b.mentionUserIds ?? []).map((userId) => ({ userId, name: ME.name })),
          createdAt: at,
          updatedAt: at,
        };
        if (x.status === 'SENDING') goOut(x);
        st.messages.push(x);
        st.keys.set(b.idempotencyKey, id);
        return x;
      },
      update: async (id, body) => {
        await mockDelay();
        const b = parseInput(UpdateAdminCommMessageRequest, body);
        const st = await s();
        const x = msg(st, id);
        if (!x) throw notFound();
        editable(x);
        if (b.subject !== undefined) x.subject = b.subject;
        if (b.body !== undefined) x.body = b.body;
        x.updatedAt = new Date().toISOString();
        return x;
      },
      send: async (id) => {
        await mockDelay();
        const st = await s();
        const x = msg(st, id);
        if (!x) throw notFound();
        editable(x);
        goOut(x);
        return x;
      },
      schedule: async (id, body) => {
        await mockDelay();
        const b = parseInput(ScheduleAdminCommMessageRequest, body);
        const st = await s();
        const x = msg(st, id);
        if (!x) throw notFound();
        editable(x);
        if (Date.parse(b.scheduledAt) <= Date.now()) throw fail(409, 'SCHEDULE_IN_PAST');
        Object.assign(x, { status: 'SCHEDULED', ...b, updatedAt: new Date().toISOString() });
        return x;
      },
      cancel: async (id) => {
        await mockDelay();
        const st = await s();
        const x = msg(st, id);
        if (!x) throw notFound();
        if (x.status !== 'SCHEDULED') throw fail(409, 'NOT_SCHEDULED');
        Object.assign(x, { status: 'CANCELLED', updatedAt: new Date().toISOString() });
        return x;
      },
      retry: async (id) => {
        await mockDelay();
        const st = await s();
        const x = msg(st, id);
        if (!x) throw notFound();
        if (x.status !== 'FAILED' && x.status !== 'PARTIALLY_SENT')
          throw fail(409, 'NOT_RETRYABLE');
        const copy: AdminCommMessage = {
          ...structuredClone(x),
          id: uuid('8007', st.messages.length + 1),
          retryOfMessageId: x.id,
          createdAt: new Date().toISOString(),
        };
        goOut(copy);
        st.messages.push(copy);
        return copy;
      },
      remove: async (id) => {
        await mockDelay();
        const st = await s();
        const x = msg(st, id);
        if (!x) throw notFound();
        if (x.status !== 'DRAFT') throw fail(409, 'NOT_DRAFT');
        st.messages = st.messages.filter((y) => y.id !== id);
        return { ok: true as const };
      },
    },
    templates: {
      list: async (query = {}) => {
        await mockDelay();
        const q = parseInput(ListAdminCommTemplatesQuery, query);
        const st = await s();
        const term = q.search?.toLowerCase();
        const rows = st.templates
          .filter(
            (t) =>
              (q.status ? t.status === q.status : t.status !== 'ARCHIVED') &&
              (!q.categoryId || t.category.id === q.categoryId) &&
              (!q.channel || t.channel === q.channel) &&
              (!term || t.name.toLowerCase().includes(term)),
          )
          .sort((a, b) =>
            q.sort === 'NAME'
              ? a.name.localeCompare(b.name)
              : b.updatedAt.localeCompare(a.updatedAt),
          );
        const start = (q.page - 1) * q.pageSize;
        return {
          items: rows.slice(start, start + q.pageSize),
          total: rows.length,
          page: q.page,
          pageSize: q.pageSize,
        };
      },
      get: async (id) => {
        await mockDelay();
        const t = (await s()).templates.find((x) => x.id === id);
        if (!t) throw notFound();
        return t;
      },
      create: async (body) => {
        await mockDelay();
        const b = parseInput(CreateAdminCommTemplateRequest, body);
        const st = await s();
        const cat = st.categories.find((c) => c.id === b.categoryId);
        if (!cat) throw notFound();
        if (!cat.isActive) throw fail(409, 'CATEGORY_INACTIVE');
        if (st.templates.some((t) => t.name.toLowerCase() === b.name.toLowerCase()))
          throw fail(409, 'DUPLICATE_NAME');
        const at = new Date().toISOString();
        const t: AdminCommTemplate = {
          id: uuid('8006', st.templates.length + 1),
          category: { id: cat.id, name: cat.name },
          name: b.name,
          channel: b.channel,
          status: b.status,
          subject: b.subject ?? null,
          body: b.body,
          mergeFields: fieldsIn(b.subject, b.body),
          createdBy: ME,
          updatedBy: ME,
          createdAt: at,
          updatedAt: at,
        };
        st.templates.push(t);
        return t;
      },
      update: async (id, body) => {
        await mockDelay();
        const b = parseInput(UpdateAdminCommTemplateRequest, body);
        const st = await s();
        const t = st.templates.find((x) => x.id === id && x.status !== 'ARCHIVED');
        if (!t) throw notFound();
        if (
          b.name &&
          st.templates.some((x) => x.id !== id && x.name.toLowerCase() === b.name!.toLowerCase())
        )
          throw fail(409, 'DUPLICATE_NAME');
        if (b.categoryId) {
          const cat = st.categories.find((c) => c.id === b.categoryId);
          if (!cat) throw notFound();
          t.category = { id: cat.id, name: cat.name };
        }
        Object.assign(t, {
          ...(b.name ? { name: b.name } : {}),
          ...(b.subject !== undefined ? { subject: b.subject } : {}),
          ...(b.body ? { body: b.body } : {}),
          ...(b.status ? { status: b.status } : {}),
          updatedBy: ME,
          updatedAt: new Date().toISOString(),
        });
        t.mergeFields = fieldsIn(t.subject, t.body);
        return t;
      },
      duplicate: async (id) => {
        await mockDelay();
        const st = await s();
        const t = st.templates.find((x) => x.id === id);
        if (!t) throw notFound();
        const copy = {
          ...t,
          id: uuid('8006', st.templates.length + 1),
          name: `${t.name} (copy)`,
          status: 'INACTIVE' as const,
        };
        st.templates.push(copy);
        return copy;
      },
      archive: async (id) => {
        await mockDelay();
        const t = (await s()).templates.find((x) => x.id === id);
        if (!t) throw notFound();
        t.status = 'ARCHIVED';
        return t;
      },
      preview: async (id) => {
        await mockDelay();
        const t = (await s()).templates.find((x) => x.id === id);
        if (!t) throw notFound();
        return {
          subject: t.subject ? fill(t.subject, samples()) : null,
          body: fill(t.body, samples()),
          missing: [],
        };
      },
      test: async (id, body = {}) => {
        await mockDelay();
        const t = (await s()).templates.find((x) => x.id === id);
        if (!t) throw notFound();
        if (t.channel === 'SMS' && !body.phone)
          throw fail(400, 'VALIDATION_FAILED', 'Enter a phone number');
        return { sentTo: t.channel === 'SMS' ? body.phone! : 'octavia@firmivra.example.test' };
      },
    },
    categories: {
      list: async () => {
        await mockDelay();
        const st = await s();
        return {
          items: st.categories.map((c) => ({
            ...c,
            templateCount: st.templates.filter(
              (t) => t.category.id === c.id && t.status !== 'ARCHIVED',
            ).length,
          })),
        };
      },
      create: async (body) => {
        await mockDelay();
        const b = parseInput(CreateAdminCommTemplateCategoryRequest, body);
        const st = await s();
        if (st.categories.some((c) => c.name.toLowerCase() === b.name.toLowerCase()))
          throw fail(409, 'DUPLICATE_NAME');
        const c = {
          id: uuid('8005', st.categories.length + 1),
          name: b.name,
          systemKey: null,
          position: st.categories.length,
          isActive: true,
          templateCount: 0,
        };
        st.categories.push(c);
        return c;
      },
      update: async (id, body) => {
        await mockDelay();
        const b = parseInput(UpdateAdminCommTemplateCategoryRequest, body);
        const st = await s();
        const c = st.categories.find((x) => x.id === id);
        if (!c) throw notFound();
        if (b.name && c.systemKey) throw fail(409, 'SYSTEM_CATEGORY');
        Object.assign(c, b);
        return c;
      },
    },
  };
}
