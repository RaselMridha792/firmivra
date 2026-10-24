import { describe, expect, it } from 'vitest';
import {
  createRequest,
  createTaskWorkClient,
  PublishTaskDraftRequest,
  SaveTaskDraftRequest,
  TaskDraft,
  TaskDraftQuery,
  UpdateTaskDraftRequest,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';
const other = '0199c0e0-0a00-7000-8000-000000000002';

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const draft = {
  id,
  title: 'Prepare plan',
  client: null,
  type: null,
  service: null,
  priority: 'MEDIUM',
  dueOn: null,
  assignedTo: null,
  createdBy: { userId: other, name: 'Sam Sample' },
  missing: ['clientId'],
  createdAt: '2026-10-24T10:00:00.000Z',
  updatedAt: '2026-10-24T10:00:00.000Z',
  status: 'DRAFT',
  details: null,
  engagement: null,
  progress: 'PENDING',
  startOn: null,
  dueTime: null,
  allDay: true,
  clientVisible: false,
  internalNotes: null,
  blockedReason: null,
  assignedUserId: null,
  additionalAssignees: [],
  checklistItems: [],
  reminders: [],
  attachments: [],
  dependsOn: null,
  templateId: null,
  version: '2026-10-24T10:00:00.000Z',
};

describe('Task drafts contract: requests', () => {
  it('Save as Draft needs only a title; the client may come later', () => {
    expect(SaveTaskDraftRequest.safeParse({ title: 'Prepare plan' }).success).toBe(true);
    expect(SaveTaskDraftRequest.safeParse({ title: ' ' }).success).toBe(false);
    expect(SaveTaskDraftRequest.safeParse({}).success).toBe(false);
    expect(
      SaveTaskDraftRequest.safeParse({ title: 'T', clientId: id, engagementId: other }).success,
    ).toBe(true);
  });

  it('without a client a draft takes no engagement or attachment', () => {
    for (const body of [
      { title: 'T', engagementId: other },
      { title: 'T', attachments: [{ documentId: other }] },
    ]) {
      const r = SaveTaskDraftRequest.safeParse(body);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(['clientId']);
    }
    const cleared = UpdateTaskDraftRequest.safeParse({ clientId: null, engagementId: other });
    expect(cleared.success).toBe(false);
    expect(UpdateTaskDraftRequest.safeParse({ clientId: null }).success).toBe(true);
  });

  it('a draft takes Custom reminders before it has a due time; the rule shape still holds', () => {
    const custom = [{ amount: 30, unit: 'MINUTES' }, { daysBefore: 1 }];
    expect(SaveTaskDraftRequest.safeParse({ title: 'T', reminders: custom }).success).toBe(true);
    expect(UpdateTaskDraftRequest.safeParse({ reminders: custom }).success).toBe(true);
    expect(PublishTaskDraftRequest.safeParse({ reminders: custom }).success).toBe(true);
    expect(
      SaveTaskDraftRequest.safeParse({ title: 'T', reminders: [{ amount: 30 }] }).success,
    ).toBe(false);
  });

  it('requests are strict and a draft is never given a status', () => {
    expect(SaveTaskDraftRequest.safeParse({ title: 'T', businessId: id }).success).toBe(false);
    expect(UpdateTaskDraftRequest.safeParse({ status: 'OPEN' }).success).toBe(false);
    expect(PublishTaskDraftRequest.safeParse({ status: 'DONE' }).success).toBe(false);
  });

  it('an edit changes something; publishing may send nothing', () => {
    expect(UpdateTaskDraftRequest.safeParse({}).success).toBe(false);
    expect(UpdateTaskDraftRequest.safeParse({ version: 'v1' }).success).toBe(false);
    expect(UpdateTaskDraftRequest.safeParse({ title: 'New', version: 'v1' }).success).toBe(true);
    expect(PublishTaskDraftRequest.safeParse({}).success).toBe(true);
    expect(
      PublishTaskDraftRequest.safeParse({ clientId: id, dueOn: '2026-11-01', version: 'v1' })
        .success,
    ).toBe(true);
  });

  it('the Drafts query has defaults and reads "true" from the query string', () => {
    const q = TaskDraftQuery.parse({ mine: 'true' });
    expect(q).toMatchObject({ mine: true, sort: 'updated', direction: 'desc', page: 1 });
    expect(TaskDraftQuery.safeParse({ status: 'DRAFT' }).success).toBe(false);
  });

  it('a draft response may lack its client and says what publishing needs', () => {
    expect(TaskDraft.parse(draft).missing).toEqual(['clientId']);
    expect(TaskDraft.safeParse({ ...draft, status: 'OPEN' }).success).toBe(false);
  });
});

describe('createTaskWorkClient: drafts', () => {
  it('calls the draft routes and never sends a business id', async () => {
    const f = fakeFetch({ items: [draft], total: 1, page: 1, pageSize: 10 });
    const client = createTaskWorkClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    const page = await client.drafts({ search: 'plan', priority: 'HIGH' });
    expect(page.items[0]?.client).toBeNull();
    const url = f.calls[0]?.url ?? '';
    expect(url.startsWith('/api/v1/business/tasks/drafts?')).toBe(true);
    for (const part of ['search=plan', 'priority=HIGH', 'sort=updated', 'direction=desc']) {
      expect(url).toContain(part);
    }

    const one = fakeFetch(draft);
    const c2 = createTaskWorkClient(createRequest({ fetch: one.fn, baseUrl: '/api/v1' }));
    await c2.saveDraft({ title: 'Prepare plan' });
    await c2.updateDraft(id, { title: 'Prepare plan, v2' });
    await c2.discardDraft(id).catch(() => undefined);
    expect(one.calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', '/api/v1/business/tasks/drafts'],
      ['PATCH', `/api/v1/business/tasks/drafts/${id}`],
      ['DELETE', `/api/v1/business/tasks/drafts/${id}`],
    ]);
    expect(JSON.stringify([f.calls, one.calls])).not.toMatch(/businessId|x-business-id/i);
  });

  it('publishes at the draft and answers the task; refuses bad input before sending', async () => {
    const f = fakeFetch({});
    const client = createTaskWorkClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.publishDraft(id).catch(() => undefined);
    expect(f.calls[0]?.url).toBe(`/api/v1/business/tasks/drafts/${id}/publish`);
    expect(f.calls[0]?.init.method).toBe('POST');

    const g = fakeFetch({});
    const c2 = createTaskWorkClient(createRequest({ fetch: g.fn, baseUrl: '/api/v1' }));
    await expect(c2.draft('not-an-id')).rejects.toMatchObject({ status: 400 });
    await expect(c2.saveDraft({ title: 'T', engagementId: other })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(g.calls).toHaveLength(0);
  });
});
