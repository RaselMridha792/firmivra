import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  type ApproveSignUpRequest,
  ClientSignUpsQuery,
  createClientSignUpsClient,
  createPortalAuthClient,
  createRequest,
  Phone,
  SmsPhone,
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
  it('turns a typed US sign-up number into E.164, with or without +1', () => {
    expect(SmsPhone.parse('+1 (770) 555-0123')).toBe('+17705550123');
    expect(SmsPhone.parse('(770) 555-0123')).toBe('+17705550123');
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

describe('SmsPhone: US numbers only for SMS codes (SMS cost guard)', () => {
  it('reads US numbers in any common format', () => {
    for (const raw of ['+1 (770) 555-0199', '770.555.0199', '7705550199', '1-770-555-0199']) {
      expect([raw, SmsPhone.parse(raw)]).toEqual([raw, '+17705550199']);
    }
    // US territories are US.
    expect(SmsPhone.parse('+1 787 555 0100')).toBe('+17875550100');
  });

  it('refuses other countries, the Caribbean and Canada, and premium-rate numbers', () => {
    for (const raw of [
      '+442071234567',
      '+8801712345678',
      '+1 876 555 0100',
      '+1 809 555 0100',
      '+1 416 555 0100',
      '+1 900 555 0100',
      '+1 770 055 0100',
    ]) {
      expect([raw, SmsPhone.safeParse(raw).success]).toEqual([raw, false]);
    }
  });

  it('refuses non-geographic US codes: N11, N9X, 37X/96X, 456, 5XX, 600, 700/710, toll-free (#70 review)', () => {
    for (const code of ['211', '411', '911', '290', '999', '370', '960', '456', '500', '533']) {
      expect([code, SmsPhone.safeParse(`+1 ${code} 555 0100`).success]).toEqual([code, false]);
    }
    for (const code of ['600', '700', '710', '800', '822', '833', '855', '877', '880', '888']) {
      expect([code, SmsPhone.safeParse(`+1 ${code} 555 0100`).success]).toEqual([code, false]);
    }
    // Real US area codes next to them still pass.
    for (const code of ['212', '415', '530', '531', '770', '808', '878', '989']) {
      expect([code, SmsPhone.safeParse(`+1 ${code} 555 0100`).success]).toEqual([code, true]);
    }
  });
});

describe('Phone: international E.164 for every other phone field (Rasel, Oct 8)', () => {
  it('takes any country with its code, and ignores spaces, dots, brackets and dashes', () => {
    expect(Phone.parse('+44 20 7123 4567')).toBe('+442071234567');
    expect(Phone.parse('+1 (876) 555-0100')).toBe('+18765550100');
    expect(Phone.parse('+880 1712-345678')).toBe('+8801712345678');
    expect(Phone.parse('+49.30.1234.5678')).toBe('+493012345678');
  });

  it('reads a US number typed without +1 as US (#70 follow-up)', () => {
    // 10 digits, as staff and firm applicants type them.
    expect(Phone.parse('(404) 555-0102')).toBe('+14045550102');
    expect(Phone.parse('4045550102')).toBe('+14045550102');
    expect(Phone.parse('404.555.0102')).toBe('+14045550102');
    // 1 and 10 digits.
    expect(Phone.parse('1 (404) 555-0102')).toBe('+14045550102');
    expect(Phone.parse('14045550102')).toBe('+14045550102');
  });

  it('needs the country code for any other country', () => {
    // A London number as typed there: 11 digits starting with 0 is no US shorthand.
    const london = Phone.safeParse('020 7123 4567');
    expect(london.success).toBe(false);
    expect(london.error?.issues[0]?.message).toBe('Enter the phone number with its country code');
    // Neither are 9 digits.
    expect(Phone.safeParse('404555010').success).toBe(false);
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
