/**
 * Mock data and mock clients for the client portal sign-up and sign-in (Nahid, N02/N03) and the
 * firm's pending sign-ups (Fahad, F06), matching docs/api/client-auth.yaml. Synthetic data only.
 * The web kit's mock mode swaps `portalAuth(slug)` (src/lib/auth.ts) for
 * `createPortalAuthMock(slug)` and `api.clientSignUps` (src/lib/api.ts) for
 * `createClientSignUpsMock()`. They check input with the same schemas and throw the API's error
 * codes, so a screen built on them works unchanged against the real API.
 */
import {
  ApiError,
  ApiRequestError,
  ApproveSignUpResponse,
  ChangeEmailRequest,
  ChangePhoneRequest,
  type ClientSignUp,
  ClientSignUpList,
  type ClientSignUpsClient,
  ClientSignUpsQuery,
  DeclineSignUpRequest,
  DeclineSignUpResponse,
  ForgotPasswordRequest,
  LegalDocument,
  MeResponse,
  MfaRequest,
  MfaSetupRequest,
  parseInput,
  type PortalAuthClient,
  PortalInfo,
  ResendCodeRequest,
  ResetPasswordRequest,
  SignInRequest,
  SignInResult,
  SignOutRequest,
  SignUpRequest,
  SignUpState,
  VerifyCodeRequest,
} from '@firmivra/types';

// ---------- Fixtures (parsed, so one that breaks the contract fails as soon as this loads) ----------
const LVP_ID = '00000000-0000-4000-a000-000000000101';
const lvp = { id: LVP_ID, slug: 'lvp', name: 'LVP Accounting & Taxes', status: 'ACTIVE' } as const;

/** GET /api/v1/portal/lvp/info */
export const portalInfo = PortalInfo.parse({
  business: { slug: 'lvp', name: 'LVP Accounting & Taxes' },
  branding: {
    logoUrl: null,
    primaryColor: '#1F3A6B',
    accentColor: '#C9A227',
    portalName: 'LVP Accounting & Taxes Client Portal',
    header: 'Your Documents. Your Information. All in One Place.',
    welcomeMessage: 'Secure. Convenient. Designed for You.',
  },
  signUpOpen: true,
  legal: {
    terms: { version: 2, publishedAt: '2026-10-01T09:00:00.000Z' },
    privacy: { version: 1, publishedAt: '2026-09-20T09:00:00.000Z' },
  },
});

/** GET /api/v1/portal/lvp/legal/terms */
export const termsDocument = LegalDocument.parse({
  kind: 'terms',
  version: 2,
  publishedAt: '2026-10-01T09:00:00.000Z',
  body: '# Terms of Service\n\nSample terms for the mock portal.',
});

/** GET /api/v1/portal/lvp/legal/privacy */
export const privacyDocument = LegalDocument.parse({
  kind: 'privacy',
  version: 1,
  publishedAt: '2026-09-20T09:00:00.000Z',
  body: '# Privacy Policy\n\nSample privacy policy for the mock portal.',
});

/** POST .../auth/sign-up, GET .../auth/sign-up on /sign-up/verify-email */
export const signUpVerifyEmail = SignUpState.parse({
  step: 'VERIFY_EMAIL',
  email: 'john@example.com',
  phoneMasked: '(770) ***-0123',
  resendAvailableAt: '2026-10-07T12:00:45.000Z',
});

/** POST .../auth/sign-up/verify-email, GET .../auth/sign-up on /sign-up/verify-phone */
export const signUpVerifyPhone = SignUpState.parse({
  ...signUpVerifyEmail,
  step: 'VERIFY_PHONE',
  resendAvailableAt: '2026-10-07T12:01:30.000Z',
});

/** POST .../auth/sign-up/verify-phone, GET .../auth/sign-up on /sign-up/done */
export const signUpDone = SignUpState.parse({
  ...signUpVerifyEmail,
  step: 'DONE',
  resendAvailableAt: null,
});

const clientUser = {
  id: '00000000-0000-4000-a000-000000000201',
  email: 'john@example.com',
  name: 'John Doe',
  pool: 'CLIENT',
} as const;

/** GET .../me for an approved client: open /{firm}/home. */
export const meActive = MeResponse.parse({
  user: clientUser,
  memberships: [],
  clientAccounts: [{ business: lvp, status: 'ACTIVE' }],
  platformAdmin: false,
});

/** GET .../me while the firm has not approved yet: the layout sends the client to /sign-up/done. */
export const mePending = MeResponse.parse({
  ...meActive,
  clientAccounts: [{ business: lvp, status: 'PENDING_APPROVAL' }],
});

