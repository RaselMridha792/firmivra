import { describe, expect, it } from 'vitest';
import {
  AttachmentDocumentIds,
  CreateMessageThreadRequest,
  createMessagesClient,
  createMyMessagesClient,
  createRequest,
  ListMessageThreadsQuery,
  ListMyMessageThreadsQuery,
  MessageBody,
  MessageSubject,
  NoteBody,
  SaveMyNoteRequest,
  SendMessageRequest,
  SetMyNoteReminderRequest,
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
const id2 = '0199b6a0-0000-7000-8000-000000000002';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('text limits', () => {
  it('subject: one line of 1-200 characters, trimmed', () => {
    expect(MessageSubject.parse('  Tax Return Update  ')).toBe('Tax Return Update');
    expect(MessageSubject.safeParse('x'.repeat(200)).success).toBe(true);
    for (const bad of ['', '   ', 'x'.repeat(201), 'Two\nlines', 'Tab\there']) {
      expect(MessageSubject.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('body and notes: several lines of 1-5000 characters', () => {
    expect(MessageBody.parse('Line one\nLine two\r\n\tindented')).toContain('\n');
    expect(MessageBody.safeParse('x'.repeat(5000)).success).toBe(true);
    expect(MessageBody.safeParse('x'.repeat(5001)).success).toBe(false);
    expect(NoteBody.safeParse('x'.repeat(5001)).success).toBe(false);
    expect(MessageBody.safeParse(' \n\t ').success).toBe(false);
  });

  it('refuses invisible, direction-changing and control characters like the other modules', () => {
    const ch = (code: number) => String.fromCodePoint(code);
    for (const bad of [
      `Pay ${ch(0x202e)}exe.pdf`,
      `zero${ch(0x200b)}width`,
      `nul${ch(0)}byte`,
      `bell${ch(7)}`,
      `tag${ch(0xe0041)}`,
      `lone ${String.fromCharCode(0xd800)} half`,
      ch(0x3164),
    ]) {
      expect(MessageBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(MessageSubject.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // Emoji with a variation selector and joiners stay allowed.
    const emoji = `${ch(0x2764)}${ch(0xfe0f)} ${ch(0x1f469)}${ch(0x200d)}${ch(0x1f4bc)}`;
    expect(MessageBody.safeParse(`Thanks ${emoji}`).success).toBe(true);
  });
});

describe('requests', () => {
  it('are strict: no clientId, businessId or sender in a body', () => {
    const body = { subject: 'Hello', body: 'Hi there' };
    expect(CreateMessageThreadRequest.safeParse(body).success).toBe(true);
    for (const extra of [{ clientId: id }, { businessId: id }, { direction: 'CLIENT_TO_FIRM' }]) {
      expect(CreateMessageThreadRequest.safeParse({ ...body, ...extra }).success).toBe(false);
    }
    expect(SendMessageRequest.safeParse({ body: 'x', senderUserId: id }).success).toBe(false);
  });

  it('attachments: at most 10 document ids, each once (any case)', () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `0199b6a0-0000-7000-8000-${String(i).padStart(12, '0')}`);
    expect(AttachmentDocumentIds.safeParse(ids(10)).success).toBe(true);
    expect(AttachmentDocumentIds.safeParse(ids(11)).success).toBe(false);
    expect(AttachmentDocumentIds.safeParse([id, id.toUpperCase()]).success).toBe(false);
    expect(AttachmentDocumentIds.safeParse(['not-a-uuid']).success).toBe(false);
  });

  it('list queries: flags from the query string, limits and filters', () => {
    expect(ListMessageThreadsQuery.parse({})).toEqual({ unreadOnly: false, limit: 25 });
    expect(ListMessageThreadsQuery.parse({ unreadOnly: 'true', limit: '5' })).toMatchObject({
      unreadOnly: true,
      limit: 5,
    });
    expect(ListMessageThreadsQuery.safeParse({ unreadOnly: 'yes' }).success).toBe(false);
    expect(ListMessageThreadsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListMessageThreadsQuery.safeParse({ direction: 'SIDEWAYS' }).success).toBe(false);
    expect(ListMessageThreadsQuery.safeParse({ search: 'a\u0000b' }).success).toBe(false);
    // The portal never takes a client id: the client comes from the session.
    expect(ListMyMessageThreadsQuery.safeParse({ clientId: id }).success).toBe(false);
  });

  it('reminders: in the future and within 5 years; null removes; left out keeps', () => {
    expect(SaveMyNoteRequest.safeParse({ body: 'Gather 1099s' }).success).toBe(true);
    expect(SaveMyNoteRequest.safeParse({ body: 'x', remindAt: inDays(3) }).success).toBe(true);
    expect(SaveMyNoteRequest.safeParse({ body: 'x', remindAt: null }).success).toBe(true);
    expect(SaveMyNoteRequest.safeParse({ body: 'x', remindAt: inDays(-1) }).success).toBe(false);
    expect(SaveMyNoteRequest.safeParse({ body: 'x', remindAt: inDays(5 * 370) }).success).toBe(
      false,
    );
    expect(SaveMyNoteRequest.safeParse({ body: 'x', remindAt: '2030-01-01' }).success).toBe(false);
    expect(SetMyNoteReminderRequest.safeParse({}).success).toBe(false);
    expect(SetMyNoteReminderRequest.safeParse({ remindAt: null }).success).toBe(true);
  });
});

describe('api.messages', () => {
  it('calls the firm routes', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createMessagesClient(request(fn));
    const ignore = () => undefined;
    await api.list({ clientId: id, unreadOnly: true }).catch(ignore);
    await api.unreadCount().catch(ignore);
    await api.get(id).catch(ignore);
    await api.create(id2, { subject: 'Hello', body: 'Hi' }).catch(ignore);
    await api.update(id, { repliesEnabled: false }).catch(ignore);
    await api.reply(id, { body: 'Thanks' }).catch(ignore);
    await api.markRead(id).catch(ignore);
    await api.markUnread(id).catch(ignore);
    await api.notes(id2).catch(ignore);
    await api.addNote(id2, { body: 'Called the client' }).catch(ignore);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET /api/v1/business/message-threads?clientId=${id}&unreadOnly=true&limit=25`,
      'GET /api/v1/business/message-threads/unread-count',
      `GET /api/v1/business/message-threads/${id}`,
      `POST /api/v1/business/clients/${id2}/message-threads`,
      `PATCH /api/v1/business/message-threads/${id}`,
      `POST /api/v1/business/message-threads/${id}/messages`,
      `POST /api/v1/business/message-threads/${id}/read`,
      `POST /api/v1/business/message-threads/${id}/unread`,
      `GET /api/v1/business/clients/${id2}/notes?limit=25`,
      `POST /api/v1/business/clients/${id2}/notes`,
    ]);
  });

  it('rejects bad input before sending', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createMessagesClient(request(fn));
    for (const call of [
      () => api.get('nope'),
      () => api.create(id, { subject: '', body: 'x' }),
      () => api.reply(id, { body: 'x'.repeat(5001) }),
      () => api.addNote(id, { body: ' ' }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
  });
});

describe('api.myMessages(slug)', () => {
  it('calls the portal routes of the signed-in client, never with a client id', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createMyMessagesClient(request(fn), 'lvp');
    const ignore = () => undefined;
    await api.list({ direction: 'FIRM_TO_CLIENT' }).catch(ignore);
    await api.unreadCount().catch(ignore);
    await api.get(id).catch(ignore);
    await api.start({ subject: 'Question', body: 'Hi' }).catch(ignore);
    await api.reply(id, { body: 'Thanks' }).catch(ignore);
    await api.markRead(id).catch(ignore);
    await api.markUnread(id).catch(ignore);
    await api.notepad().catch(ignore);
    await api.saveNote({ body: 'Gather 1099s' }).catch(ignore);
    await api.setReminder({ remindAt: null }).catch(ignore);
    const base = '/api/v1/portal/lvp/me';
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${base}/message-threads?unreadOnly=false&direction=FIRM_TO_CLIENT&limit=25`,
      `GET ${base}/message-threads/unread-count`,
      `GET ${base}/message-threads/${id}`,
      `POST ${base}/message-threads`,
      `POST ${base}/message-threads/${id}/messages`,
      `POST ${base}/message-threads/${id}/read`,
      `POST ${base}/message-threads/${id}/unread`,
      `GET ${base}/notes`,
      `PUT ${base}/notes`,
      `PUT ${base}/notes/reminder`,
    ]);
  });

  it('a bad slug or id rejects, never throws', async () => {
    const { fn, calls } = fakeFetch({});
    await expect(createMyMessagesClient(request(fn), 'Bad Slug!').notepad()).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(createMyMessagesClient(request(fn), 'lvp').get('1')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(calls).toEqual([]);
  });
});
