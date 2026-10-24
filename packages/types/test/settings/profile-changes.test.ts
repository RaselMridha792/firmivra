import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  CreateProfileChangeRequest,
  createProfileChangesClient,
  createRequest,
  PROFILE_CHANGE_FIELDS,
  ProfileChange,
} from '../../src/index.js';

const requestId = '0199c0e0-0a00-7000-8000-000000000001';

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

const change = {
  id: requestId,
  number: '#1004',
  kind: 'COMPANY',
  fields: ['legalName', 'ein'],
  status: 'OPEN',
  submittedAt: '2026-10-24T10:00:00.000Z',
  submittedBy: 'Sam Sample',
  closedAt: null,
  latestReply: null,
};

const ok = (body: object) => CreateProfileChangeRequest.safeParse(body).success;
const base = { requestId, kind: 'COMPANY', reason: 'A new legal name was registered.' };

describe('Request Change contract', () => {
  it('takes the fields of one card, at least one, with a reason', () => {
    expect(ok({ ...base, changes: { legalName: 'Sample Legal LLC' } })).toBe(true);
    expect(ok({ ...base, changes: { ein: '12-3456789' } })).toBe(true);
    expect(
      ok({
        ...base,
        kind: 'LICENSING',
        changes: { licenseNumber: 'CPA-1', expirationDate: '2027-12-31' },
      }),
    ).toBe(true);
    expect(ok({ ...base, changes: {} })).toBe(false);
    expect(ok({ ...base, changes: { licenseNumber: 'CPA-1' } })).toBe(false);
    expect(ok({ ...base, kind: 'LICENSING', changes: { legalName: 'Sample' } })).toBe(false);
    expect(ok({ ...base, reason: ' ', changes: { legalName: 'Sample' } })).toBe(false);
    expect(ok({ ...base, changes: { legalName: 'Sample', website: 'https://x.test' } })).toBe(
      false,
    );
  });

  it('keeps the 9-digit EIN and refuses what the support tickets would refuse', () => {
    const parsed = CreateProfileChangeRequest.parse({ ...base, changes: { ein: '12 345-6789' } });
    expect(parsed.changes.ein).toBe('123456789');
    expect(ok({ ...base, changes: { ein: '12345678' } })).toBe(false);
    for (const reason of ['soft\u00ADhyphen', 'line\u2028separator', '\u200C\u200D'])
      expect(ok({ ...base, changes: { legalName: 'Sample' }, reason }), reason).toBe(false);
    expect(ok({ ...base, changes: { legalName: 'Sample' }, reason: 'Two\nlines' })).toBe(true);
  });

  it('names every field once, each on one card', () => {
    const kinds = Object.values(PROFILE_CHANGE_FIELDS).map((f) => f.kind);
    expect(kinds.filter((k) => k === 'COMPANY')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'LICENSING')).toHaveLength(4);
  });

  it('calls the route and refuses bad input before sending', async () => {
    const f = fakeFetch(change);
    const client = createProfileChangesClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    const made = await client.create({ ...base, kind: 'COMPANY', changes: { ein: '123456789' } });
    expect(ProfileChange.parse(made).number).toBe('#1004');
    const list = fakeFetch({ items: [change] });
    const c2 = createProfileChangesClient(createRequest({ fetch: list.fn, baseUrl: '/api/v1' }));
    expect((await c2.list()).items).toHaveLength(1);
    expect([...f.calls, ...list.calls].map((c) => [c.init.method ?? 'GET', c.url])).toEqual([
      ['POST', '/api/v1/business/settings/profile/change-requests'],
      ['GET', '/api/v1/business/settings/profile/change-requests'],
    ]);

    const none = fakeFetch(change);
    const c3 = createProfileChangesClient(createRequest({ fetch: none.fn, baseUrl: '/api/v1' }));
    await expect(c3.create({ ...base, kind: 'COMPANY', changes: {} })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(none.calls).toHaveLength(0);
  });
});
