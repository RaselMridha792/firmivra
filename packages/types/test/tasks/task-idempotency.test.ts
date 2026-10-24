// Idempotency keys on the Tasks module's saves that create something (R1, Oct 24; contract in
// packages/types/src/tasks): an optional uuid in the body of Create Task (both clients), Save as
// Draft, Duplicate (a new optional body), Set Up Recurring Task and Convert to Recurring; never on
// a change or on publishing a draft; 409 IDEMPOTENCY_KEY_REUSED for another use of a key. The
// clients send it in the body, never in a header, and refuse a bad one before sending anything.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ConvertToRecurringRequest,
  CreateTaskDetailRequest,
  CreateTaskRequest,
  createRequest,
  createTasksClient,
  createTaskWorkClient,
  CreateTaskSeriesRequest,
  DuplicateTaskRequest,
  PublishTaskDraftRequest,
  SaveTaskDraftRequest,
  TaskWorkErrorCode,
  UpdateTaskDetailRequest,
  UpdateTaskDraftRequest,
  UpdateTaskRequest,
  UpdateTaskSeriesRequest,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';
const key = '0199c0e0-0a00-7000-8000-0000000000aa';
const valid = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

/** Records each call; its answer is not what these tests read (they read what was sent). */
function fakeFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const sent = (call: { url: string; init: RequestInit } | undefined) => ({
  url: call?.url,
  method: call?.init.method,
  body: JSON.parse(String(call?.init.body ?? 'null')) as unknown,
});

describe('the key on the saves that create something', () => {
  const creating: [string, z.ZodType, Record<string, unknown>][] = [
    ['Create Task', CreateTaskDetailRequest, { clientId: id, title: 'Prepare return' }],
    ['Create Task (older contract)', CreateTaskRequest, { clientId: id, title: 'Call back' }],
    ['Save as Draft', SaveTaskDraftRequest, { title: 'Plan' }],
    [
      'Set Up Recurring Task',
      CreateTaskSeriesRequest,
      {
        clientId: id,
        title: 'Monthly close',
        recurrence: { unit: 'MONTH', startOn: '2026-11-01' },
      },
    ],
    ['Convert to Recurring', ConvertToRecurringRequest, { recurrence: { unit: 'MONTH' } }],
  ];

  it.each(creating)('%s: an optional uuid, kept as sent', (_, schema, body) => {
    // Optional: every body sent before keys existed is still valid.
    expect(valid(schema, body)).toBe(true);
    expect(schema.parse({ ...body, idempotencyKey: key })).toMatchObject({ idempotencyKey: key });
    expect(schema.parse({ ...body, idempotencyKey: key.toUpperCase() })).toMatchObject({
      idempotencyKey: key.toUpperCase(),
    });
    for (const bad of ['', 'retry-1', `${key}x`, 42, null]) {
      expect(valid(schema, { ...body, idempotencyKey: bad }), String(bad)).toBe(false);
    }
  });

  it('Duplicate takes no body, an empty one or a key, and nothing else', () => {
    expect(DuplicateTaskRequest.parse(undefined)).toBeUndefined();
    expect(DuplicateTaskRequest.parse({})).toEqual({});
    expect(DuplicateTaskRequest.parse({ idempotencyKey: key })).toEqual({ idempotencyKey: key });
    for (const bad of [{ idempotencyKey: 'copy-1' }, { title: 'Copy' }, null, 'key']) {
      expect(valid(DuplicateTaskRequest, bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is refused on every change and on publishing a draft (they change a record that exists)', () => {
    const changes: [z.ZodType, Record<string, unknown>][] = [
      [UpdateTaskDetailRequest, { title: 'Renamed' }],
      [UpdateTaskRequest, { title: 'Renamed' }],
      [UpdateTaskDraftRequest, { title: 'Renamed' }],
      [PublishTaskDraftRequest, {}],
      [UpdateTaskSeriesRequest, { scope: 'FUTURE', version: 'v1', title: 'Renamed' }],
    ];
    for (const [schema, body] of changes) {
      expect(valid(schema, body)).toBe(true);
      expect(valid(schema, { ...body, idempotencyKey: key })).toBe(false);
    }
  });

  it('another use of a key has its own error code', () => {
    expect(TaskWorkErrorCode.options).toContain('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('the clients send it in the body', () => {
  it('createTaskWorkClient: Create, Save as Draft, Duplicate, Set Up Recurring and Convert', async () => {
    const f = fakeFetch();
    const client = createTaskWorkClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    const recurrence = { unit: 'MONTH' as const };
    const calls = [
      () => client.create({ clientId: id, title: 'T', idempotencyKey: key }),
      () => client.saveDraft({ title: 'T', idempotencyKey: key }),
      () => client.duplicate(id, { idempotencyKey: key }),
      () => client.duplicate(id),
      () =>
        client.createSeries({
          clientId: id,
          title: 'T',
          recurrence: { ...recurrence, startOn: '2026-11-01' },
          idempotencyKey: key,
        }),
      () => client.convertToRecurring(id, { recurrence, idempotencyKey: key }),
    ];
    for (const call of calls) await call().catch(() => undefined);
    expect(f.calls.map(sent)).toEqual([
      {
        url: '/api/v1/business/tasks',
        method: 'POST',
        body: { clientId: id, title: 'T', idempotencyKey: key },
      },
      {
        url: '/api/v1/business/tasks/drafts',
        method: 'POST',
        body: { title: 'T', idempotencyKey: key },
      },
      {
        url: `/api/v1/business/tasks/${id}/duplicate`,
        method: 'POST',
        body: { idempotencyKey: key },
      },
      // Without a key, an empty body: the copy is made as before.
      { url: `/api/v1/business/tasks/${id}/duplicate`, method: 'POST', body: {} },
      {
        url: '/api/v1/business/task-series',
        method: 'POST',
        body: expect.objectContaining({ idempotencyKey: key }) as unknown,
      },
      {
        url: `/api/v1/business/tasks/${id}/convert-to-recurring`,
        method: 'POST',
        body: expect.objectContaining({ idempotencyKey: key }) as unknown,
      },
    ]);
    // In the body only: no header carries it.
    for (const call of f.calls) {
      expect(JSON.stringify(call.init.headers)).not.toMatch(/idempotency/i);
    }
  });

  it('createTasksClient: the older Create Task too', async () => {
    const f = fakeFetch();
    const client = createTasksClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.create({ clientId: id, title: 'Call back', idempotencyKey: key }).catch(() => 0);
    expect(f.calls.map(sent)).toEqual([
      {
        url: '/api/v1/business/tasks',
        method: 'POST',
        body: { clientId: id, title: 'Call back', idempotencyKey: key },
      },
    ]);
  });

  it('refuses a bad key, or a key on a change or a publish, before sending anything', async () => {
    const f = fakeFetch();
    const client = createTaskWorkClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    const refused = [
      () => client.create({ clientId: id, title: 'T', idempotencyKey: 'retry-1' }),
      () => client.duplicate(id, { idempotencyKey: 'copy-1' }),
      () => client.update(id, { title: 'T', idempotencyKey: key } as never),
      () => client.updateDraft(id, { title: 'T', idempotencyKey: key } as never),
      () => client.publishDraft(id, { idempotencyKey: key } as never),
    ];
    for (const call of refused) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(f.calls).toHaveLength(0);
  });
});
