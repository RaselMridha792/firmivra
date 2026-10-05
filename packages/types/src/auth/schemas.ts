import { z } from 'zod';
import { BusinessSummary, MeResponse, MembershipRole } from '../schemas.js';

// Staff and Super Admin sign-in contract (docs/api/auth.yaml, docs/AUTH-DESIGN.md).
// The firm site uses /api/v1/auth/*, the Super Admin site /api/v1/admin/auth/*; the bodies match.

// ---------- Sites and cookies ----------
export const AuthSite = z.enum(['firm', 'admin']);
export type AuthSite = z.infer<typeof AuthSite>;

/** Path of each site's auth endpoints, relative to /api/v1. */
export const AUTH_BASE_PATH: Record<AuthSite, string> = { firm: '/auth', admin: '/admin/auth' };

/**
 * Session cookies the API sets: HttpOnly, Secure, host-only (no Domain), so admin and app
 * never share a session. Each site has its own names, and the API accepts only the site's own
 * cookie: /api/v1/admin/* reads `admin`, every other route reads `firm`. JavaScript never reads them.
 */
export const AUTH_COOKIES = {
  firm: {
    access: 'fv_access',
    id: 'fv_id',
    refresh: 'fv_refresh',
    refreshPath: '/api/v1/auth',
  },
  admin: {
    access: 'fv_admin_access',
    id: 'fv_admin_id',
    refresh: 'fv_admin_refresh',
    refreshPath: '/api/v1/admin/auth',
  },
} as const satisfies Record<
  AuthSite,
  { access: string; id: string; refresh: string; refreshPath: string }
>;

// ---------- Fields ----------
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/**
 * Must match the Cognito pool policy (infra auth-stack: 12+ characters, upper, lower, digit,
 * no symbol required). Cognito also refuses spaces at either end and more than 256 characters.
 * Screens can show PASSWORD_RULES as a checklist; Password checks the same rules.
 */
export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 12 characters', test: (p: string) => p.length >= 12 },
  { id: 'lower', label: 'A lower-case letter', test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper', label: 'An upper-case letter', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'number', label: 'A number', test: (p: string) => /[0-9]/.test(p) },
  { id: 'edges', label: 'No space at the start or end', test: (p: string) => /^\S.*\S$/.test(p) },
] as const;
export const PASSWORD_MAX_LENGTH = 256;

export const Password = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
  .superRefine((password, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(password)) ctx.addIssue({ code: 'custom', message: rule.label });
    }
  });