/** POST .../auth/sign-in: MFA is optional for clients, so most sign in straight away. */
export const signInActive = SignInResult.parse({ status: 'SIGNED_IN', me: meActive });
export const signInPending = SignInResult.parse({ status: 'SIGNED_IN', me: mePending });
export const signInMfa = SignInResult.parse({
  status: 'MFA_REQUIRED',
  session: 'mock-mfa-session',
});

const signUpItem = (n: number, fields: Partial<ClientSignUp>): ClientSignUp => ({
  clientAccountId: `00000000-0000-4000-a000-${String(300 + n).padStart(12, '0')}`,
  name: 'John Doe',
  email: 'john@example.com',
  phone: '+17705550123',
  accountType: 'INDIVIDUAL',
  status: 'PENDING_APPROVAL',
  signedUpAt: '2026-10-07T12:03:00.000Z',
  declinedAt: null,
  declineReason: null,
  ...fields,
});

/** GET /api/v1/client-sign-ups */
export const pendingSignUps = ClientSignUpList.parse({
  items: [
    signUpItem(1, {}),
    signUpItem(2, {
      name: 'Jane Roe',
      email: 'jane@example.com',
      phone: '+14045550188',
      accountType: 'BUSINESS',
      signedUpAt: '2026-10-07T13:20:00.000Z',
    }),
  ],
  nextCursor: null,
});

/** POST /api/v1/client-sign-ups/{id}/approve */
export const approvedSignUp = ApproveSignUpResponse.parse({
  clientAccountId: '00000000-0000-4000-a000-000000000301',
  clientId: '00000000-0000-4000-a000-000000000401',
  status: 'ACTIVE',
  approvedAt: '2026-10-07T15:00:00.000Z',
});

/** POST /api/v1/client-sign-ups/{id}/decline */
export const declinedSignUp = DeclineSignUpResponse.parse({
  clientAccountId: '00000000-0000-4000-a000-000000000302',
  status: 'DECLINED',
  declinedAt: '2026-10-07T15:05:00.000Z',
});

// ---------- Error bodies the screens must handle ----------
const error = (code: string, message: string) =>
  ApiError.parse({ error: { code, message, requestId: 'mock-request' } });

export const errors = {
  /** 400 on verify-email and verify-phone: stay on the page. */
  codeInvalid: error('CODE_INVALID', 'That code is not right or has expired'),
  /** 410 on any sign-up step: back to /{firm}/sign-up. */
  signUpExpired: error('SIGN_UP_EXPIRED', 'Your sign-up timed out. Please start again.'),
  /** 409 on sign-up: reload info and show the current Terms and Privacy. */
  termsOutdated: error(
    'TERMS_OUTDATED',
    'The Terms or Privacy policy changed. Please review them.',
  ),
  /** 403 on sign-up: the firm takes no sign-ups now. */
  signUpClosed: error('SIGN_UP_CLOSED', 'This firm is not taking new sign-ups right now'),
  /** 409 on change-email or change-phone after that step is verified. */
  alreadyVerified: error('ALREADY_VERIFIED', 'This is already verified'),
  /** 409 on a sign-up call out of order. */
  wrongStep: error('WRONG_STEP', 'Please follow the steps in order'),
  /** 401 on sign-in, also for an unknown email or a declined account. */
  invalidCredentials: error('INVALID_CREDENTIALS', 'Email or password is incorrect'),
  /** 429 on any rate-limited call. */
  rateLimited: error('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'),
  /** 409 on approve or decline when someone else already handled the sign-up. */
  notPending: error('NOT_PENDING', 'This sign-up was already handled'),
} as const;

// ---------- Mock clients ----------
/** The code that works everywhere in the mocks (as in AUTH_MODE=local). */
export const MOCK_CODE = '000000';
/** Sign-in with this password answers INVALID_CREDENTIALS; any other password works. */
export const MOCK_WRONG_PASSWORD = 'Wrong-password-1';

const RESEND_GAP_MS = 45_000;
const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, body: { error: { code: string; message: string } }) =>
  new ApiRequestError(status, body.error.code, body.error.message);
const copy = <T>(value: T): T => structuredClone(value);
const masked = (phone: string) =>
  /^\+1\d{10}$/.test(phone)
    ? `(${phone.slice(2, 5)}) ***-${phone.slice(-4)}`
    : `${phone.slice(0, 3)} *** ${phone.slice(-4)}`;

export interface PortalAuthMockOptions {
  /** Start mid-way through a sign-up, so a page opened directly in mock mode has one. */
  signUpStep?: SignUpState['step'];
  /** Start signed in: an approved client, one waiting for approval, or nobody (default). */
  signedIn?: 'ACTIVE' | 'PENDING_APPROVAL';
  /** Every sign-in asks for the authenticator code (clients who turned MFA on). */
  mfa?: boolean;
  /** The firm takes no sign-ups: sign-up answers 403 SIGN_UP_CLOSED. */
  signUpClosed?: boolean;
}

