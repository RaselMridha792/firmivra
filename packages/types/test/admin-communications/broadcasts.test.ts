import { describe, expect, it } from 'vitest';
import {
  ADMIN_COMM_BROADCAST_ERRORS,
  AdminCommBroadcastErrorCode,
  AdminCommSegmentDefinition,
  CreateAdminCommMediaRequest,
  createAdminBroadcastsClient,
  createRequest,
  ListAdminCommBroadcastsQuery,
  UpdateAdminCommBroadcastRequest,
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

const id = '0199c3a0-0000-7000-8000-000000000001';
const client = (fn: typeof fetch) =>
  createAdminBroadcastsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('admin broadcasts contract', () => {
  it('lists with filters and reads archived as a boolean', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 25 });
    await client(fn).broadcasts.list({ status: 'SCHEDULED', channel: 'SMS' });
    expect(calls[0]?.url).toContain('/api/v1/admin/communications/broadcasts?');
    expect(calls[0]?.url).toContain('status=SCHEDULED');
    expect(ListAdminCommBroadcastsQuery.parse({ archived: 'true' }).archived).toBe(true);
    expect(ListAdminCommBroadcastsQuery.parse({}).archived).toBe(false);
  });

  it('checks channel content: subjects, SMS length, files and each channel once', () => {
    const ok = (channels: unknown) =>
      UpdateAdminCommBroadcastRequest.safeParse({ channels }).success;
    expect(ok([{ channel: 'EMAIL', subject: 'News', body: 'Hello' }])).toBe(true);
    expect(ok([{ channel: 'EMAIL', body: 'Hello' }])).toBe(false);
    expect(ok([{ channel: 'SMS', subject: 'x', body: 'Hello' }])).toBe(false);
    expect(ok([{ channel: 'SMS', body: 'x'.repeat(1601) }])).toBe(false);
    expect(ok([{ channel: 'IN_APP', body: 'Hi', mediaIds: [id] }])).toBe(false);
    expect(
      ok([
        { channel: 'SMS', body: 'a' },
        { channel: 'SMS', body: 'b' },
      ]),
    ).toBe(false);
    expect(UpdateAdminCommBroadcastRequest.safeParse({}).success).toBe(false);
  });

  it('checks an audience: someone to reach, filters only for those types', () => {
    const ok = (d: unknown) => AdminCommSegmentDefinition.safeParse(d).success;
    expect(ok({ contactTypes: ['FIRM'], firmStatuses: ['ACTIVE'] })).toBe(true);
    expect(ok({ contactTypes: [] })).toBe(false);
    expect(ok({ contactTypes: ['TEAM'], firmStatuses: ['ACTIVE'] })).toBe(false);
    expect(ok({ contactTypes: ['FIRM'], salesContactIds: [id] })).toBe(false);
    expect(ok({ contactTypes: ['CLIENT'] })).toBe(false);
  });

  it('checks an upload: size, image types, no slashes', () => {
    const ok = (b: object) =>
      CreateAdminCommMediaRequest.safeParse({
        kind: 'INLINE_IMAGE',
        fileName: 'logo.png',
        contentType: 'image/png',
        sizeBytes: 1000,
        sha256: 'a'.repeat(64),
        ...b,
      }).success;
    expect(ok({})).toBe(true);
    expect(ok({ contentType: 'application/pdf' })).toBe(false);
    expect(ok({ kind: 'ATTACHMENT', contentType: 'application/pdf' })).toBe(true);
    expect(ok({ sizeBytes: 11 * 1024 * 1024 })).toBe(false);
    expect(ok({ fileName: '../x.png' })).toBe(false);
  });

  it('posts actions to their routes and deletes drafts', async () => {
    const { fn, calls } = fakeFetch(200, { ok: true });
    await client(fn).broadcasts.remove(id);
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: `/api/v1/admin/communications/broadcasts/${id}`,
    });
    await expect(client(fn).segments.count('nope')).rejects.toMatchObject({ status: 400 });
  });

  it('has a message for every error code', () => {
    for (const code of AdminCommBroadcastErrorCode.options)
      expect(ADMIN_COMM_BROADCAST_ERRORS[code]).toBeTruthy();
  });
});
