import { z } from 'zod';
import { SearchText, text } from '../clients/text.js';
import { Email, OneTimeCode, Password } from '../auth/schemas.js';
import {
  ClientSignupMode,
  SignupCallOutcome,
  SignupCandidateResolution,
  SignupContactRef,
  SignupIdentityResult,
  SignupPermissionScope,
} from '../db-enums.js';
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

/** The firm's corporate contact in the portal (Client Portal guide, 4 and 9.4). */
export const PortalContact = z.object({
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** The street lines, then "City, ST 12345": empty when the firm has no address. */
  addressLines: z.array(z.string()),
  /** The main office's open intervals, 0 Sunday to 6 Saturday, "09:00" in its time zone. */
  hours: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      opensAt: z.string(),
      closesAt: z.string(),
    }),
  ),
});
export type PortalContact = z.infer<typeof PortalContact>;

/** GET /portal/{firmSlug}/info: everything the portal layout and landing page need. */
export const PortalInfo = z.object({
  business: z.object({ slug: z.string(), name: z.string() }),
  branding: z.object({
    /** The firm's logo (GET /portal/{slug}/logo), or null when it has none. */
    logoUrl: z.url().nullable(),
    /** The logo for light backgrounds (`?variant=light`), or null when the firm has none. */
    logoLightUrl: z.url().nullable(),
    /** Under the firm sidebar: the slogan and the motto, or null. Plain text. */
    sidebarSlogan: z.string().nullable(),
    sidebarMotto: z.string().nullable(),
    primaryColor: HexColor,
    accentColor: HexColor,
    /**
     * The firm's theme colours (FirmSettings): sidebar, headings and main text, secondary text,
     * primary buttons. Null: derive from `primaryColor` (the look before these existed).
     */
    sidebarColor: HexColor.nullable(),
    textPrimaryColor: HexColor.nullable(),
    textSecondaryColor: HexColor.nullable(),
    buttonColor: HexColor.nullable(),
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
  /**
   * How clients reach the firm: Company Profile's contact details, each one falling back to the
   * main office's in Locations, and that office's opening hours. Null or empty: not set.
   */
  contact: PortalContact,
});
export type PortalInfo = z.infer<typeof PortalInfo>;

export const LegalKind = z.enum(['terms', 'privacy']);
export type LegalKind = z.infer<typeof LegalKind>;

/** GET /portal/{firmSlug}/legal/{kind}: the current text, Markdown. */
export const LegalDocument = LegalVersion.extend({ kind: LegalKind, body: z.string() });
export type LegalDocument = z.infer<typeof LegalDocument>;

// ---------- Sign-up ----------
/** E.164, for example +17705550123. Screens turn "(770) 555-0123" into this for US numbers. */
/**
 * +1 area codes outside the US: the Caribbean (a common target of SMS pumping), Canada, and
 * premium-rate 900. US territories (Puerto Rico, Guam, the Virgin Islands...) stay allowed.
 */
const NON_US_AREA_CODES = new Set([
  // Caribbean and Bermuda
  '242',
  '246',
  '264',
  '268',
  '284',
  '345',
  '441',
  '473',
  '649',
  '658',
  '664',
  '721',
  '758',
  '767',
  '784',
  '809',
  '829',
  '849',
  '868',
  '869',
  '876',
  // Canada
  '204',
  '226',
  '236',
  '249',
  '250',
  '257',
  '263',
  '289',
  '306',
  '343',
  '354',
  '365',
  '367',
  '368',
  '382',
  '387',
  '403',
  '416',
  '418',
  '428',
  '431',
  '437',
  '438',
  '450',
  '460',
  '468',
  '474',
  '506',
  '514',
  '519',
  '548',
  '579',
  '581',
  '584',
  '587',
  '604',
  '613',
  '622',
  '639',
  '647',
  '672',
  '683',
  '705',
  '709',
  '742',
  '753',
  '778',
  '780',
  '782',
  '807',
  '819',
  '825',
  '867',
  '873',
  '879',
  '902',
  '905',
  '942',
  // Premium rate
  '900',
]);

/**
 * US area codes that are not a person's line (#70 review): N11 service codes, N9X (expansion)
 * and 37X/96X (reserved), 456 (international inbound), 500 and 533 (personal communications),
 * 600 and 700/710 (special services), toll-free 8XX and the reserved 822 and 880-889.
 */
const nonGeographic = (code: string) =>
  /^[2-9]11$/.test(code) ||
  /^[2-9]9\d$/.test(code) ||
  /^(37|96)\d$/.test(code) ||
  ['456', '500', '533', '600', '700', '710'].includes(code) ||
  /^8(00|22|33|44|55|66|77|8\d)$/.test(code);

/** 10 digits, or 1 and 10 digits, without + are a US number: +1 and the 10 digits. */
const usShorthand = (p: string) =>
  /^\d{10}$/.test(p) ? `+1${p}` : /^1\d{10}$/.test(p) ? `+${p}` : p;

/**
 * Any phone number, stored as E.164: + and the country code, then up to 14 digits. Spaces, dots,
 * brackets and dashes are ignored, and a US number may come without +1 (10 digits, or 1 and 10
 * digits), as staff and firm applicants type them (#70 follow-up); any other country needs its
 * code. Client records, firm applications and every other phone field take it (Rasel, Oct 8:
 * only SMS phone fields are US-only).
 */
export const Phone = z
  .string()
  .transform((p) => p.replace(/[\s().-]/g, ''))
  .transform(usShorthand)
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the phone number with its country code'));

/**
 * The phone a sign-up's SMS code goes to: a US number, stored as E.164 (+1 and 10 digits). US
 * only (Rasel, Oct 7 and 8): codes go by SMS on the platform's bill, and premium, non-geographic
 * or foreign numbers could run it up. Spaces, dots, dashes and brackets are ignored, and 10
 * digits without +1 are read as US. Caribbean, Canadian and non-geographic area codes are refused
 * (a deny-list: an allow-list would refuse new US area codes until someone updates it).
 */
export const SmsPhone = z
  .string()
  .transform((p) => p.replace(/[\s().-]/g, ''))
  .transform(usShorthand)
  .pipe(
    z
      .string()
      .regex(/^\+1[2-9]\d{2}[2-9]\d{6}$/, 'Enter a US phone number')
      .refine((p) => !NON_US_AREA_CODES.has(p.slice(2, 5)), 'Enter a US phone number')
      .refine((p) => !nonGeographic(p.slice(2, 5)), 'Enter a US phone number'),
  );

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
  /** The SMS code goes here: US only. */
  phone: SmsPhone,
  password: Password,
  accountType: AccountType,
  accepted: z.object({
    termsVersion: z.number().int().positive(),
    privacyVersion: z.number().int().positive(),
  }),
});
export type SignUpRequest = z.input<typeof SignUpRequest>;