/**
 * An in-memory `portalAuth(slug)`. Only the `lvp` portal exists (other slugs answer 404).
 * Walk a sign-up: signUp, then verifyEmail and verifyPhone with MOCK_CODE (any other code is
 * CODE_INVALID); signing in afterwards answers the pending account, as the API does. Sign-in
 * works with any password except MOCK_WRONG_PASSWORD; `signedIn` starts with a session.
 */
export function createPortalAuthMock(
  firmSlug: string,
  options: PortalAuthMockOptions = {},
): PortalAuthClient {
  const known = firmSlug.toLowerCase() === 'lvp';
  let signUp: { step: SignUpState['step']; email: string; phone: string; resendAt: number } | null =
    options.signUpStep
      ? { step: options.signUpStep, email: 'john@example.com', phone: '+17705550123', resendAt: 0 }
      : null;
  let me: MeResponse | null =
    options.signedIn === 'ACTIVE' ? meActive : options.signedIn ? mePending : null;
  /** Accounts made by a finished sign-up in this mock: they sign in as pending. */
  const signedUp = new Set<string>();

  const firm = () => {
    if (!known) throw fail(404, error('NOT_FOUND', 'Not found'));
  };
  const state = (): SignUpState => {
    if (!signUp) throw fail(410, errors.signUpExpired);
    return {
      step: signUp.step,
      email: signUp.email,
      phoneMasked: masked(signUp.phone),
      resendAvailableAt:
        signUp.step === 'DONE' ? null : new Date(signUp.resendAt + RESEND_GAP_MS).toISOString(),
    };
  };
  const at = (step: SignUpState['step']) => {
    const current = state().step;
    if (current !== step) throw fail(409, errors.wrongStep);
    return signUp as NonNullable<typeof signUp>;
  };
  const meFor = (email: string): MeResponse => {
    const base = signedUp.has(email) ? mePending : meActive;
    return { ...copy(base), user: { ...base.user, email } };
  };
  const signedInResult = (email: string): SignInResult => {
    me = meFor(email);
    return { status: 'SIGNED_IN', me: copy(me) };
  };

  return {
    info: async () => {
      await pause();
      firm();
      return copy(portalInfo);
    },
    legal: async (kind) => {
      await pause();
      firm();
      return copy(kind === 'terms' ? termsDocument : privacyDocument);
    },

    signUp: async (body) => {
      await pause();
      firm();
      const input = parseInput(SignUpRequest, body);
      if (options.signUpClosed) throw fail(403, errors.signUpClosed);
      const { terms, privacy } = portalInfo.legal;
      if (
        input.accepted.termsVersion !== terms?.version ||
        input.accepted.privacyVersion !== privacy?.version
      ) {
        throw fail(409, errors.termsOutdated);
      }
      signUp = {
        step: 'VERIFY_EMAIL',
        email: input.email,
        phone: input.phone,
        resendAt: Date.now(),
      };
      return state();
    },
    signUpState: async () => {
      await pause();
      firm();
      return state();
    },
    verifyEmail: async (body) => {
      await pause();
      const { code } = parseInput(VerifyCodeRequest, body);
      const s = at('VERIFY_EMAIL');
      if (code !== MOCK_CODE) throw fail(400, errors.codeInvalid);
      s.step = 'VERIFY_PHONE';
      s.resendAt = Date.now();
      return state();
    },
    verifyPhone: async (body) => {
      await pause();
      const { code } = parseInput(VerifyCodeRequest, body);
      const s = at('VERIFY_PHONE');
      if (code !== MOCK_CODE) throw fail(400, errors.codeInvalid);
      s.step = 'DONE';
      signedUp.add(s.email);
      return state();
    },
    resendCode: async (body) => {
      await pause();
      const { channel } = parseInput(ResendCodeRequest, body);
      const s = state();
      const wanted = channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE';
      if (s.step === 'DONE' || (channel === 'email' && s.step === 'VERIFY_PHONE')) {
        throw fail(409, errors.alreadyVerified);
      }
      if (s.step !== wanted) throw fail(409, errors.wrongStep);
      if (signUp && Date.now() < signUp.resendAt + RESEND_GAP_MS)
        throw fail(429, errors.rateLimited);
      if (signUp) signUp.resendAt = Date.now();
      return state();
    },
    changeEmail: async (body) => {
      await pause();
      const { email } = parseInput(ChangeEmailRequest, body);
      if (state().step !== 'VERIFY_EMAIL') throw fail(409, errors.alreadyVerified);
      if (signUp) Object.assign(signUp, { email, resendAt: Date.now() });
      return state();
    },
    changePhone: async (body) => {
      await pause();
      const { phone } = parseInput(ChangePhoneRequest, body);
      if (state().step === 'DONE') throw fail(409, errors.alreadyVerified);
      if (signUp) Object.assign(signUp, { phone, resendAt: Date.now() });
      return state();
    },

    signIn: async (body) => {
      await pause();
      firm();
      const { email, password } = parseInput(SignInRequest, body);
      if (password === MOCK_WRONG_PASSWORD) throw fail(401, errors.invalidCredentials);
      if (options.mfa) return { status: 'MFA_REQUIRED', session: `mock-mfa:${email}` };
      return signedInResult(email);
    },
    submitMfaCode: async (body) => {
      await pause();
      const { session, code } = parseInput(MfaRequest, body);
      if (code !== MOCK_CODE) throw fail(401, error('MFA_CODE_INVALID', 'That code is not right'));
      return signedInResult(session.replace(/^mock-mfa:/, '') || clientUser.email);
    },
    startMfaSetup: async (body) => {
      await pause();
      const { session } = parseInput(MfaSetupRequest, body);
      return {
        session,
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/LVP:john%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=LVP',
      };
    },
    refresh: async () => {
      await pause();
      if (!me) throw fail(401, error('UNAUTHENTICATED', 'Sign in required'));
      return { ok: true };
    },
    signOut: async (body = {}) => {
      await pause();
      parseInput(SignOutRequest, body);
      me = null;
      return { ok: true };
    },
    forgotPassword: async (body) => {
      await pause();
      parseInput(ForgotPasswordRequest, body);
      return { ok: true };
    },
    resetPassword: async (body) => {
      await pause();
      const { code } = parseInput(ResetPasswordRequest, body);
      if (code !== MOCK_CODE) {
        throw fail(400, error('RESET_CODE_INVALID', 'That code is not right or has expired'));
      }
      return { ok: true };
    },
    me: async () => {
      await pause();
      firm();
      if (!me) throw fail(401, error('UNAUTHENTICATED', 'Sign in required'));
      return copy(me);
    },
  };
}

