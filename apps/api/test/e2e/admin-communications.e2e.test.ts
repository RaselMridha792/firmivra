// End-to-end: Super Admin Communications, the inbox (R56 on R0's B6; contract in
// packages/types/src/admin-communications). Contacts (firm owners, sales leads, the team),
// conversations and their tabs, read marks, assignment and status; messages drafted, sent now
// (through NotifyService, faked here), scheduled, cancelled, retried and deleted, with each
// recipient's result; templates and categories with merge fields, preview and test. Firm sessions
// get 401. Counts are compared before and after, since other tests write comm rows too.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminCommContactList,
  AdminCommConversation,
  AdminCommConversationDetail,
  AdminCommMessage,
  AdminCommSummary,
  AdminCommTemplate,
  AdminCommTemplateCategory,
  AdminCommTemplateCategoryList,
  AdminCommTemplatePreview,
  ListAdminCommConversationsResponse,
  ListAdminCommTemplatesResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r56ac-${key}-${run}@r56ac.test` });
const me = person('me');
const mate = person('mate');
const owner = person('owner');
const firm = { id: '', name: `Sample Comm Firm ${run}` };
const lead = { id: '', name: `Riley Lead ${run}` };
const BASE = '/api/v1/admin/communications';

/** What NotifyService was asked to send; an address starting "fail" is refused. */
const sent: NotifyMessage[] = [];
const fakeNotify = {
  send: (m: NotifyMessage) => {
    if (m.to.startsWith('fail'))
      return Promise.reject(Object.assign(new Error('refused'), { reason: 'InvalidRecipient' }));
    sent.push(m);
    return Promise.resolve();
  },
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewerSeq = 0;
const newViewer = () => `198.20.${(viewerSeq >> 8) & 255}.${viewerSeq++ & 255}`;

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Method = 'get' | 'post' | 'patch' | 'delete';
async function call(
  method: Method,
  path: string,
  body?: object,
  who: { email: string } | null = me,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
async function ok<T>(method: Method, path: string, body?: object): Promise<T> {
  const res = await call(method, path, body);
  expect(res.status, `${method} ${path} ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as T;
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const key = () => randomUUID();
const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

const db = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
async function auditActions(entityId: string) {
  const c = db();
  const rows = await runInScope(c, { kind: 'platform' }, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, select: { action: true, businessId: true } }),
  );
  await c.$disconnect();
  return rows;
}

