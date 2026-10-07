import { describe, expect, it } from 'vitest';
import {
  ChangeTeamRoleRequest,
  createRequest,
  createTeamClient,
  ListTeamResponse,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
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

const id = '0199b6a0-0000-7000-8000-000000000003';
const member = {
  id,
  user: { id: '0199b6a0-0000-7000-8000-000000000103', name: 'Sam Staff', email: 'sam@lvp.test' },
  role: 'STAFF',
  status: 'INVITED',
  invite: { sentAt: '2026-10-06T09:00:00.000Z', expiresAt: '2026-10-13T09:00:00.000Z' },
  isYou: false,
  createdAt: '2026-10-06T09:00:00.000Z',
};
const client = (fn: typeof fetch) =>
  createTeamClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('team contract', () => {
  it('changes roles only to a known role, with nothing else in the body', () => {
    expect(ChangeTeamRoleRequest.safeParse({ role: 'ADMIN' }).success).toBe(true);
    for (const body of [{ role: 'VIEWER' }, {}, { role: 'STAFF', businessId: id }]) {
      expect(ChangeTeamRoleRequest.safeParse(body).success).toBe(false);
    }
  });

  it('keeps working when the API adds a field to a member', () => {
    const parsed = ListTeamResponse.parse({
      items: [
        {
          ...member,
          lastSeenAt: null,
          user: { ...member.user, phone: null },
          invite: { ...member.invite, invitedBy: 'x' },
        },
      ],
    });
    expect(parsed.items[0]).toEqual(member);
  });
});

describe('api.team', () => {
  it('lists, changes a role, deactivates and resends with the right method and path', async () => {
    const listed = fakeFetch(200, { items: [member] });
    await expect(client(listed.fn).list()).resolves.toEqual([member]);
    expect(listed.calls[0]?.url).toBe('/api/v1/business/team');

    const { fn, calls } = fakeFetch(200, member);
    await client(fn).changeRole(id, { role: 'ADMIN' });
    await client(fn).deactivate(id);
    await client(fn).resendInvite(id);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `PATCH /api/v1/business/team/${id}`,
      `POST /api/v1/business/team/${id}/deactivate`,
      `POST /api/v1/business/team/${id}/resend-invite`,
    ]);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ role: 'ADMIN' });
    expect(calls[1]?.init.body).toBeUndefined();
  });

  it('rejects a bad id or role before sending anything', async () => {
    const { fn, calls } = fakeFetch(200, member);
    for (const call of [
      () => client(fn).deactivate('../settings'),
      () => client(fn).resendInvite(''),
      () => client(fn).changeRole(id, { role: 'VIEWER' as never }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toHaveLength(0);
  });
});