/** Six digits from the authenticator app or the reset email. Spaces are ignored. */
export const OneTimeCode = z
  .string()
  .transform((code) => code.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

/** Opaque, short-lived (about 3 minutes) sign-in step. Send it back unchanged. */
export const ChallengeSession = z.string().min(1).max(8192);

// ---------- Sign-in and MFA ----------
/** POST {base}/sign-in. Never says whether the account exists. */
export const SignInRequest = z.object({
  email: Email,
  // Not checked against the policy here: older passwords may predate it.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type SignInRequest = z.input<typeof SignInRequest>;

/**
 * Result of sign-in, MFA and activation. SIGNED_IN means the cookies are set; `me` is the
 * GET /me body, so the screen can open the firm picker straight away.
 */
export const SignInResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SIGNED_IN'), me: MeResponse }),
  z.object({ status: z.literal('MFA_REQUIRED'), session: ChallengeSession }),
  z.object({ status: z.literal('MFA_SETUP_REQUIRED'), session: ChallengeSession }),
]);
export type SignInResult = z.infer<typeof SignInResult>;

/** POST {base}/mfa: the code for MFA_REQUIRED, or the first code after {base}/mfa/setup. */
export const MfaRequest = z.object({ session: ChallengeSession, code: OneTimeCode });
export type MfaRequest = z.input<typeof MfaRequest>;

/** POST {base}/mfa/setup: start first-time authenticator setup after MFA_SETUP_REQUIRED. */
export const MfaSetupRequest = z.object({ session: ChallengeSession });
export type MfaSetupRequest = z.input<typeof MfaSetupRequest>;

export const MfaSetupResponse = z.object({
  /** Replaces the earlier session: send this one to {base}/mfa. */
  session: ChallengeSession,
  /** Base32 key for typing into the app by hand. */
  secret: z.string().min(1),
  /** otpauth://totp/... URI to show as a QR code. */
  otpauthUri: z.string().startsWith('otpauth://totp/'),
});
export type MfaSetupResponse = z.infer<typeof MfaSetupResponse>;

// ---------- Session ----------
/** POST {base}/sign-out. `everywhere` also signs out every other device. */
export const SignOutRequest = z.object({ everywhere: z.boolean().optional() });
export type SignOutRequest = z.input<typeof SignOutRequest>;

// ---------- Forgot and reset password ----------
/** POST {base}/forgot-password: always { ok: true }, whether or not the account exists. */
export const ForgotPasswordRequest = z.object({ email: Email });
export type ForgotPasswordRequest = z.input<typeof ForgotPasswordRequest>;

/** POST {base}/reset-password: the emailed code and a new password. */
export const ResetPasswordRequest = z.object({
  email: Email,
  code: OneTimeCode,
  password: Password,
});
export type ResetPasswordRequest = z.input<typeof ResetPasswordRequest>;

// ---------- Invites and activation (firm site) ----------
/** Roles an invite can give. Owners are created when Super Admin approves the firm. */
export const InviteRole = MembershipRole.exclude(['OWNER']);
export type InviteRole = z.infer<typeof InviteRole>;

/** POST /auth/invites (owner or admin of the current firm). */
export const CreateInviteRequest = z.object({
  email: Email,
  name: z.string().trim().min(1).max(200),
  role: InviteRole,
});
export type CreateInviteRequest = z.input<typeof CreateInviteRequest>;

export const InviteResponse = z.object({
  id: z.uuid(),
  membershipId: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: InviteRole,
  expiresAt: z.iso.datetime({ offset: true }),
});
export type InviteResponse = z.infer<typeof InviteResponse>;

/** The token from the activation link (/activate?token=...). */
export const ActivationToken = z.string().min(20).max(512);

/** POST /auth/activation/check: what the activation screen shows before the password form. */
export const ActivationCheckRequest = z.object({ token: ActivationToken });
export type ActivationCheckRequest = z.input<typeof ActivationCheckRequest>;

export const ActivationCheckResponse = z.object({
  email: z.string(),
  name: z.string(),
  role: MembershipRole,
  business: BusinessSummary,
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ActivationCheckResponse = z.infer<typeof ActivationCheckResponse>;

/** POST /auth/activate: sets the password, then returns MFA_SETUP_REQUIRED. */
export const ActivateRequest = z.object({
  token: ActivationToken,
  password: Password,
  name: z.string().trim().min(1).max(200).optional(),
});
export type ActivateRequest = z.input<typeof ActivateRequest>;

// ---------- Errors ----------
/** Stable `error.code` values of the auth endpoints, besides the generic ones in ApiError. */
export const AuthErrorCode = z.enum([
  /** 400: Cognito refused the new password (policy, or a known leaked password). */
  'PASSWORD_REJECTED',
  /** 400: wrong or expired reset code. Same answer when the account does not exist. */
  'RESET_CODE_INVALID',
  /** 401: email or password is incorrect. Same answer when the account does not exist. */
  'INVALID_CREDENTIALS',
  /** 401: wrong authenticator code; the session is still valid for another try. */
  'MFA_CODE_INVALID',
  /** 401: the sign-in step expired or had too many wrong codes. Start sign-in again. */
  'CHALLENGE_EXPIRED',
  /** 404: unknown or already used activation link. */
  'INVITE_INVALID',
  /** 409: the email already has an active or invited membership in this firm. */
  'ALREADY_MEMBER',
  /** 410: the activation link is older than 7 days. Ask for a new invite. */
  'INVITE_EXPIRED',
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCode>;
