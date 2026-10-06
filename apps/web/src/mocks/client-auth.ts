/**
 * Typed fixtures for the client portal sign-up and sign-in (Nahid, N02/N03) and the firm's
 * pending sign-ups (Fahad, F06), matching docs/api/client-auth.yaml. Synthetic data only.
 * Plain exports until R1's mock mode serves them; the types keep them in step with the contract.
 */
import type {
  ApiError,
  ApproveSignUpResponse,
  ClientSignUpList,
  DeclineSignUpResponse,
  LegalDocument,
  MeResponse,
  PortalInfo,
  SignInResult,
  SignUpState,
} from '@firmivra/types';

const LVP_ID = '00000000-0000-4000-a000-000000000101';
const lvp = { id: LVP_ID, slug: 'lvp', name: 'LVP Accounting & Taxes', status: 'ACTIVE' } as const;

// ---------- Public reads ----------
/** GET /api/v1/portal/lvp/info */
export const portalInfo = {
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
} satisfies PortalInfo;

/** GET /api/v1/portal/lvp/legal/terms */
export const termsDocument = {
  kind: 'terms',
  version: 2,
  publishedAt: '2026-10-01T09:00:00.000Z',
  body: '# Terms of Service\n\nSample terms for the mock portal.',
} satisfies LegalDocument;

// ---------- Sign-up (every step answers a SignUpState) ----------
/** POST .../auth/sign-up, GET .../auth/sign-up on /sign-up/verify-email */
export const signUpVerifyEmail = {
  step: 'VERIFY_EMAIL',
  email: 'john@example.com',
  phoneMasked: '(770) ***-0123',
  resendAvailableAt: '2026-10-07T12:00:45.000Z',
} satisfies SignUpState;

/** POST .../auth/sign-up/verify-email, GET .../auth/sign-up on /sign-up/verify-phone */
export const signUpVerifyPhone = {
  ...signUpVerifyEmail,
  step: 'VERIFY_PHONE',
  resendAvailableAt: '2026-10-07T12:01:30.000Z',
} satisfies SignUpState;

/** POST .../auth/sign-up/verify-phone, GET .../auth/sign-up on /sign-up/done */
export const signUpDone = {
  ...signUpVerifyEmail,
  step: 'DONE',
  resendAvailableAt: null,
} satisfies SignUpState;

// ---------- Sign-in ----------
const clientUser = {
  id: '00000000-0000-4000-a000-000000000201',
  email: 'john@example.com',
  name: 'John Doe',
  pool: 'CLIENT',
} as const;

/** GET .../me for an approved client: open /{firm}/home. */
export const meActive = {
  user: clientUser,
  memberships: [],
  clientAccounts: [{ business: lvp, status: 'ACTIVE' }],
  platformAdmin: false,
} satisfies MeResponse;

/** GET .../me while the firm has not approved yet: the layout sends the client to /sign-up/done. */
export const mePending = {
  ...meActive,
  clientAccounts: [{ business: lvp, status: 'PENDING_APPROVAL' }],
} satisfies MeResponse;

/** POST .../auth/sign-in: MFA is optional for clients, so most sign in straight away. */
export const signInActive = { status: 'SIGNED_IN', me: meActive } satisfies SignInResult;
export const signInPending = { status: 'SIGNED_IN', me: mePending } satisfies SignInResult;
export const signInMfa = {
  status: 'MFA_REQUIRED',
  session: 'mock-mfa-session',
} satisfies SignInResult;

// ---------- Firm side: pending sign-ups (F06) ----------
/** GET /api/v1/client-sign-ups */
export const pendingSignUps = {
  items: [
    {
      clientAccountId: '00000000-0000-4000-a000-000000000301',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+17705550123',
      accountType: 'INDIVIDUAL',
      status: 'PENDING_APPROVAL',
      signedUpAt: '2026-10-07T12:03:00.000Z',
      declinedAt: null,
      declineReason: null,
    },
    {
      clientAccountId: '00000000-0000-4000-a000-000000000302',
      name: 'Jane Roe',
      email: 'jane@example.com',
      phone: '+14045550188',
      accountType: 'BUSINESS',
      status: 'PENDING_APPROVAL',
      signedUpAt: '2026-10-07T13:20:00.000Z',
      declinedAt: null,
      declineReason: null,
    },
  ],
  nextCursor: null,
} satisfies ClientSignUpList;

/** POST /api/v1/client-sign-ups/{id}/approve */
export const approvedSignUp = {
  clientAccountId: '00000000-0000-4000-a000-000000000301',
  clientId: '00000000-0000-4000-a000-000000000401',
  status: 'ACTIVE',
  approvedAt: '2026-10-07T15:00:00.000Z',
} satisfies ApproveSignUpResponse;

/** POST /api/v1/client-sign-ups/{id}/decline */
export const declinedSignUp = {
  clientAccountId: '00000000-0000-4000-a000-000000000302',
  status: 'DECLINED',
  declinedAt: '2026-10-07T15:05:00.000Z',
} satisfies DeclineSignUpResponse;

// ---------- Error bodies the screens must handle ----------
const error = (code: string, message: string): ApiError => ({
  error: { code, message, requestId: 'mock-request' },
});

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
  /** 401 on sign-in, also for an unknown email or a declined account. */
  invalidCredentials: error('INVALID_CREDENTIALS', 'Email or password is incorrect'),
  /** 429 on any rate-limited call. */
  rateLimited: error('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'),
  /** 409 on approve or decline when someone else already handled the sign-up. */
  notPending: error('NOT_PENDING', 'This sign-up was already handled'),
} as const;
