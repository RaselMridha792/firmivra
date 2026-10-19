import { describe, expect, it } from 'vitest';
import {
  ADMIN_COMM_ERRORS,
  ADMIN_COMM_MERGE_FIELDS,
  ADMIN_COMM_SMS_MAX,
  AdminCommErrorCode,
  createAdminCommunicationsClient,
  CreateAdminCommMessageRequest,
  CreateAdminCommTemplateRequest,
  createRequest,
  UpdateAdminCommConversationRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199c2a0-0000-7000-8000-000000000001';
const key = '0199c2a0-0000-7000-8000-0000000000aa';
const firm = '0199c2a0-0000-7000-8000-0000000000b1';
const client = (fn: typeof fetch) =>
  createAdminCommunicationsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
const ok = (body: Partial<CreateAdminCommMessageRequest>) =>
  CreateAdminCommMessageRequest.safeParse({
    contact: { type: 'FIRM', businessId: firm },
    channel: 'EMAIL',
    subject: 'Welcome',
    body: 'Hello',
    mode: 'SEND',
    idempotencyKey: key,
    ...body,
  }).success;

describe('admin communications contract', () => {
  it('lists conversations with the tab, defaults and filters in the query', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 25 });
    await client(fn).conversations.list({ view: 'MENTIONS', channel: 'SMS', search: 'ridge' });
    expect(calls[0]?.url).toContain('/api/v1/admin/communications/conversations?');
    for (const part of ['view=MENTIONS', 'channel=SMS', 'search=ridge', 'sort=NEWEST', 'page=1'])
      expect(calls[0]?.url).toContain(part);
  });

  it('needs a conversation or a contact, never both', () => {
    expect(ok({})).toBe(true);
    expect(ok({ contact: undefined })).toBe(false);
    expect(ok({ conversationId: id })).toBe(false);
    expect(ok({ contact: undefined, conversationId: id })).toBe(true);
  });

  it('knows the channels’ rules: subject, SMS length, Cc, notes and schedules', () => {
    expect(ok({ subject: undefined })).toBe(false);
    expect(ok({ subject: undefined, mode: 'DRAFT' })).toBe(true);
    expect(
      ok({ channel: 'SMS', subject: undefined, body: 'x'.repeat(ADMIN_COMM_SMS_MAX + 1) }),
    ).toBe(false);
    expect(ok({ channel: 'SMS', cc: ['a@example.test'] })).toBe(false);
    expect(ok({ channel: 'INTERNAL', mode: 'DRAFT' })).toBe(false);
    expect(ok({ mode: 'SCHEDULE' })).toBe(false);
    expect(
      ok({
        mode: 'SCHEDULE',
        scheduledAt: '2099-01-01T15:00:00.000Z',
        scheduledTimeZone: 'America/New_York',
      }),
    ).toBe(true);
  });

  it('a contact is a record reference, never typed details', () => {
    expect(ok({ contact: { type: 'LEAD', salesContactId: firm } })).toBe(true);
    expect(
      ok({
        contact: { type: 'FIRM', email: 'x@example.test' } as unknown as {
          type: 'FIRM';
          businessId: string;
        },
      }),
    ).toBe(false);
  });

  it('posts message actions to their routes and deletes drafts', async () => {
    const msg = { ok: true };
    const { fn, calls } = fakeFetch(200, msg);
    const c = client(fn);
    await c.messages.remove(id);
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: `/api/v1/admin/communications/messages/${id}`,
    });
    await expect(c.messages.send('nope', { idempotencyKey: key })).rejects.toMatchObject({
      status: 400,
    });
    expect(calls).toHaveLength(1);
  });

  it('checks templates: an email needs a subject, a text has none', () => {
    const t = (b: object) =>
      CreateAdminCommTemplateRequest.safeParse({
        categoryId: id,
        name: 'Welcome',
        channel: 'EMAIL',
        subject: 'Hi',
        body: 'Hello {{contact.first_name}}',
        ...b,
      }).success;
    expect(t({})).toBe(true);
    expect(t({ subject: undefined })).toBe(false);
    expect(t({ channel: 'SMS' })).toBe(false);
    expect(t({ channel: 'SMS', subject: undefined })).toBe(true);
  });

  it('updates a conversation only with something to change, and caps the tags', () => {
    expect(UpdateAdminCommConversationRequest.safeParse({}).success).toBe(false);
    expect(UpdateAdminCommConversationRequest.safeParse({ assignedToUserId: null }).success).toBe(
      true,
    );
    expect(
      UpdateAdminCommConversationRequest.safeParse({ tags: Array(21).fill('vip') }).success,
    ).toBe(false);
  });

  it('has a message per error code and a sample per merge field', () => {
    for (const code of AdminCommErrorCode.options) expect(ADMIN_COMM_ERRORS[code]).toBeTruthy();
    for (const f of Object.values(ADMIN_COMM_MERGE_FIELDS)) expect(f.sample).toBeTruthy();
  });
});
