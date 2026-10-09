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
  ApproveSignUpRequest,
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
  SIGN_UP_WRONG_EMAIL_CODES,
  ResetPasswordRequest,
  SignInRequest,
  SignInResult,
  SignOutRequest,
  SignUpRequest,
  SignUpState,
  VerifyCodeRequest,
} from '@firmivra/types';

// ---------- Fixtures (parsed on first use, so one that breaks the contract fails then) ----------
const LVP_ID = '00000000-0000-4000-a000-000000000101';
const lvp = { id: LVP_ID, slug: 'lvp', name: 'LVP Accounting & Taxes', status: 'ACTIVE' } as const;

const clientUser = {
  id: '00000000-0000-4000-a000-000000000201',
  email: 'john@example.com',
  name: 'John Doe',
  pool: 'CLIENT',
} as const;

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
  existingClient: null,
  ...fields,
});

/**
 * Client records the mock firm already has. Approve links a sign-up to one only if its email is
 * the sign-up's verified email (both lower-cased) and it has no primary portal login yet
 * (`linkable`); `existingClient` shows only such a record.
 */
interface MockClientRecord {
  clientId: string;
  displayName: string;
  email: string | null;
  hasPrimaryLogin: boolean;
  /** Archived records are restored first: never linkable. */
  archived?: boolean;
}
const JANE_CLIENT_ID = '00000000-0000-4000-a000-000000000402';
const SAM_CLIENT_ID = '00000000-0000-4000-a000-000000000403';
const CLIENT_RECORDS: readonly MockClientRecord[] = [
  // Added by staff before Jane signed up: linkable to Jane's sign-up.
  {
    clientId: JANE_CLIENT_ID,
    displayName: 'Jane Roe',
    email: 'Jane@Example.com',
    hasPrimaryLogin: false,
  },
  // Same email as Sam's sign-up, but it already has a portal login: never linkable, and Sam's
  // sign-up cannot be approved as a new client either (DUPLICATE_EMAIL).
  {
    clientId: SAM_CLIENT_ID,
    displayName: 'Sam Poe',
    email: 'sam@example.com',
    hasPrimaryLogin: true,
  },
];
const linkable = (signUp: { email: string }, record: MockClientRecord) =>
  !record.hasPrimaryLogin &&
  !record.archived &&
  record.email?.toLowerCase() === signUp.email.toLowerCase();
const existingClientFor = (email: string): ClientSignUp['existingClient'] => {
  const record = CLIENT_RECORDS.find((r) => linkable({ email }, r));
  return record ? { clientId: record.clientId, displayName: record.displayName } : null;
};

// Error bodies the screens must handle: `errors` in the fixtures below.
const error = (code: string, message: string) =>
  ApiError.parse({ error: { code, message, requestId: 'mock-request' } });

let fixtures: ReturnType<typeof buildFixtures> | undefined;

/** Every answer the mocks give. Built on first use: importing this file runs nothing. */
export function clientAuthFixtures() {
  return (fixtures ??= buildFixtures());
}

