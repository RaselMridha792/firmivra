import { z } from 'zod';
import { text } from '../clients/text.js';
import { Email, OneTimeCode, Password } from '../auth/schemas.js';
import { ClientAccountStatus } from '../schemas.js';

// Client portal sign-up and sign-in, and the firm's pending sign-ups (docs/api/client-auth.yaml).
// Portal routes: /api/v1/portal/{firmSlug}/... (the firm comes from the slug only).
// Firm routes: /api/v1/client-sign-ups/... (owner and admin; firm from x-business-id).

// ---------- Cookies ----------
/**
 * One portal host serves every firm, and a client has a separate login per firm, so each firm's
 * portal session has its own cookies (HttpOnly, Secure, host-only). The access and id cookies
 * go only to that firm's API routes, so one firm's session never reaches another firm's routes,
 * and portal pages read the session from the browser (GET .../me), not on the server.
 */
export function portalCookies(firmSlug: string) {
  const slug = firmSlug.toLowerCase();
  return {
    access: `fv_portal_${slug}_access`,
    id: `fv_portal_${slug}_id`,
    refresh: `fv_portal_${slug}_refresh`,
    /** The sealed sign-up session between the sign-up pages (about 30 minutes). */
    signUp: `fv_portal_${slug}_signup`,
    accessPath: `/api/v1/portal/${slug}/`,
    refreshPath: `/api/v1/portal/${slug}/auth`,
    signUpPath: `/api/v1/portal/${slug}/auth/sign-up`,
  } as const;
}

// ---------- Public portal reads ----------
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** The current published version of a firm's Terms or Privacy policy. */
export const LegalVersion = z.object({
  version: z.number().int().positive(),
  publishedAt: z.iso.datetime({ offset: true }),
});
export type LegalVersion = z.infer<typeof LegalVersion>;

/** GET /portal/{firmSlug}/info: everything the portal layout and landing page need. */
export const PortalInfo = z.object({
  business: z.object({ slug: z.string(), name: z.string() }),
  branding: z.object({
    /** Null until R5 serves logos. */
    logoUrl: z.url().nullable(),
    primaryColor: HexColor,
    accentColor: HexColor,
    /** For example "LVP Accounting & Taxes Client Portal". */
    portalName: z.string(),
    /** Heading on the landing page; null shows the default. */
    header: z.string().nullable(),
    /** Welcome text on the landing page; null shows the default. */
    welcomeMessage: z.string().nullable(),
  }),
  /** False when the firm closed sign-ups or has not published Terms and Privacy yet. */
  signUpOpen: z.boolean(),
  legal: z.object({ terms: LegalVersion.nullable(), privacy: LegalVersion.nullable() }),
});
export type PortalInfo = z.infer<typeof PortalInfo>;

export const LegalKind = z.enum(['terms', 'privacy']);
export type LegalKind = z.infer<typeof LegalKind>;

/** GET /portal/{firmSlug}/legal/{kind}: the current text, Markdown. */
export const LegalDocument = LegalVersion.extend({ kind: LegalKind, body: z.string() });
export type LegalDocument = z.infer<typeof LegalDocument>;

