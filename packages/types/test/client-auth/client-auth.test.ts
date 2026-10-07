import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  type ApproveSignUpRequest,
  ClientSignUpsQuery,
  createClientSignUpsClient,
  createPortalAuthClient,
  createRequest,
  Phone,
  portalCookies,
  SignUpRequest,
  SignUpState,
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

const bodyOf = (init: RequestInit | undefined): unknown =>
  init?.body === undefined ? undefined : JSON.parse(init.body as string);

const state = {
  step: 'VERIFY_EMAIL',
  email: 'john@example.com',
  phoneMasked: '(770) ***-0123',
  resendAvailableAt: '2026-10-07T12:00:45.000Z',
};

describe('SignUpState: CONTACT_FIRM (Rasel, Oct 8, q13)', () => {
  it('takes the step with no resend time', async () => {
    const { SignUpState, SIGN_UP_WRONG_EMAIL_CODES } = await import('../../src/index.js');
    const state = {
      step: 'CONTACT_FIRM',
      email: 'jane@example.com',
      phoneMasked: '(770) ***-0123',
    };
    expect(SignUpState.parse({ ...state, resendAvailableAt: null }).step).toBe('CONTACT_FIRM');
    expect(SIGN_UP_WRONG_EMAIL_CODES).toBe(5);
  });
});

describe('#72 review: one-line names, strict queue requests', () => {
  it('refuses control characters in the sign-up name and the decline reason, and extra fields', async () => {
    const { SignUpRequest, DeclineSignUpRequest, ClientSignUpsQuery } =
      await import('../../src/index.js');
    const base = {
      name: 'Jane Client',
      email: 'jane@example.com',
      phone: '+17705550199',
      password: 'Client-password-1',
      accountType: 'INDIVIDUAL',
      accepted: { termsVersion: 1, privacyVersion: 1 },
    };
    expect(SignUpRequest.safeParse(base).success).toBe(true);
    for (const name of ['Jane\nClient', 'Jane\u0007', 'Jane\u001b[31m']) {
      expect([name, SignUpRequest.safeParse({ ...base, name }).success]).toEqual([name, false]);
    }
    expect(DeclineSignUpRequest.safeParse({ reason: 'Two\nlines are fine' }).success).toBe(true);
    expect(DeclineSignUpRequest.safeParse({ reason: 'nul\u0000' }).success).toBe(false);
    expect(DeclineSignUpRequest.safeParse({ reason: 'ok', extra: 1 }).success).toBe(false);
    expect(ClientSignUpsQuery.safeParse({ debug: '1' }).success).toBe(false);
  });
});

