import { describe, expect, it } from 'vitest';
import {
  createClientNotesClient,
  createMessagesClient,
  createMyMessagesClient,
  createMyNotesClient,
  createRequest,
  ListMyMessagesQuery,
  SaveMyNoteRequest,
} from '../../src/index.js';

function fakeFetch(body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6a0-0000-7000-8000-000000000001';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const routes = (calls: { method: string; url: string }[]) =>
  calls.map((c) => `${c.method} ${c.url}`);

describe('api.messages and api.clientNotes', () => {
  it('uses the firm routes; read state has its own POSTs', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createMessagesClient(request(fn));
    const notes = createClientNotesClient(request(fn));
    for (const call of [
      () => api.inbox({ unread: 'true', search: 'deduction' }),
      () => api.listForClient(id),
      () => api.get(id),
      () => api.create(id, { subject: 'Hello', body: 'Hi' }),
      () => api.send(id, { body: 'Hi' }),
      () => api.update(id, { repliesEnabled: false }),
      () => api.markRead(id),
      () => api.markUnread(id),
      () => api.unreadCount(),
      () => notes.list(id, { engagementId: id }),
      () => notes.create(id, { body: 'Note' }),
      () => notes.update(id, { body: 'Note' }),
      () => notes.remove(id),
    ])
      await call().catch(() => undefined);
    expect(routes(calls)).toEqual([
      'GET /api/v1/business/message-threads?search=deduction&unread=true&limit=25',
      `GET /api/v1/business/clients/${id}/message-threads?limit=25`,
      `GET /api/v1/business/message-threads/${id}`,
      `POST /api/v1/business/clients/${id}/message-threads`,
      `POST /api/v1/business/message-threads/${id}/messages`,
      `PATCH /api/v1/business/message-threads/${id}`,
      `POST /api/v1/business/message-threads/${id}/read`,
      `POST /api/v1/business/message-threads/${id}/unread`,
      'GET /api/v1/business/message-threads/unread-count',
      `GET /api/v1/business/clients/${id}/notes?engagementId=${id}`,
      `POST /api/v1/business/clients/${id}/notes`,
      `PATCH /api/v1/business/notes/${id}`,
      `DELETE /api/v1/business/notes/${id}`,
    ]);
  });

  it('checks the database limits before sending', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createMessagesClient(request(fn));
    for (const call of [
      () => api.create(id, { subject: ' ', body: 'Hi' }),
      () => api.create(id, { subject: 'x'.repeat(201), body: 'Hi' }),
      () => api.send(id, { body: 'x'.repeat(10_001) }),
      () => api.create(id, { subject: 'Hi', body: 'Hi', related: { type: 'Bad-Type', id } }),
      () => api.get('not-a-uuid'),
    ])
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });
});

describe('api.myMessages and api.myNotes', () => {
  it('stays under the signed-in client; no client id anywhere', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createMyMessagesClient(request(fn), 'lvp');
    const notes = createMyNotesClient(request(fn), 'lvp');
    for (const call of [
      () => api.list({ filter: 'from-firm' }),
      () => api.create({ subject: 'Question', body: 'Hi' }),
      () => api.reply(id, { body: 'Hi' }),
      () => api.get(id),
      () => api.markRead(id),
      () => api.markUnread(id),
      () => api.unreadCount(),
      () => notes.get(),
      () => notes.save({ body: 'Remember the 1099s', remindAt: null }),
      () => notes.setReminder({ remindAt: '2999-01-01T00:00:00Z' }),
      () => notes.removeReminder(),
    ])
      await call().catch(() => undefined);
    expect(routes(calls)).toEqual([
      'GET /api/v1/portal/lvp/me/messages?filter=from-firm&limit=25',
      'POST /api/v1/portal/lvp/me/messages',
      `POST /api/v1/portal/lvp/me/messages/${id}/messages`,
      `GET /api/v1/portal/lvp/me/messages/${id}`,
      `POST /api/v1/portal/lvp/me/messages/${id}/read`,
      `POST /api/v1/portal/lvp/me/messages/${id}/unread`,
      'GET /api/v1/portal/lvp/me/messages/unread-count',
      'GET /api/v1/portal/lvp/me/notes',
      'PUT /api/v1/portal/lvp/me/notes',
      'PUT /api/v1/portal/lvp/me/notes/reminder',
      'DELETE /api/v1/portal/lvp/me/notes/reminder',
    ]);
    for (const c of calls) expect(JSON.stringify(c.body ?? {})).not.toContain('clientId');
  });

  it('refuses a reminder in the past, a long note and an unknown filter', () => {
    expect(
      SaveMyNoteRequest.safeParse({ body: 'x', remindAt: '2020-01-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(SaveMyNoteRequest.safeParse({ body: 'x'.repeat(5001) }).success).toBe(false);
    expect(SaveMyNoteRequest.safeParse({ body: 'x' }).success).toBe(true);
    expect(ListMyMessagesQuery.safeParse({ filter: 'mine' }).success).toBe(false);
  });
});
