import { describe, expect, it } from 'vitest';
import { ApiRequestError, createAdminAuthClient, createStaffAuthClient } from '../../src/index.js';

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

const bodyOf = (init: RequestInit | undefined): unknown =>
  init?.body === undefined ? undefined : JSON.parse(init.body as string);

describe('auth clients', () => {
  it('sends staff sign-in to /auth and admin sign-in to /admin/auth', async () => {
    const challenge = { status: 'MFA_REQUIRED', session: 'sess' };
    const staff = fakeFetch(200, challenge);
    const admin = fakeFetch(200, challenge);
    const creds = { email: 'Owner@LVP.test', password: 'pw' };

    await expect(
      createStaffAuthClient({ baseUrl: '/api/v1', fetch: staff.fn }).signIn(creds),
    ).resolves.toEqual(challenge);
    await createAdminAuthClient({ baseUrl: '/api/v1', fetch: admin.fn }).signIn(creds);

    expect(staff.calls[0]?.url).toBe('/api/v1/auth/sign-in');
    expect(admin.calls[0]?.url).toBe('/api/v1/admin/auth/sign-in');
    expect(staff.calls[0]?.init.method).toBe('POST');
    expect(staff.calls[0]?.init.credentials).toBe('include');
    expect(bodyOf(staff.calls[0]?.init)).toEqual({ email: 'owner@lvp.test', password: 'pw' });
  });

  it('posts the cleaned MFA code with the session', async () => {
    const { fn, calls } = fakeFetch(200, { status: 'MFA_REQUIRED', session: 's2' });
    await createStaffAuthClient({ baseUrl: '', fetch: fn }).submitMfaCode({
      session: 's1',
      code: '123 456',
    });
    expect(calls[0]?.url).toBe('/auth/mfa');
    expect(bodyOf(calls[0]?.init)).toEqual({ session: 's1', code: '123456' });
  });

  it('refreshes without a body and signs out with one', async () => {
    const { fn, calls } = fakeFetch(200, { ok: true });
    const auth = createAdminAuthClient({ baseUrl: '', fetch: fn });
    await auth.refresh();
    await auth.signOut({ everywhere: true });
    expect(calls.map((c) => c.url)).toEqual(['/admin/auth/refresh', '/admin/auth/sign-out']);
    expect(calls[0]?.init.body).toBeUndefined();
    expect(bodyOf(calls[1]?.init)).toEqual({ everywhere: true });
  });

  it('checks the body before sending and never calls the API with a weak password', async () => {
    const { fn, calls } = fakeFetch(200, { ok: true });
    const auth = createStaffAuthClient({ baseUrl: '', fetch: fn });
    await expect(auth.activate({ token: 't'.repeat(32), password: 'weak' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('sends invites in the selected firm', async () => {
    const invite = {
      id: '00000000-0000-4000-a000-000000000101',
      membershipId: '00000000-0000-4000-a000-000000000102',
      email: 'new@lvp.test',
      name: 'New Staff',
      role: 'STAFF',
      expiresAt: '2026-10-12T10:00:00.000Z',
    };
    const { fn, calls } = fakeFetch(201, invite);
    const auth = createStaffAuthClient({ baseUrl: '', businessId: 'b1', fetch: fn });
    await expect(
      auth.createInvite({ email: 'New@LVP.test', name: 'New Staff', role: 'STAFF' }),
    ).resolves.toEqual(invite);
    expect(calls[0]?.url).toBe('/auth/invites');
    expect((calls[0]?.init.headers as Record<string, string>)['x-business-id']).toBe('b1');
  });

  it('turns auth errors into ApiRequestError with the code', async () => {
    const { fn } = fakeFetch(401, {
      error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
    });
    const auth = createStaffAuthClient({ baseUrl: '', fetch: fn });
    const err = await auth.signIn({ email: 'a@b.test', password: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });
});