describe('client-auth schemas', () => {
  it('turns a typed US number into E.164 and refuses one without a country code', () => {
    expect(Phone.parse('+1 (770) 555-0123')).toBe('+17705550123');
    expect(Phone.safeParse('(770) 555-0123').success).toBe(false);
  });

  it('takes the mockup sign-up form, with the password policy and the accepted versions', () => {
    const body = {
      name: ' John Doe ',
      email: 'John@Example.com',
      phone: '+1 770 555 0123',
      password: 'Client-password-1',
      accountType: 'INDIVIDUAL',
      accepted: { termsVersion: 2, privacyVersion: 1 },
    };
    expect(SignUpRequest.parse(body)).toMatchObject({
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+17705550123',
    });
    expect(SignUpRequest.safeParse({ ...body, password: 'short' }).success).toBe(false);
    expect(SignUpRequest.safeParse({ ...body, accountType: 'BOTH' }).success).toBe(false);
  });

  it('defaults the sign-ups query to the pending queue, 25 at a time, at most 100', () => {
    expect(ClientSignUpsQuery.parse({})).toEqual({ status: 'PENDING_APPROVAL', limit: 25 });
    expect(ClientSignUpsQuery.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('gives each firm its own portal cookies, scoped to its own API routes', () => {
    expect(portalCookies('LVP')).toEqual({
      access: 'fv_portal_lvp_access',
      id: 'fv_portal_lvp_id',
      refresh: 'fv_portal_lvp_refresh',
      signUp: 'fv_portal_lvp_signup',
      accessPath: '/api/v1/portal/lvp/',
      refreshPath: '/api/v1/portal/lvp/auth',
      signUpPath: '/api/v1/portal/lvp/auth/sign-up',
    });
    expect(SignUpState.safeParse(state).success).toBe(true);
  });
});

describe('createPortalAuthClient', () => {
  it("reads the firm's portal info and legal text under its slug", async () => {
    const { fn, calls } = fakeFetch(200, {
      kind: 'terms',
      version: 2,
      publishedAt: '2026-10-01T00:00:00.000Z',
      body: '# Terms',
    });
    const portal = createPortalAuthClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), 'LVP');
    await portal.legal('terms');
    expect(calls[0]?.url).toBe('/api/v1/portal/lvp/legal/terms');
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('runs the sign-up steps on the cookie, never a token in the body', async () => {
    const { fn, calls } = fakeFetch(200, state);
    const portal = createPortalAuthClient(createRequest({ baseUrl: '', fetch: fn }), 'lvp');
    await portal.signUpState();
    await portal.verifyEmail({ code: '123 456' });
    await portal.resendCode({ channel: 'phone' });
    await portal.changePhone({ phone: '+1 (770) 555-0199' });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', '/portal/lvp/auth/sign-up'],
      ['POST', '/portal/lvp/auth/sign-up/verify-email'],
      ['POST', '/portal/lvp/auth/sign-up/resend'],
      ['POST', '/portal/lvp/auth/sign-up/change-phone'],
    ]);
    expect(bodyOf(calls[1]?.init)).toEqual({ code: '123456' });
    expect(bodyOf(calls[3]?.init)).toEqual({ phone: '+17705550199' });
    expect(calls.every((c) => c.init.credentials === 'include')).toBe(true);
  });

  it('refuses a bad body with VALIDATION_FAILED, as the API would, before sending', async () => {
    const { fn, calls } = fakeFetch(200, state);
    const portal = createPortalAuthClient(createRequest({ baseUrl: '', fetch: fn }), 'lvp');
    const err = await portal.verifyPhone({ code: '12' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });

  it('signs in on the firm portal path', async () => {
    const { fn, calls } = fakeFetch(200, { status: 'MFA_REQUIRED', session: 's' });
    await createPortalAuthClient(createRequest({ baseUrl: '', fetch: fn }), 'lvp').signIn({
      email: 'john@example.com',
      password: 'x',
    });
    expect(calls[0]?.url).toBe('/portal/lvp/auth/sign-in');
  });
});

describe('createClientSignUpsClient', () => {
  it('lists, approves and declines in the selected firm', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], nextCursor: null });
    const signUps = createClientSignUpsClient(
      createRequest({ baseUrl: '/api/v1', businessId: 'b1', fetch: fn }),
    );
    await signUps.list({ cursor: 'c2' });
    expect(calls[0]?.url).toBe(
      '/api/v1/client-sign-ups?status=PENDING_APPROVAL&limit=25&cursor=c2',
    );
    expect((calls[0]?.init.headers as Record<string, string>)['x-business-id']).toBe('b1');

    const id = '0190a000-0000-7000-8000-0000000000aa';
    const existing = '0190a000-0000-7000-8000-0000000000bb';
    const approve = fakeFetch(200, {
      clientAccountId: id,
      clientId: existing,
      status: 'ACTIVE',
      approvedAt: '2026-10-07T12:00:00.000Z',
    });
    await createClientSignUpsClient(createRequest({ baseUrl: '', fetch: approve.fn })).approve(id, {
      clientId: existing,
    });
    expect(approve.calls[0]?.url).toBe(`/client-sign-ups/${id}/approve`);
    expect(bodyOf(approve.calls[0]?.init)).toEqual({ clientId: existing });

    // Strict: an unknown field is refused before anything is sent.
    const strict = fakeFetch(200, {});
    const sent = createClientSignUpsClient(createRequest({ baseUrl: '', fetch: strict.fn }));
    await expect(
      sent.approve(id, { clientId: existing, force: true } as ApproveSignUpRequest),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(strict.calls).toHaveLength(0);

    const decline = fakeFetch(200, {
      clientAccountId: id,
      status: 'DECLINED',
      declinedAt: '2026-10-07T12:00:00.000Z',
    });
    await createClientSignUpsClient(createRequest({ baseUrl: '', fetch: decline.fn })).decline(id, {
      reason: 'Not a client of ours',
    });
    expect(decline.calls[0]?.url).toBe(`/client-sign-ups/${id}/decline`);
    expect(bodyOf(decline.calls[0]?.init)).toEqual({ reason: 'Not a client of ours' });
  });
});