function buildFixtures() {
  /** GET /api/v1/portal/lvp/info */
  const portalInfo = PortalInfo.parse({
    business: { slug: 'lvp', name: 'LVP Accounting & Taxes' },
    branding: {
      logoUrl: null,
      primaryColor: '#1F3A6B',
      accentColor: '#C9A227',
      portalName: 'LVP Accounting & Taxes Client Portal',
      tagline: 'Plan | Prepare | Prosper',
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
  const termsDocument = LegalDocument.parse({
    kind: 'terms',
    version: 2,
    publishedAt: '2026-10-01T09:00:00.000Z',
    body: '# Terms of Service\n\nSample terms for the mock portal.',
  });
  /** GET /api/v1/portal/lvp/legal/privacy */
  const privacyDocument = LegalDocument.parse({
    kind: 'privacy',
    version: 1,
    publishedAt: '2026-09-20T09:00:00.000Z',
    body: '# Privacy Policy\n\nSample privacy policy for the mock portal.',
  });
  /** POST .../auth/sign-up, GET .../auth/sign-up on /sign-up/verify-email */
  const signUpVerifyEmail = SignUpState.parse({
    step: 'VERIFY_EMAIL',
    email: 'john@example.com',
    phoneMasked: '(770) ***-0123',
    resendAvailableAt: '2026-10-07T12:00:45.000Z',
  });
  /**
   * POST .../auth/sign-up/verify-email with SIGNUP_PHONE_VERIFICATION=required, GET
   * .../auth/sign-up on /sign-up/verify-phone
   */
  const signUpVerifyPhone = SignUpState.parse({
    ...signUpVerifyEmail,
    step: 'VERIFY_PHONE',
    resendAvailableAt: '2026-10-07T12:01:30.000Z',
  });
  /**
   * POST .../auth/sign-up/verify-phone, or verify-email with SIGNUP_PHONE_VERIFICATION=optional
   * (the API's default, the SMS fallback); GET .../auth/sign-up on /sign-up/done
   */
  const signUpDone = SignUpState.parse({
    ...signUpVerifyEmail,
    step: 'DONE',
    resendAvailableAt: null,
  });
  /** GET .../me for an approved client: open /{firm}/home. */
  const meActive = MeResponse.parse({
    user: clientUser,
    memberships: [],
    clientAccounts: [{ business: lvp, status: 'ACTIVE' }],
    platformAdmin: false,
  });
  /** GET .../me while the firm has not approved yet: the layout sends the client to /sign-up/done. */
  const mePending = MeResponse.parse({
    ...meActive,
    clientAccounts: [{ business: lvp, status: 'PENDING_APPROVAL' }],
  });
  /** POST .../auth/sign-in: MFA is optional for clients, so most sign in straight away. */
  const signInActive = SignInResult.parse({ status: 'SIGNED_IN', me: meActive });
  const signInPending = SignInResult.parse({ status: 'SIGNED_IN', me: mePending });
  const signInMfa = SignInResult.parse({
    status: 'MFA_REQUIRED',
    session: 'mock-mfa-session',
  });
  /** GET /api/v1/client-sign-ups */
  const pendingSignUps = ClientSignUpList.parse({
    items: [
      signUpItem(1, {}),
      signUpItem(2, {
        name: 'Jane Roe',
        email: 'jane@example.com',
        phone: '+14045550188',
        accountType: 'BUSINESS',
        signedUpAt: '2026-10-07T13:20:00.000Z',
        existingClient: existingClientFor('jane@example.com'),
      }),
    ],
    nextCursor: null,
  });
  /** POST /api/v1/client-sign-ups/{id}/approve */
  const approvedSignUp = ApproveSignUpResponse.parse({
    clientAccountId: '00000000-0000-4000-a000-000000000301',
    clientId: '00000000-0000-4000-a000-000000000401',
    status: 'ACTIVE',
    approvedAt: '2026-10-07T15:00:00.000Z',
  });
  /** POST /api/v1/client-sign-ups/{id}/decline */
  const declinedSignUp = DeclineSignUpResponse.parse({
    clientAccountId: '00000000-0000-4000-a000-000000000302',
    status: 'DECLINED',
    declinedAt: '2026-10-07T15:05:00.000Z',
  });
  const errors = {
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
    rateLimited: error('RATE_LIMITED', 'Too many attempts. Please try again later.'),
    /** 409 on approve or decline when someone else already handled the sign-up. */
    notPending: error('NOT_PENDING', 'This sign-up was already handled'),
    /** 409 on approve with a client record that has another email or already has a login. */
    clientNotLinkable: error(
      'CLIENT_NOT_LINKABLE',
      'This client record cannot be linked to this sign-up',
    ),
    /** 409 on approve without clientId when a client of the firm already has the email. */
    duplicateEmail: error(
      'DUPLICATE_EMAIL',
      'A client of this firm already has this email. Link the sign-up to that record.',
    ),
  } as const;
  return {
    portalInfo,
    termsDocument,
    privacyDocument,
    signUpVerifyEmail,
    signUpVerifyPhone,
    signUpDone,
    meActive,
    mePending,
    signInActive,
    signInPending,
    signInMfa,
    pendingSignUps,
    approvedSignUp,
    declinedSignUp,
    errors,
  };
}

// ---------- Mock clients ----------
/** The code that works everywhere in the mocks (as in AUTH_MODE=local). */
export const MOCK_CODE = '000000';
/** Sign-in with this password answers INVALID_CREDENTIALS; any other password works. */
export const MOCK_WRONG_PASSWORD = 'Wrong-password-1';

/**
 * NEXT_PUBLIC_API_MOCK_SIGNUP_PHONE=required walks the SMS code step after verify-email, like the
 * API's SIGNUP_PHONE_VERIFICATION=required. Otherwise (the API's default, the SMS fallback)
 * verify-email ends the sign-up at DONE and no SMS code is due.
 */
const SIGNUP_PHONE_REQUIRED = process.env.NEXT_PUBLIC_API_MOCK_SIGNUP_PHONE === 'required';
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
  /**
   * The API's SIGNUP_PHONE_VERIFICATION: `optional` ends the sign-up at verify-email, `required`
   * goes on to the SMS code. Default: NEXT_PUBLIC_API_MOCK_SIGNUP_PHONE, else `optional`.
   */
  phoneVerification?: 'optional' | 'required';
}

/**
 * An in-memory `portalAuth(slug)`. Only the `lvp` portal exists (other slugs answer 404).
 * Walk a sign-up: signUp, then verifyEmail (and verifyPhone when the phone code is required, see
 * `phoneVerification`) with MOCK_CODE (any other code is CODE_INVALID); signing in afterwards
 * answers the pending account, as the API does. As in the
 * API, a changed email or phone gets its code only once the 45 s gap since the last code has
 * passed (until then the old code no longer works: press Resend), and a session has 10 code
 * requests. After SIGN_UP_WRONG_EMAIL_CODES wrong email codes the sign-up ends at CONTACT_FIRM
 * (its code, resend and change routes then answer WRONG_STEP), as in the API; `signUpStep:
 * 'CONTACT_FIRM'` starts there. Sign-in works with any password except MOCK_WRONG_PASSWORD;
 * `signedIn` starts with a session.
 */
export function createPortalAuthMock(
  firmSlug: string,
  options: PortalAuthMockOptions = {},
): PortalAuthClient {
  const { portalInfo, termsDocument, privacyDocument, meActive, mePending, errors } =
    clientAuthFixtures();
  const known = firmSlug.toLowerCase() === 'lvp';
  const phoneRequired =
    (options.phoneVerification ?? (SIGNUP_PHONE_REQUIRED ? 'required' : 'optional')) === 'required';
  type Walk = {
    step: SignUpState['step'];
    email: string;
    phone: string;
    /** When the last code went out. */
    resendAt: number;
    /** Whether the current step's code was sent to the current address. */
    codeSent: boolean;
    sends: number;
    /** Wrong email codes so far in this sign-up. */
    wrongEmailCodes: number;
  };
  let signUp: Walk | null = options.signUpStep
    ? {
        step: options.signUpStep,
        email: 'john@example.com',
        phone: '+17705550123',
        resendAt: 0,
        codeSent: true,
        sends: 1,
        wrongEmailCodes: 0,
      }
    : null;
  const SENDS_PER_SESSION = 10;
  /** A changed address gets its code now if the gap has passed; otherwise after Resend. */
  const changed = (s: Walk, fields: Partial<Walk>) => {
    if (s.sends >= SENDS_PER_SESSION) throw fail(429, errors.rateLimited);
    const now = Date.now();
    const sendNow = now >= s.resendAt + RESEND_GAP_MS;
    Object.assign(s, fields, {
      codeSent: sendNow,
      resendAt: sendNow ? now : s.resendAt,
      sends: s.sends + 1,
    });
  };
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
        signUp.step === 'DONE' || signUp.step === 'CONTACT_FIRM'
          ? null
          : new Date(signUp.resendAt + RESEND_GAP_MS).toISOString(),
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
        codeSent: true,
        sends: 1,
        wrongEmailCodes: 0,
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
      if (code !== MOCK_CODE || !s.codeSent) {
        // The last wrong code still answers CODE_INVALID; the sign-up then ends at CONTACT_FIRM.
        s.wrongEmailCodes += 1;
        if (s.wrongEmailCodes >= SIGN_UP_WRONG_EMAIL_CODES) s.step = 'CONTACT_FIRM';
        throw fail(400, errors.codeInvalid);
      }
      if (!phoneRequired) {
        // SMS fallback: the email completes the sign-up; the phone stays saved, unverified.
        s.step = 'DONE';
        signedUp.add(s.email);
        return state();
      }
      s.step = 'VERIFY_PHONE';
      // The SMS code goes out when the gap allows, as in the API.
      s.codeSent = Date.now() >= s.resendAt + RESEND_GAP_MS;
      if (s.codeSent) s.resendAt = Date.now();
      return state();
    },
    verifyPhone: async (body) => {
      await pause();
      const { code } = parseInput(VerifyCodeRequest, body);
      const s = at('VERIFY_PHONE');
      if (code !== MOCK_CODE || !s.codeSent) throw fail(400, errors.codeInvalid);
      s.step = 'DONE';
      signedUp.add(s.email);
      return state();
    },
    resendCode: async (body) => {
      await pause();
      const { channel } = parseInput(ResendCodeRequest, body);
      const s = state();
      const wanted = channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE';
      if (s.step === 'CONTACT_FIRM') throw fail(409, errors.wrongStep);
      if (s.step === 'DONE' || (channel === 'email' && s.step === 'VERIFY_PHONE')) {
        throw fail(409, errors.alreadyVerified);
      }
      if (s.step !== wanted) throw fail(409, errors.wrongStep);
      if (signUp && signUp.sends >= SENDS_PER_SESSION) throw fail(429, errors.rateLimited);
      if (signUp && Date.now() < signUp.resendAt + RESEND_GAP_MS)
        throw fail(429, errors.rateLimited);
      if (signUp)
        Object.assign(signUp, { resendAt: Date.now(), codeSent: true, sends: signUp.sends + 1 });
      return state();
    },
    changeEmail: async (body) => {
      await pause();
      const { email } = parseInput(ChangeEmailRequest, body);
      if (state().step === 'CONTACT_FIRM') throw fail(409, errors.wrongStep);
      if (state().step !== 'VERIFY_EMAIL') throw fail(409, errors.alreadyVerified);
      if (signUp) changed(signUp, { email });
      return state();
    },
    changePhone: async (body) => {
      await pause();
      const { phone } = parseInput(ChangePhoneRequest, body);
      const step = state().step;
      if (step === 'CONTACT_FIRM') throw fail(409, errors.wrongStep);
      if (step === 'DONE') throw fail(409, errors.alreadyVerified);
      // Before the phone step a new number only changes the login; no SMS is due yet.
      if (signUp && step === 'VERIFY_PHONE') changed(signUp, { phone });
      else if (signUp) Object.assign(signUp, { phone, sends: signUp.sends + 1 });
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
 * Jane Roe's sign-up has an `existingClient`: approve with its `clientId` links to it, and
 * approve without one is 409 DUPLICATE_EMAIL. Any other record is 409 CLIENT_NOT_LINKABLE (for
 * example Sam Poe's, which already has a login, so Sam's sign-up cannot be approved), and an
 * unknown `clientId` 404. John Doe's sign-up approves as a new client. Pages of two, so a screen
 * can try `nextCursor`.
 */
export function createClientSignUpsMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): ClientSignUpsClient {
  const { pendingSignUps, errors } = clientAuthFixtures();
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
  const records = CLIENT_RECORDS.map(copy);
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
    approve: async (clientAccountId, body = {}) => {
      await pause();
      allowed();
      const { clientId } = parseInput(ApproveSignUpRequest, body);
      const row = pending(clientAccountId);
      if (clientId) {
        const record = records.find((r) => r.clientId === clientId);
        if (!record) throw fail(404, error('NOT_FOUND', 'Not found'));
        if (!linkable(row, record)) throw fail(409, errors.clientNotLinkable);
        record.hasPrimaryLogin = true;
      } else if (records.some((r) => r.email?.toLowerCase() === row.email.toLowerCase())) {
        throw fail(409, errors.duplicateEmail);
      }
      rows = rows.filter((r) => r !== row);
      return {
        clientAccountId: row.clientAccountId,
        clientId: clientId ?? `00000000-0000-4000-a000-${String(nextClient++).padStart(12, '0')}`,
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