beforeAll(async () => {
  const c = db();
  await runInScope(c, { kind: 'platform' }, async (tx) => {
    for (const [k, p] of Object.entries({ me, mate })) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'ADMIN', email: p.email, name: `Fake R56 ${k}` },
      });
      await tx.platformAdmin.create({ data: { userId: p.id } });
    }
    await tx.user.create({
      data: {
        id: owner.id,
        cognitoSub: owner.id,
        pool: 'STAFF',
        email: owner.email,
        name: 'Jordan Sample',
        phone: '+15125550147',
      },
    });
    firm.id = (
      await tx.business.create({
        data: { slug: `r56ac-${run}`, name: firm.name, status: 'ACTIVE' },
      })
    ).id;
    lead.id = (
      await tx.salesContact.create({
        data: { name: lead.name, email: `riley-${run}@lead.example.test` },
      })
    ).id;
  });
  await runInScope(c, { kind: 'business', businessId: firm.id }, (tx) =>
    tx.membership.create({
      data: { businessId: firm.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  await c.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue(fakeNotify)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('who may call', () => {
  it('answers 401 signed out and to a firm session', async () => {
    for (const who of [null, fx.users.ownerA])
      expect((await call('get', '/summary', undefined, who)).status).toBe(401);
  });
});

describe('contacts', () => {
  it('finds firm owners by firm name, leads and the team, never typed details', async () => {
    const firms = AdminCommContactList.parse(
      await ok('get', `/contacts?type=FIRM&search=${encodeURIComponent(firm.name)}`),
    );
    expect(firms.items).toEqual([
      expect.objectContaining({
        type: 'FIRM',
        business: { id: firm.id, name: firm.name },
        userId: owner.id,
        name: 'Jordan Sample',
        email: owner.email,
      }),
    ]);
    const leads = AdminCommContactList.parse(
      await ok('get', `/contacts?search=${encodeURIComponent(lead.name)}`),
    );
    expect(leads.items.map((x) => x.salesContactId)).toEqual([lead.id]);
    const team = AdminCommContactList.parse(
      await ok('get', `/contacts?type=TEAM&search=r56ac-mate-${run}`),
    );
    expect(team.items.map((x) => x.userId)).toEqual([mate.id]);
  });
});

describe('sending', () => {
  let firstId = '';
  let threadId = '';

  it('sends an email now to a firm owner, with merge fields and Cc, once per key', async () => {
    const before = AdminCommSummary.parse(await ok('get', '/summary'));
    const k = key();
    const body = {
      contact: { type: 'FIRM', businessId: firm.id },
      channel: 'EMAIL',
      subject: 'Welcome, {{firm.name}}',
      body: 'Hi {{contact.first_name}}, from {{sender.name}}.',
      cc: [`cc-${run}@example.test`],
      mode: 'SEND',
      idempotencyKey: k,
    };
    const m = AdminCommMessage.parse(await ok('post', '/messages', body));
    expect(m.status).toBe('SENT');
    expect(m.sentAt).not.toBeNull();
    expect(m.recipients.map((r) => [r.kind, r.status])).toEqual([
      ['TO', 'SENT'],
      ['CC', 'SENT'],
    ]);
    const mine = sent.filter((s) => s.to === owner.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      template: 'platform.message-email',
      businessId: null,
      data: {
        name: 'Jordan Sample',
        subject: `Welcome, ${firm.name}`,
        body: 'Hi Jordan, from Fake R56 me.',
      },
    });
    const again = AdminCommMessage.parse(await ok('post', '/messages', body));
    expect(again.id).toBe(m.id);
    expect(sent.filter((s) => s.to === owner.email)).toHaveLength(1);
    expect((await auditActions(m.id)).map((a) => a.action)).toEqual(['comm_message.sent']);
    const after = AdminCommSummary.parse(await ok('get', '/summary'));
    expect(after.open - before.open).toBe(1);
    firstId = m.id;
    threadId = m.conversationId;
  });

  it('uses the same open thread for the same contact, and shows it in the inbox', async () => {
    const m = AdminCommMessage.parse(
      await ok('post', '/messages', {
        contact: { type: 'FIRM', businessId: firm.id },
        channel: 'SMS',
        body: 'Text {{contact.first_name}}',
        mode: 'SEND',
        idempotencyKey: key(),
      }),
    );
    expect(m.conversationId).toBe(threadId);
    expect(m.subject).toBeNull();
    expect(sent.at(-1)).toMatchObject({
      template: 'platform.message-sms',
      to: '+15125550147',
      data: { body: 'Text Jordan' },
    });
    const detail = AdminCommConversationDetail.parse(await ok('get', `/conversations/${threadId}`));
    expect(detail.messages.map((x) => x.id)).toEqual([firstId, m.id]);
    expect(detail.lastMessage?.channel).toBe('SMS');
    const inbox = ListAdminCommConversationsResponse.parse(
      await ok('get', `/conversations?search=${encodeURIComponent('Jordan Sample')}`),
    );
    expect(inbox.items.map((x) => x.id)).toContain(threadId);
  });

  it('refuses a channel the contact has no address for', async () => {
    const res = await call('post', '/messages', {
      contact: { type: 'LEAD', salesContactId: lead.id },
      channel: 'SMS',
      body: 'Hello',
      mode: 'SEND',
      idempotencyKey: key(),
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'NO_DESTINATION']);
    const gone = await call('post', '/messages', {
      contact: { type: 'LEAD', salesContactId: randomUUID() },
      channel: 'EMAIL',
      subject: 'x',
      body: 'Hello',
      mode: 'SEND',
      idempotencyKey: key(),
    });
    expect(gone.status).toBe(404);
  });

  it('records a partial send, retries only the failed recipient, once per key', async () => {
    const m = AdminCommMessage.parse(
      await ok('post', '/messages', {
        contact: { type: 'LEAD', salesContactId: lead.id },
        channel: 'EMAIL',
        subject: 'Pricing',
        body: 'Here is our pricing.',
        cc: [`fail-${run}@example.test`],
        mode: 'SEND',
        idempotencyKey: key(),
      }),
    );
    expect(m.status).toBe('PARTIALLY_SENT');
    expect(m.errorCode).toBe('delivery_failed');
    expect(m.recipients.find((r) => r.kind === 'CC')).toMatchObject({
      status: 'FAILED',
      errorCode: 'invalid_recipient',
    });
    const k = key();
    const retry = AdminCommMessage.parse(
      await ok('post', `/messages/${m.id}/retry`, { idempotencyKey: k }),
    );
    expect(retry.retryOfMessageId).toBe(m.id);
    expect(retry.recipients.map((r) => r.kind)).toEqual(['CC']);
    expect(retry.status).toBe('FAILED');
    const same = AdminCommMessage.parse(
      await ok('post', `/messages/${m.id}/retry`, { idempotencyKey: k }),
    );
    expect(same.id).toBe(retry.id);
    const res = await call('post', `/messages/${firstId}/retry`, { idempotencyKey: key() });
    expect([res.status, codeOf(res)]).toEqual([409, 'NOT_RETRYABLE']);
    const actions = (await auditActions(m.id)).map((a) => a.action).sort();
    expect(actions).toEqual(['comm_message.failed', 'comm_message.sent']);
  });
});

describe('drafts and schedules', () => {
  const draft = async () =>
    AdminCommMessage.parse(
      await ok('post', '/messages', {
        contact: { type: 'TEAM', userId: mate.id },
        channel: 'EMAIL',
        body: 'Draft text',
        mode: 'DRAFT',
        idempotencyKey: key(),
      }),
    );

  it('edits a draft, schedules it, cancels it, and then it is fixed', async () => {
    const d = await draft();
    expect(d.status).toBe('DRAFT');
    const edited = AdminCommMessage.parse(
      await ok('patch', `/messages/${d.id}`, {
        subject: 'Team sync',
        cc: [`copy-${run}@example.test`],
      }),
    );
    expect(edited.subject).toBe('Team sync');
    expect(edited.recipients.map((r) => r.kind)).toEqual(['TO', 'CC']);
    const past = await call('post', `/messages/${d.id}/schedule`, {
      scheduledAt: '2020-01-01T00:00:00.000Z',
      scheduledTimeZone: 'America/New_York',
    });
    expect([past.status, codeOf(past)]).toEqual([409, 'SCHEDULE_IN_PAST']);
    const s = AdminCommMessage.parse(
      await ok('post', `/messages/${d.id}/schedule`, {
        scheduledAt: later(),
        scheduledTimeZone: 'America/New_York',
      }),
    );
    expect(s.status).toBe('SCHEDULED');
    const scheduled = ListAdminCommConversationsResponse.parse(
      await ok('get', '/conversations?view=SCHEDULED&pageSize=100'),
    );
    expect(scheduled.items.map((x) => x.id)).toContain(s.conversationId);
    expect(AdminCommMessage.parse(await ok('post', `/messages/${d.id}/cancel`)).status).toBe(
      'CANCELLED',
    );
    for (const [method, path, body] of [
      ['post', `/messages/${d.id}/cancel`, undefined, 'NOT_SCHEDULED'],
      ['patch', `/messages/${d.id}`, { body: 'Changed' }, 'NOT_EDITABLE'],
    ] as const) {
      const res = await call(method, path, body);
      expect(res.status, path).toBe(409);
    }
    expect((await auditActions(d.id)).map((a) => a.action).sort()).toEqual([
      'comm_message.cancelled',
      'comm_message.scheduled',
    ]);
  });

  it('sends a draft, deletes only drafts', async () => {
    const d = await draft();
    const noSubject = await call('post', `/messages/${d.id}/send`, { idempotencyKey: key() });
    expect(noSubject.status).toBe(400);
    await ok('patch', `/messages/${d.id}`, { subject: 'Sent from draft' });
    expect(
      AdminCommMessage.parse(await ok('post', `/messages/${d.id}/send`, { idempotencyKey: key() }))
        .status,
    ).toBe('SENT');
    const res = await call('delete', `/messages/${d.id}`);
    expect([res.status, codeOf(res)]).toEqual([409, 'NOT_DRAFT']);
    const other = await draft();
    expect(await ok('delete', `/messages/${other.id}`)).toEqual({ ok: true });
    expect((await call('get', `/conversations/${other.conversationId}`)).status).toBe(200);
  });

  it('creates a scheduled message in one step', async () => {
    const m = AdminCommMessage.parse(
      await ok('post', '/messages', {
        contact: { type: 'TEAM', userId: mate.id },
        channel: 'EMAIL',
        subject: 'Later',
        body: 'Later',
        mode: 'SCHEDULE',
        scheduledAt: later(),
        scheduledTimeZone: 'America/Chicago',
        idempotencyKey: key(),
      }),
    );
    expect(m).toMatchObject({
      status: 'SCHEDULED',
      scheduledTimeZone: 'America/Chicago',
      sentAt: null,
    });
  });
});

describe('conversations', () => {
  let threadId = '';

  it('writes a note mentioning me, which shows under Mentions', async () => {
    const note = AdminCommMessage.parse(
      await ok('post', '/messages', {
        contact: { type: 'TEAM', userId: mate.id },
        channel: 'INTERNAL',
        body: 'Please look',
        mentionUserIds: [me.id],
        mode: 'SEND',
        idempotencyKey: key(),
      }),
    );
    expect(note).toMatchObject({
      direction: 'INTERNAL',
      status: 'SENT',
      mentions: [{ userId: me.id, name: 'Fake R56 me' }],
    });
    threadId = note.conversationId;
    const mentions = ListAdminCommConversationsResponse.parse(
      await ok('get', '/conversations?view=MENTIONS&pageSize=100'),
    );
    expect(mentions.items.find((x) => x.id === threadId)?.mentionsMe).toBe(true);
    const bad = await call('post', '/messages', {
      conversationId: threadId,
      channel: 'INTERNAL',
      body: 'x',
      mentionUserIds: [owner.id],
      mode: 'SEND',
      idempotencyKey: key(),
    });
    expect([bad.status, codeOf(bad)]).toEqual([409, 'NOT_A_TEAM_MEMBER']);
  });

  it('is unread after an inbound message, and read once I read it', async () => {
    const c = db();
    await runInScope(c, { kind: 'platform' }, (tx) =>
      tx.commMessage.create({
        data: {
          conversationId: threadId,
          channel: 'EMAIL',
          direction: 'INBOUND',
          status: 'RECEIVED',
          subject: 'Re',
          body: 'Reply (sample)',
          fromAddress: mate.email,
        },
      }),
    );
    await c.$disconnect();
    const unread = ListAdminCommConversationsResponse.parse(
      await ok('get', '/conversations?view=ALL&sort=UNREAD_FIRST&pageSize=100'),
    );
    expect(unread.items.find((x) => x.id === threadId)?.unread).toBe(true);
    expect(
      AdminCommConversation.parse(await ok('post', `/conversations/${threadId}/read`)).unread,
    ).toBe(false);
  });

  it('assigns, tags and closes, with audit rows; refuses a stranger', async () => {
    const assigned = AdminCommConversation.parse(
      await ok('patch', `/conversations/${threadId}`, {
        assignedToUserId: me.id,
        tags: ['vip', 'vip', 'onboarding'],
      }),
    );
    expect(assigned.assignedTo).toEqual({ userId: me.id, name: 'Fake R56 me' });
    expect(assigned.tags).toEqual(['vip', 'onboarding']);
    const mine = ListAdminCommConversationsResponse.parse(
      await ok('get', '/conversations?view=ASSIGNED_TO_ME&pageSize=100'),
    );
    expect(mine.items.map((x) => x.id)).toContain(threadId);
    const closed = AdminCommConversation.parse(
      await ok('patch', `/conversations/${threadId}`, { status: 'CLOSED' }),
    );
    expect(closed.status).toBe('CLOSED');
    const inbox = ListAdminCommConversationsResponse.parse(
      await ok('get', '/conversations?view=INBOX&pageSize=100'),
    );
    expect(inbox.items.map((x) => x.id)).not.toContain(threadId);
    const res = await call('patch', `/conversations/${threadId}`, { assignedToUserId: owner.id });
    expect([res.status, codeOf(res)]).toEqual([409, 'NOT_A_TEAM_MEMBER']);
    expect((await auditActions(threadId)).map((a) => a.action).sort()).toEqual([
      'comm_conversation.assigned',
      'comm_conversation.status_changed',
    ]);
    expect((await call('get', `/conversations/${randomUUID()}`)).status).toBe(404);
    expect((await call('get', '/conversations?view=NOPE')).status).toBe(400);
  });
});

describe('templates and categories', () => {
  let categoryId = '';
  let templateId = '';

  it('lists the six shipped categories and adds one', async () => {
    const list = AdminCommTemplateCategoryList.parse(await ok('get', '/template-categories'));
    expect(
      list.items
        .filter((c) => c.systemKey)
        .map((c) => c.systemKey)
        .sort(),
    ).toEqual(['billing', 'firm_applications', 'onboarding', 'sales', 'support', 'system_notices']);
    const shipped = list.items.find((c) => c.systemKey === 'onboarding')!;
    const res = await call('patch', `/template-categories/${shipped.id}`, {
      name: `Renamed ${run}`,
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'SYSTEM_CATEGORY']);
    const made = AdminCommTemplateCategory.parse(
      await ok('post', '/template-categories', { name: `Fake category ${run}` }),
    );
    categoryId = made.id;
    const dup = await call('post', '/template-categories', { name: `Fake category ${run}` });
    expect([dup.status, codeOf(dup)]).toEqual([409, 'DUPLICATE_NAME']);
  });

  it('creates, edits, duplicates and archives a template', async () => {
    const t = AdminCommTemplate.parse(
      await ok('post', '/templates', {
        categoryId,
        name: `Welcome ${run}`,
        channel: 'EMAIL',
        subject: 'Welcome {{firm.name}}',
        body: 'Hi {{contact.first_name}}',
      }),
    );
    expect(t.mergeFields).toEqual(['firm.name', 'contact.first_name']);
    expect(t.createdBy).toEqual({ userId: me.id, name: 'Fake R56 me' });
    templateId = t.id;
    const dup = await call('post', '/templates', {
      categoryId,
      name: `Welcome ${run}`,
      channel: 'SMS',
      body: 'x',
    });
    expect([dup.status, codeOf(dup)]).toEqual([409, 'DUPLICATE_NAME']);
    const edited = AdminCommTemplate.parse(
      await ok('patch', `/templates/${t.id}`, { body: 'Hello {{contact.name}}' }),
    );
    expect(edited.mergeFields).toEqual(['firm.name', 'contact.name']);
    const copy = AdminCommTemplate.parse(await ok('post', `/templates/${t.id}/duplicate`));
    expect(copy).toMatchObject({ name: `Welcome ${run} (copy)`, status: 'INACTIVE' });
    const listed = ListAdminCommTemplatesResponse.parse(
      await ok('get', `/templates?categoryId=${categoryId}`),
    );
    expect(listed.total).toBe(2);
    expect(AdminCommTemplate.parse(await ok('post', `/templates/${copy.id}/archive`)).status).toBe(
      'ARCHIVED',
    );
    const after = ListAdminCommTemplatesResponse.parse(
      await ok('get', `/templates?categoryId=${categoryId}`),
    );
    expect(after.items.map((x) => x.id)).toEqual([t.id]);
    const archived = await call('post', '/messages', {
      contact: { type: 'TEAM', userId: mate.id },
      channel: 'EMAIL',
      subject: 's',
      body: 'b',
      templateId: copy.id,
      mode: 'DRAFT',
      idempotencyKey: key(),
    });
    expect([archived.status, codeOf(archived)]).toEqual([409, 'TEMPLATE_NOT_USABLE']);
  });

  it('previews with a contact or samples, and sends a test to me', async () => {
    const withFirm = AdminCommTemplatePreview.parse(
      await ok('post', `/templates/${templateId}/preview`, {
        contact: { type: 'FIRM', businessId: firm.id },
      }),
    );
    expect(withFirm).toEqual({
      subject: `Welcome ${firm.name}`,
      body: 'Hello Jordan Sample',
      missing: [],
    });
    const samples = AdminCommTemplatePreview.parse(
      await ok('post', `/templates/${templateId}/preview`, {}),
    );
    expect(samples.subject).toBe('Welcome Sample Tax Partners');
    expect(await ok('post', `/templates/${templateId}/test`, {})).toEqual({ sentTo: me.email });
    expect(sent.at(-1)).toMatchObject({
      to: me.email,
      data: { subject: '[Test] Welcome Sample Tax Partners' },
    });
    expect((await auditActions(templateId)).map((a) => a.action)).toContain(
      'comm_template.test_sent',
    );
  });

  it('refuses a template in an inactive category', async () => {
    await ok('patch', `/template-categories/${categoryId}`, { isActive: false });
    const res = await call('post', '/templates', {
      categoryId,
      name: `Late ${run}`,
      channel: 'SMS',
      body: 'Hi',
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'CATEGORY_INACTIVE']);
  });
});