/** Wrong email codes in one sign-up before it ends at CONTACT_FIRM (the same for every email). */
export const SIGN_UP_WRONG_EMAIL_CODES = 5;

/**
 * Where a sign-up stands, read from the sign-up cookie (the pages store nothing). Every sign-up
 * call answers this. The same for an email that already has an account at this firm: that person
 * gets an email saying so instead of a code (a declined one gets nothing), and the codes simply
 * never match.
 * - CONTACT_FIRM (Rasel, Oct 8, q13): this sign-up can't go on online. Every sign-up ends here
 *   after SIGN_UP_WRONG_EMAIL_CODES wrong email codes, counted the same way for every email, so
 *   it shows nothing about the email (a declined person, who never gets a code, lands here
 *   instead of "wrong code" forever). Show "We couldn't finish your sign-up online. Please
 *   contact {firm}." and a way to start again: a new sign-up works. Its code, resend and change
 *   routes answer 409 WRONG_STEP.
 */
export const SignUpState = z.object({
  step: z.enum(['VERIFY_EMAIL', 'VERIFY_PHONE', 'DONE', 'CONTACT_FIRM']),
  email: z.string(),
  /** For example "(770) ***-0123". */
  phoneMasked: z.string(),
  /** When "Resend Code" works again (the 45 s countdown); null at DONE and CONTACT_FIRM. */
  resendAvailableAt: z.iso.datetime({ offset: true }).nullable(),
  /**
   * At DONE: the firm approves sign-ups automatically and this one met its rule, so the portal is
   * open now ("Account Created" says so). False while the firm still has to approve it.
   */
  approved: z.boolean().default(false),
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
export const ChangePhoneRequest = z.object({ phone: SmsPhone });
export type ChangePhoneRequest = z.input<typeof ChangePhoneRequest>;

// ---------- Firm side: Client Sign-ups (owner and admin) ----------
/**
 * The request's decision, as the screen's tabs show it (Octavia's Client Sign-ups, section 5):
 * waiting (email and phone verified, not decided), approved by the firm, or declined. A potential
 * match is a separate flag (`match`), so it never becomes a fourth tab.
 */
export const SignUpListStatus = z.enum(['PENDING_APPROVAL', 'APPROVED', 'DECLINED']);
export type SignUpListStatus = z.infer<typeof SignUpListStatus>;

/**
 * A waiting request that may belong to a client the firm already has: one of the firm's client
 * records (archived ones too) has the sign-up's email, or the same phone number (the last 10
 * digits). A name alone never counts.
 */
export const SignUpMatch = z.enum(['POTENTIAL_MATCH', 'NO_MATCH']);
export type SignUpMatch = z.infer<typeof SignUpMatch>;

/**
 * GET /client-sign-ups. Search matches the name or the email. Submitted on or after `from` and on
 * or before `to` (the firm's calendar days). `match` applies to the Waiting tab only. Newest
 * first by default, the request id breaking ties; numbered pages.
 */
export const ClientSignUpsQuery = z
  .strictObject({
    status: SignUpListStatus.default('PENDING_APPROVAL'),
    search: SearchText.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    match: SignUpMatch.optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start is after the end',
    path: ['to'],
  });
export type ClientSignUpsQuery = z.input<typeof ClientSignUpsQuery>;

/** The firm's client record an approved request opened, as its Client ID shows it ("CL-10001"). */
export const SignUpClientRef = z.object({
  clientId: z.uuid(),
  clientNumber: z.string(),
  displayName: z.string(),
});
export type SignUpClientRef = z.infer<typeof SignUpClientRef>;

/** A verified sign-up (email and phone) waiting for the firm, approved or declined. */
export const ClientSignUp = z.object({
  clientAccountId: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  accountType: AccountType,
  status: SignUpListStatus,
  signedUpAt: z.iso.datetime({ offset: true }),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  declinedAt: z.iso.datetime({ offset: true }).nullable(),
  /** For the firm only; never sent to the client. */
  declineReason: z.string().nullable(),
  /** Waiting requests only (null otherwise): checked against the firm's records on every read. */
  match: SignUpMatch.nullable(),
  /** Approved requests: the client record the login belongs to. */
  client: SignUpClientRef.nullable(),
  /** Raised by each decision; every write sends the version it read (a newer one is 409). */
  version: z.number().int().min(1),
});
export type ClientSignUp = z.infer<typeof ClientSignUp>;

export const ClientSignUpList = z.object({
  items: z.array(ClientSignUp).max(100),
  /** Every request that matches the tab, search and filters. */
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  /** The firm's requests in each tab, whatever the search and filters. */
  counts: z.object({
    PENDING_APPROVAL: z.number().int().nonnegative(),
    APPROVED: z.number().int().nonnegative(),
    DECLINED: z.number().int().nonnegative(),
  }),
});
export type ClientSignUpList = z.infer<typeof ClientSignUpList>;

/** One step of a request's history: who (a member of the firm, or the applicant) and when. */
export const SignUpEvent = z.object({
  kind: z.enum([
    'SUBMITTED',
    'EMAIL_VERIFIED',
    'PHONE_VERIFIED',
    'CHECKS_RECORDED',
    'NOT_A_MATCH',
    'KEPT_PENDING',
    'LINKED',
    'ACCESS_RESTORED',
    'APPROVED',
    'DECLINED',
  ]),
  at: z.iso.datetime({ offset: true }),
  /** The firm member who decided; null for the applicant's own steps. */
  actorName: z.string().nullable(),
  /** Keep Pending's note or Not a Match's reason, for the firm only; null otherwise. */
  note: z.string().nullable().default(null),
});
export type SignUpEvent = z.infer<typeof SignUpEvent>;

/** How long recorded checks count (Rasel, Oct 26): after 24 hours they are recorded again. */
export const SIGN_UP_CHECKS_HOURS = 24;

/**
 * The three checks a member recorded for one of the firm's records (Octavia's D2): a call to a
 * contact already on that record (never the sign-up's own contact), the identity result and the
 * client's permission with its scope. Who and when; never the evidence itself.
 */
export const SignUpChecks = z.object({
  id: z.uuid(),
  candidateClientId: z.uuid(),
  contactRef: SignupContactRef,
  callOutcome: SignupCallOutcome,
  identityResult: SignupIdentityResult,
  permissionScope: SignupPermissionScope.nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
  /** `recordedAt` plus 24 hours: Restore Access and Link Existing Record need them before then. */
  expiresAt: z.iso.datetime({ offset: true }),
  actorName: z.string().nullable(),
});
export type SignUpChecks = z.infer<typeof SignUpChecks>;

/** One of the firm's records a waiting request may belong to, and what may be done with it. */
export const SignUpCandidate = SignUpClientRef.extend({
  matchedOn: z.array(z.enum(['email', 'phone'])),
  /** NOT_A_MATCH once a member resolved it; it then no longer holds the request back. */
  resolution: SignupCandidateResolution,
  /** The record already has a primary portal login: Restore Access instead of a link. */
  hasPortalLogin: z.boolean(),
  /** The newest checks recorded for this record in the last 24 hours, or null. */
  checks: SignUpChecks.nullable(),
  /** Checked on the server: what the newest checks allow with this record now. */
  actions: z.array(z.enum(['RESTORE_ACCESS', 'LINK'])),
});
export type SignUpCandidate = z.infer<typeof SignUpCandidate>;

/**
 * GET /client-sign-ups/{clientAccountId}: the request, its history (oldest first) and, while it
 * waits, the firm's client records it may belong to: the least needed to compare (name, Client
 * ID, which fields matched; never their values). Audited.
 */
export const ClientSignUpDetail = ClientSignUp.extend({
  history: z.array(SignUpEvent),
  candidates: z.array(SignUpCandidate),
  /** Approved by the firm's Automatic Approval rule (no member decided). */
  automatic: z.boolean(),
  /**
   * What may be done now, checked on the server: a waiting request may be declined or kept
   * pending; approved as a new client only once no candidate holds it back; Not a Match only for
   * phone matches (an email match never). Empty once decided.
   */
  allowedActions: z.array(z.enum(['APPROVE', 'DECLINE', 'KEEP_PENDING', 'NOT_A_MATCH'])),
});
export type ClientSignUpDetail = z.infer<typeof ClientSignUpDetail>;

/**
 * GET /client-sign-ups/settings: how the firm decides on new sign-ups
 * (`business_settings.client_signup_mode`, MANUAL until the firm changes it) and its policy version.
 */
export const ClientSignUpSettings = z.object({
  mode: ClientSignupMode,
  version: z.number().int().min(1),
  changedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ClientSignUpSettings = z.infer<typeof ClientSignUpSettings>;

/**
 * Every Sign-ups write (Octavia's spec, sections 7 and 8): the version it read, refused with 409
 * STALE_VERSION once another change raised it, and one key per attempt. A retry with the same key
 * and data returns the first outcome and does nothing again; the key with other data is 409
 * IDEMPOTENCY_KEY_REUSED.
 */
const SignUpWrite = {
  version: z.number().int().min(1),
  idempotencyKey: z.uuid(),
};

/**
 * PATCH /client-sign-ups/settings (Owner and Admin): the approval mode. It applies to sign-ups
 * completed from then on: requests already waiting stay waiting. Audited with the old and new
 * mode and the new policy version.
 */
export const UpdateClientSignUpSettingsRequest = z.strictObject({
  mode: ClientSignupMode,
  ...SignUpWrite,
});
export type UpdateClientSignUpSettingsRequest = z.input<typeof UpdateClientSignUpSettingsRequest>;

/**
 * POST /client-sign-ups/{clientAccountId}/approve. Without `clientId` it creates the firm's client
 * record from the sign-up, unless it may belong to a client the firm already has: 409
 * DUPLICATE_EMAIL when a record has its email, 409 POTENTIAL_MATCH when one has its phone number
 * (checked again inside the approval). With `clientId`, it links the login to that existing
 * record of this firm, and only if the record's email is the sign-up's verified email (both lower-cased) and the record
 * has no primary portal login yet; else 409 CLIENT_NOT_LINKABLE (404 if the firm has no such
 * client). Any other field is refused (400), so a typo never approves the wrong way.
 */
export const ApproveSignUpRequest = z.strictObject({
  clientId: z.uuid().optional(),
  ...SignUpWrite,
});
export type ApproveSignUpRequest = z.input<typeof ApproveSignUpRequest>;

/** The client can use the portal. */
export const ApproveSignUpResponse = z.object({
  clientAccountId: z.uuid(),
  /** The firm's client record: the one created, or the existing one it was linked to. */
  clientId: z.uuid(),
  status: ClientAccountStatus.extract(['ACTIVE']),
  approvedAt: z.iso.datetime({ offset: true }),
  /** The request's version after the approval. */
  version: z.number().int().min(1),
  /** The operation's id in the audit log, the same on a retry. */
  correlationId: z.uuid(),
});
export type ApproveSignUpResponse = z.infer<typeof ApproveSignUpResponse>;

/**
 * POST /client-sign-ups/{clientAccountId}/decline. The client gets one email in the firm's neutral
 * words, unless `notify` is false.
 */
export const DeclineSignUpRequest = z.strictObject({
  /** For the firm only; never sent to the client. */
  reason: text(500, 'many').optional(),
  notify: z.boolean().default(true),
  ...SignUpWrite,
});
export type DeclineSignUpRequest = z.input<typeof DeclineSignUpRequest>;

export const DeclineSignUpResponse = z.object({
  clientAccountId: z.uuid(),
  status: ClientAccountStatus.extract(['DECLINED']),
  declinedAt: z.iso.datetime({ offset: true }),
  version: z.number().int().min(1),
  correlationId: z.uuid(),
  /** Whether the applicant is told (`notify`). */
  notified: z.boolean(),
});
export type DeclineSignUpResponse = z.infer<typeof DeclineSignUpResponse>;

/**
 * POST /client-sign-ups/{clientAccountId}/checks: records the three checks for one candidate
 * record of a waiting request (409 NOT_A_CANDIDATE for any other record, 409 NOT_PENDING once
 * decided). A call to a contact the record has: CLIENT_PHONE or CLIENT_EMAIL need that value on
 * the record (409 NO_SUCH_CONTACT). Answers the request's detail. Audited without the evidence.
 */
export const RecordSignUpChecksRequest = z.strictObject({
  candidateClientId: z.uuid(),
  contactRef: SignupContactRef,
  callOutcome: SignupCallOutcome,
  identityResult: SignupIdentityResult,
  /** The client's permission and what it covers; null when not given. */
  permissionScope: SignupPermissionScope.nullable(),
});
export type RecordSignUpChecksRequest = z.input<typeof RecordSignUpChecksRequest>;

/**
 * POST /client-sign-ups/{clientAccountId}/link: Link Existing Record. The login joins that record
 * (its Client ID kept, its contacts unchanged), even with another email than the sign-up's, once
 * the three checks for it are recorded in the last 24 hours with permission to link (409
 * CHECKS_REQUIRED). The record has no primary portal login yet (409 CLIENT_NOT_LINKABLE: restore
 * access instead). Answers as an approval.
 */
export const LinkSignUpRequest = z.strictObject({
  candidateClientId: z.uuid(),
  ...SignUpWrite,
});
export type LinkSignUpRequest = z.input<typeof LinkSignUpRequest>;

/**
 * POST /client-sign-ups/{clientAccountId}/restore-access: the person already has a login on that
 * record. With the three checks recorded in the last 24 hours with permission to restore access
 * (409 CHECKS_REQUIRED), the request closes as declined with the reason "access restored", no new
 * client is made, and the record's own login gets the portal's usual recovery email (409
 * NO_PORTAL_LOGIN when the record has none). One operation id.
 */
export const RestoreSignUpAccessRequest = z.strictObject({
  candidateClientId: z.uuid(),
  ...SignUpWrite,
});
export type RestoreSignUpAccessRequest = z.input<typeof RestoreSignUpAccessRequest>;

export const RestoreSignUpAccessResponse = z.object({
  clientAccountId: z.uuid(),
  status: ClientAccountStatus.extract(['DECLINED']),
  declinedAt: z.iso.datetime({ offset: true }),
  /** The existing record whose login gets the recovery email. */
  clientId: z.uuid(),
  version: z.number().int().min(1),
  correlationId: z.uuid(),
});
export type RestoreSignUpAccessResponse = z.infer<typeof RestoreSignUpAccessResponse>;

/**
 * POST /client-sign-ups/{clientAccountId}/not-a-match (Owner and Admin): the open phone matches
 * are not this person. Each is recorded with who, when and the reason, and stops holding the
 * request back; approving then checks again for new matches. An email match is never resolved
 * this way (409 DUPLICATE_EMAIL): one email, one client.
 */
export const SignUpNotAMatchRequest = z.strictObject({
  reason: text(300, 'many', 'Say why these records are not this person'),
  ...SignUpWrite,
});
export type SignUpNotAMatchRequest = z.input<typeof SignUpNotAMatchRequest>;

export const SignUpNotAMatchResponse = z.object({
  clientAccountId: z.uuid(),
  /** How many records were resolved as not a match. */
  resolved: z.number().int().min(1),
  version: z.number().int().min(1),
  correlationId: z.uuid(),
});
export type SignUpNotAMatchResponse = z.infer<typeof SignUpNotAMatchResponse>;

/**
 * POST /client-sign-ups/{clientAccountId}/keep-pending: nothing changes; the note (firm only) and
 * who kept it are in the history.
 */
export const KeepSignUpPendingRequest = z.strictObject({
  note: text(500, 'many').optional(),
  idempotencyKey: z.uuid(),
});
export type KeepSignUpPendingRequest = z.input<typeof KeepSignUpPendingRequest>;

export const KeepSignUpPendingResponse = z.object({
  clientAccountId: z.uuid(),
  correlationId: z.uuid(),
});
export type KeepSignUpPendingResponse = z.infer<typeof KeepSignUpPendingResponse>;

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
   * The firm never gets a second client with one email. Same code as the client records API (R10).
   */
  'DUPLICATE_EMAIL',
  /**
   * 409: approve without `clientId`, but a client of the firm already has the sign-up's phone
   * number: the request may be an existing client's, so it stays waiting (Octavia's Sign-ups, 4).
   */
  'POTENTIAL_MATCH',
  /** 409: the request or setting changed since it was read. Nothing changed; read it again. */
  'STALE_VERSION',
  /** 409: an idempotency key already used with other data. The earlier operation stands. */
  'IDEMPOTENCY_KEY_REUSED',
  /** 409: that record is not one this request may belong to. */
  'NOT_A_CANDIDATE',
  /** 409: the call went to a contact the record does not have. */
  'NO_SUCH_CONTACT',
  /**
   * 409: Restore Access or Link Existing Record without the three checks for that record, with
   * the matching permission, recorded in the last 24 hours. Record them again.
   */
  'CHECKS_REQUIRED',
  /** 409: Restore Access to a record with no portal login. Link the record instead. */
  'NO_PORTAL_LOGIN',
]);
export type ClientAuthErrorCode = z.infer<typeof ClientAuthErrorCode>;
