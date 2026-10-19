import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createAdminSupportClient,
  createRequest,
  CreateSupportTicketRequest,
  SUPPORT_ERRORS,
  SupportErrorCode,
  SupportSettings,
  type SupportTicket,
  SupportTicketDetail,
  SupportTicketsQuery,
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

const id = (n: number) => `0199c1a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-19T09:00:00.000Z';
const client = (fn: typeof fetch) =>
  createAdminSupportClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

/** A synthetic ticket as the API answers it. */
const ticket = (): SupportTicket => ({
  id: id(1),
  number: 1001,
  subject: 'Cannot upload a W-2',
  status: 'OPEN',
  source: 'EMAIL',
  priority: { id: id(2), name: 'High', color: 'orange', rank: 2, active: true },
  category: { id: id(3), name: 'Document Filing', active: true },
  firm: { id: id(4), name: 'Sample Tax Partners' },
  contact: { id: id(5), name: 'Avery Example', email: 'avery@example.test', phone: '' },
  assignee: null,
  createdBy: { name: 'Avery Example', role: 'CLIENT' },
  createdAt: at,
  updatedAt: at,
  firstResponseAt: null,
  resolvedAt: null,
  closedAt: null,
  sla: { state: 'WITHIN', dueAt: '2026-10-19T13:00:00.000Z', minutesLeft: 240 },
  escalation: null,
  mergedInto: null,
  counts: { messages: 1, attachments: 0, notes: 0 },
  version: 1,
});

describe('admin support client', () => {
  it('sends several filter values as one comma-separated parameter', async () => {
    const { fn, calls } = fakeFetch(200, { items: [ticket()], total: 1, page: 1, pageSize: 10 });
    const page = await client(fn).tickets({
      tab: 'OVERDUE',
      statuses: ['OPEN', 'IN_PROGRESS'],
      priorityIds: [id(2)],
      search: '  w-2 ',
      page: 2,
    });
    expect(page.items[0]?.number).toBe(1001);
    const url = new URL(calls[0]!.url, 'http://x');
    expect(url.pathname).toBe('/api/v1/admin/support/tickets');
    expect(url.searchParams.get('statuses')).toBe('OPEN,IN_PROGRESS');
    expect(url.searchParams.get('priorityIds')).toBe(id(2));
    expect(url.searchParams.get('search')).toBe('w-2');
    expect(url.searchParams.get('tab')).toBe('OVERDUE');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('categoryIds')).toBe(false);
  });

  it('reads the comma-separated form back as a list (the API parses the same schema)', () => {
    const parsed = SupportTicketsQuery.parse({ statuses: 'OPEN,RESOLVED', page: '3' });
    expect(parsed.statuses).toEqual(['OPEN', 'RESOLVED']);
    expect(parsed.page).toBe(3);
    expect(SupportTicketsQuery.safeParse({ statuses: 'OPEN,ESCALATED' }).success).toBe(false);
    expect(SupportTicketsQuery.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('creates a ticket with the defaults filled in', async () => {
    const { fn, calls } = fakeFetch(201, ticket());
    await client(fn).createTicket({
      requestId: id(9),
      firmId: id(4),
      contactId: id(5),
      subject: ' Cannot upload a W-2 ',
      categoryId: id(3),
      priorityId: id(2),
      assignTo: 'QUEUE',
      status: 'OPEN',
      source: 'EMAIL',
      description: 'The upload stops at 90%.',
    });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/support/tickets' });
    expect(calls[0]!.body).toEqual({
      requestId: id(9),
      firmId: id(4),
      contactId: id(5),
      subject: 'Cannot upload a W-2',
      categoryId: id(3),
      priorityId: id(2),
      assignTo: 'QUEUE',
      status: 'OPEN',
      source: 'EMAIL',
      description: 'The upload stops at 90%.',
      uploadTokens: [],
      internalNote: '',
      notifyAssignee: true,
    });
  });

  it('refuses a bad ticket before sending anything', async () => {
    const { fn, calls } = fakeFetch(201, ticket());
    const base: CreateSupportTicketRequest = {
      requestId: id(9),
      firmId: id(4),
      contactId: id(5),
      subject: 'x',
      categoryId: id(3),
      priorityId: id(2),
      assignTo: 'AUTO',
      status: 'OPEN',
      source: 'PHONE',
      description: 'x',
    };
    await expect(client(fn).createTicket({ ...base, subject: '   ' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(
      client(fn).createTicket({ ...base, status: 'RESOLVED' as 'OPEN' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(client(fn).createTicket({ ...base, assignTo: 'someone' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      client(fn).createTicket({ ...base, uploadTokens: Array.from({ length: 11 }, () => 't') }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });

  it('changes a ticket with its version and needs something to change', async () => {
    const { fn, calls } = fakeFetch(200, ticket());
    await client(fn).updateTicket(id(1), { version: 3, status: 'RESOLVED' });
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: `/api/v1/admin/support/tickets/${id(1)}`,
      body: { version: 3, status: 'RESOLVED' },
    });
    await expect(client(fn).updateTicket(id(1), { version: 3 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      client(fn).updateTicket('not-a-uuid', { version: 1, status: 'OPEN' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('posts the ticket actions to their own paths', async () => {
    const { fn, calls } = fakeFetch(200, ticket());
    const api = client(fn);
    await api.assign(id(1), { version: 1, assignTo: id(7) });
    await api.escalate(id(1), { version: 2, reason: 'Firm cannot file' });
    await api.merge(id(1), { version: 3, sourceId: id(8) });
    await api.reply(id(1), { mode: 'NOTE', body: 'Checked the logs' });
    await api.addAttachments(id(1), { uploadTokens: ['token'] });
    expect(
      calls.map(
        (c) => `${c.method} ${c.url.replace(`/api/v1/admin/support/tickets/${id(1)}`, '')}`,
      ),
    ).toEqual([
      'POST /assign',
      'POST /escalate',
      'POST /merge',
      'POST /replies',
      'POST /attachments',
    ]);
    expect(calls[0]!.body).toEqual({ version: 1, assignTo: id(7), notify: true });
    expect(calls[3]!.body).toEqual({
      mode: 'NOTE',
      body: 'Checked the logs',
      sendToClient: true,
      uploadTokens: [],
    });
    await expect(api.addAttachments(id(1), { uploadTokens: [] })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it('deletes with the version in the query, and links a file', async () => {
    const { fn, calls } = fakeFetch(200, { ok: true });
    await client(fn).deleteTicket(id(1), { version: 5 });
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: `/api/v1/admin/support/tickets/${id(1)}?version=5`,
    });
    const link = fakeFetch(200, { url: 'https://files.example.test/x', expiresAt: at });
    await client(link.fn).attachmentLink(id(1), id(6));
    expect(link.calls[0]!.url).toBe(
      `/api/v1/admin/support/tickets/${id(1)}/attachments/${id(6)}/download`,
    );
  });

  it('asks where to upload a file of a checked type and size', async () => {
    const { fn, calls } = fakeFetch(200, {
      uploadToken: 'opaque',
      url: 'https://files.example.test/put',
      method: 'PUT',
      headers: {},
      expiresAt: at,
    });
    const body = {
      firmId: id(4),
      fileName: 'w2.pdf',
      contentType: 'application/pdf' as const,
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    };
    await client(fn).createUpload(body);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/support/uploads', body });
    await expect(
      client(fn).createUpload({ ...body, sizeBytes: 10 * 1024 * 1024 + 1 }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      client(fn).createUpload({ ...body, contentType: 'text/csv' as 'application/pdf' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('creates or changes settings rows by whether an id is given', async () => {
    const category = { id: id(3), name: 'Billing', description: '', active: true };
    const { fn, calls } = fakeFetch(200, category);
    const api = client(fn);
    await api.saveCategory({ name: 'Billing' });
    await api.saveCategory({ id: id(3), name: 'Billing', description: 'Invoices' });
    await api.setCategoryActive(id(3), false);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/v1/admin/support/settings/categories', { name: 'Billing', description: '' }],
      [
        'PATCH',
        `/api/v1/admin/support/settings/categories/${id(3)}`,
        { name: 'Billing', description: 'Invoices' },
      ],
      ['PUT', `/api/v1/admin/support/settings/categories/${id(3)}/active`, { active: false }],
    ]);
  });

  it('checks the settings forms before sending', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = client(fn);
    const days = Array.from({ length: 7 }, (_, day) => ({
      day,
      open: day > 0 && day < 6,
      start: '09:00',
      end: '17:00',
    }));
    await expect(
      api.saveBusinessHours({ timeZone: 'Europe/Paris', days, clock: 'BUSINESS' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.saveBusinessHours({
        timeZone: 'America/Chicago',
        days: days.slice(1),
        clock: 'BUSINESS',
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.savePriority({
        name: 'Urgent',
        color: 'red',
        target: { amount: 0, unit: 'HOURS' },
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.saveAssignment({
        defaultQueue: true,
        roundRobin: true,
        reassign: true,
        reassignAfterHours: 73,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
    const hours = { timeZone: 'America/Chicago', days, clock: 'CALENDAR' as const };
    const saved = fakeFetch(200, { ...hours, holidays: [] });
    await client(saved.fn).saveBusinessHours(hours);
    expect(saved.calls[0]).toMatchObject({
      method: 'PUT',
      url: '/api/v1/admin/support/settings/business-hours',
      body: hours,
    });
  });

  it('reads Ticket Detail and the settings in the documented shape', () => {
    const detail = SupportTicketDetail.parse({
      ...ticket(),
      description: 'The upload stops at 90%.',
      messages: [
        {
          id: id(10),
          author: { name: 'Avery Example', role: 'CLIENT' },
          body: 'The upload stops at 90%.',
          at,
          attachments: [],
          sentToClient: true,
          mergedFrom: null,
        },
      ],
      notes: [],
      attachments: [],
      activity: [
        { id: id(11), type: 'CREATED', at, actor: 'System', from: null, to: null, note: null },
      ],
      somethingNew: 'dropped',
    });
    expect(detail).not.toHaveProperty('somethingNew');
    expect(
      SupportSettings.shape.permissions.safeParse({ OWNER: [], LEAD: [], AGENT: [] }).success,
    ).toBe(true);
  });

  it('has a message for every error code', () => {
    for (const code of SupportErrorCode.options) expect(SUPPORT_ERRORS[code]).toBeTruthy();
  });
});