/**
 * An in-memory `api.clientSignUps` with the API's rules: approve and decline only pending
 * sign-ups (409 NOT_PENDING), unknown ids 404, and `role: 'STAFF'` gets 403 FORBIDDEN.
 * Pages of two, so a screen can try `nextCursor`.
 */
export function createClientSignUpsMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): ClientSignUpsClient {
  let rows: ClientSignUp[] = [
    ...pendingSignUps.items,
    signUpItem(3, {
      name: 'Sam Poe',
      email: 'sam@example.com',
      signedUpAt: '2026-10-07T14:40:00.000Z',
    }),
    signUpItem(4, {
      name: 'Alex Moe',
      email: 'alex@example.com',
      status: 'DECLINED',
      declinedAt: '2026-10-06T10:00:00.000Z',
      declineReason: 'Not a client of ours',
    }),
  ].map(copy);
  let nextClient = 500;
  const PAGE = 2;
  const allowed = () => {
    if (options.role === 'STAFF') {
      throw fail(403, error('FORBIDDEN', 'This action is not permitted'));
    }
  };
  const pending = (id: string) => {
    const row = rows.find((r) => r.clientAccountId === id);
    if (!row) throw fail(404, error('NOT_FOUND', 'Not found'));
    if (row.status !== 'PENDING_APPROVAL') throw fail(409, errors.notPending);
    return row;
  };

  return {
    list: async (query = {}) => {
      await pause();
      allowed();
      const q = parseInput(ClientSignUpsQuery, query);
      const matching = rows
        .filter((r) => r.status === q.status)
        .sort((a, b) => a.signedUpAt.localeCompare(b.signedUpAt));
      const start = q.cursor ? Number(q.cursor) : 0;
      const size = Math.min(q.limit, PAGE);
      const items = matching.slice(start, start + size).map(copy);
      const next = start + size < matching.length ? String(start + size) : null;
      return { items, nextCursor: next };
    },
    approve: async (clientAccountId) => {
      await pause();
      allowed();
      const row = pending(clientAccountId);
      rows = rows.filter((r) => r !== row);
      return {
        clientAccountId: row.clientAccountId,
        clientId: `00000000-0000-4000-a000-${String(nextClient++).padStart(12, '0')}`,
        status: 'ACTIVE',
        approvedAt: new Date().toISOString(),
      };
    },
    decline: async (clientAccountId, body = {}) => {
      await pause();
      allowed();
      const { reason } = parseInput(DeclineSignUpRequest, body);
      const row = pending(clientAccountId);
      const declinedAt = new Date().toISOString();
      rows = rows.map((r) =>
        r === row ? { ...r, status: 'DECLINED', declinedAt, declineReason: reason ?? null } : r,
      );
      return { clientAccountId: row.clientAccountId, status: 'DECLINED', declinedAt };
    },
  };
}