// ---------- Sign-up ----------
/** E.164, for example +17705550123. Screens turn "(770) 555-0123" into this for US numbers. */
export const Phone = z
  .string()
  .transform((p) => p.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the phone number with its country code'));

export const AccountType = z.enum(['INDIVIDUAL', 'BUSINESS']);
export type AccountType = z.infer<typeof AccountType>;

/**
 * POST /portal/{firmSlug}/auth/sign-up (mockup "Create Your Account"). The screen checks
 * "Confirm Password" itself. `accepted` must be the versions shown (PortalInfo.legal).
 */
export const SignUpRequest = z.object({
  /** One line, as R10's client names: it becomes the client record's display name. */
  name: text(200),
  email: Email,
  phone: Phone,
  password: Password,
  accountType: AccountType,
  accepted: z.object({
    termsVersion: z.number().int().positive(),
    privacyVersion: z.number().int().positive(),
  }),
});
export type SignUpRequest = z.input<typeof SignUpRequest>;

/**
 * Where a sign-up stands, read from the sign-up cookie (the pages store nothing). Every sign-up
 * call answers this. The same for an email that already has an account at this firm: that person
 * gets an email saying so instead of a code, and the codes simply never match.
 */
export const SignUpState = z.object({
  step: z.enum(['VERIFY_EMAIL', 'VERIFY_PHONE', 'DONE']),
  email: z.string(),
  /** For example "(770) ***-0123". */
  phoneMasked: z.string(),
  /** When "Resend Code" works again (the 45 s countdown); null once that step is done. */
  resendAvailableAt: z.iso.datetime({ offset: true }).nullable(),
});
export type SignUpState = z.infer<typeof SignUpState>;

/** POST .../sign-up/verify-email and .../verify-phone. */
export const VerifyCodeRequest = z.object({ code: OneTimeCode });
export type VerifyCodeRequest = z.input<typeof VerifyCodeRequest>;

/** POST .../sign-up/resend. */
export const ResendCodeRequest = z.object({ channel: z.enum(['email', 'phone']) });
export type ResendCodeRequest = z.input<typeof ResendCodeRequest>;

/** POST .../sign-up/change-email ("Change Email Address"), before the email is verified. */
export const ChangeEmailRequest = z.object({ email: Email });
export type ChangeEmailRequest = z.input<typeof ChangeEmailRequest>;

/** POST .../sign-up/change-phone ("Change Phone Number"), before the phone is verified. */
export const ChangePhoneRequest = z.object({ phone: Phone });
export type ChangePhoneRequest = z.input<typeof ChangePhoneRequest>;

// ---------- Firm side: pending sign-ups (owner and admin) ----------
export const SignUpListStatus = z.enum(['PENDING_APPROVAL', 'DECLINED']);
export type SignUpListStatus = z.infer<typeof SignUpListStatus>;

/** GET /client-sign-ups?status=&cursor=&limit= */
export const ClientSignUpsQuery = z.strictObject({
  status: SignUpListStatus.default('PENDING_APPROVAL'),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ClientSignUpsQuery = z.input<typeof ClientSignUpsQuery>;

/** A verified sign-up (email and phone) waiting for the firm, or declined. */
export const ClientSignUp = z.object({
  clientAccountId: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  accountType: AccountType,
  status: SignUpListStatus,
  signedUpAt: z.iso.datetime({ offset: true }),
  declinedAt: z.iso.datetime({ offset: true }).nullable(),
  declineReason: z.string().nullable(),
  /**
   * A client record of this firm that approve can link this login to (`clientId`) instead of
   * creating a duplicate, or null. Only a record that approve would accept: its email is the
   * sign-up's verified email (both lower-cased) and it has no primary portal login yet.
   */
  existingClient: z.object({ clientId: z.uuid(), displayName: z.string() }).nullable(),
});
export type ClientSignUp = z.infer<typeof ClientSignUp>;

export const ClientSignUpList = z.object({
  items: z.array(ClientSignUp),
  /** Pass as `cursor` for the next page; null on the last page. Oldest first. */
  nextCursor: z.string().nullable(),
});
export type ClientSignUpList = z.infer<typeof ClientSignUpList>;

/**
 * POST /client-sign-ups/{clientAccountId}/approve. Without `clientId` it creates the firm's client
 * record from the sign-up, unless a client of the firm already has that email (409
 * DUPLICATE_EMAIL: link that record instead). With it, it links the login to that existing record
 * of this firm, and
 * only if the record's email is the sign-up's verified email (both lower-cased) and the record
 * has no primary portal login yet; else 409 CLIENT_NOT_LINKABLE (404 if the firm has no such
 * client). Any other field is refused (400), so a typo never approves the wrong way.
 */
export const ApproveSignUpRequest = z.strictObject({ clientId: z.uuid().optional() });
export type ApproveSignUpRequest = z.input<typeof ApproveSignUpRequest>;

/** The client can use the portal. */
export const ApproveSignUpResponse = z.object({
  clientAccountId: z.uuid(),
  /** The firm's client record: the one created, or the existing one it was linked to. */
  clientId: z.uuid(),
  status: ClientAccountStatus.extract(['ACTIVE']),
  approvedAt: z.iso.datetime({ offset: true }),
});
export type ApproveSignUpResponse = z.infer<typeof ApproveSignUpResponse>;

/** POST /client-sign-ups/{clientAccountId}/decline. The client gets an email. */
export const DeclineSignUpRequest = z.strictObject({
  /** For the firm only; never sent to the client. */
  reason: text(500, 'many').optional(),
});
export type DeclineSignUpRequest = z.input<typeof DeclineSignUpRequest>;

export const DeclineSignUpResponse = z.object({
  clientAccountId: z.uuid(),
  status: ClientAccountStatus.extract(['DECLINED']),
  declinedAt: z.iso.datetime({ offset: true }),
});
export type DeclineSignUpResponse = z.infer<typeof DeclineSignUpResponse>;

// ---------- Errors ----------
/** Stable `error.code` values of these routes, besides the auth codes and ApiError's generic ones. */
export const ClientAuthErrorCode = z.enum([
  /** 403: the firm takes no sign-ups now (closed, or Terms and Privacy not published). */
  'SIGN_UP_CLOSED',
  /** 409: the accepted Terms or Privacy version is not the current one. Reload info. */
  'TERMS_OUTDATED',
  /** 410: no sign-up in progress (cookie missing or older than 30 minutes). Start again. */
  'SIGN_UP_EXPIRED',
  /** 400: wrong or expired verification code. */
  'CODE_INVALID',
  /** 409: that step is already verified (change-email after verifying the email, ...). */
  'ALREADY_VERIFIED',
  /** 409: a call out of order, for example verify-phone before the email is verified. */
  'WRONG_STEP',
  /** 409: approve or decline a sign-up that is no longer pending. */
  'NOT_PENDING',
  /**
   * 409: approve with a `clientId` whose record has another email than the sign-up's verified
   * one, or already has a primary portal login. Nothing changed; reload the list.
   */
  'CLIENT_NOT_LINKABLE',
  /**
   * 409: approve without `clientId`, but a client of the firm already has the sign-up's email.
   * The firm never gets a second client with one email: link that record (`existingClient`).
   * Same code as the client records API (R10).
   */
  'DUPLICATE_EMAIL',
]);
export type ClientAuthErrorCode = z.infer<typeof ClientAuthErrorCode>;
