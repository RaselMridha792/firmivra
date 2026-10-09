import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { Phone } from '../client-auth/schemas.js';
import { clearable, text } from '../clients/text.js';
import { checkIntakeAnswers, IntakeAnswers } from '../intake/answers.js';
import {
  INTAKE_LIMITS,
  IntakeFormDefinition,
  IntakeFormKey,
  intakeStepFields,
} from '../intake/definition.js';
import { INTAKE_AGREEMENT_ERRORS, IntakeUpload, refuseFullNumbers } from '../intake/schemas.js';

// Begin Online (R11): the public intake on a firm's portal site (portal.firmivra.com/{firmSlug}/
// begin), without an account. A visitor picks one of the six services, gives their name and email
// (that starts a draft), fills the form step by step with autosave, uploads files, signs and
// submits. Submitting creates a pending lead for the firm's Begin Online review queue (R11 leads);
// no account is created (the firm invites the client after it converts the lead).
// Routes: /api/v1/portal/{firmSlug}/begin/... (public; the firm comes from the slug).
//   GET  forms                         the services the firm offers online
//   GET  forms/{path}                  one form's current definition (before a draft exists)
//   POST {path}/draft                  start a draft (sets the draft cookie)
//   GET  {path}/draft                  this browser's draft (404 when there is none)
//   PUT  {path}/draft/steps/{step}     autosave one step
//   GET, POST {path}/draft/uploads     the draft's files; step 1 of an upload
//   POST {path}/draft/uploads/confirm  step 3 of an upload
//   DELETE {path}/draft/uploads/{id}   remove a file
//   POST {path}/draft/submit           sign and submit
//   POST resume-link                   email the resume links of an address's drafts
//   POST resume                        open a draft from its emailed link (sets the draft cookie)
// `{path}` is the service's page path (BEGIN_ONLINE_SERVICES: annual-tax, bookkeeping...).
// One service per kind: a firm offers at most one Begin Online service of each of the six kinds
// (R0: services.begin_online, unique per firm and kind among unarchived services, never OTHER);
// the API picks that one.
// No form carries an agreement of its own: the review step shows the firm's agreements from
// R14's `api.publicAgreements(slug)`, and the submit carries the signature (SubmitIntakeRequest).
// The draft cookie: HttpOnly, one per service, on /api/v1/portal/{firmSlug}/begin, a few hours. Its
// value is signed by the API and binds the firm, the lead, the form and an expiry, never a bare
// lead id; JavaScript never sees it, nothing is kept in localStorage, and nothing about the draft
// is in a URL.
// The resume link is `/{firmSlug}/begin/resume#token=...`: the token is in the fragment (never sent
// to a server or a log); the resume page posts it to `resume`. The API stores only its SHA-256.
// Lifetime: only the visitor's own activity (start, a save, an upload) renews a draft, to 30 days
// from then, never past 90 days after the start; asking for a link renews nothing. The database
// (R0's r0_intake_engine) holds the API to it: a DRAFT lead always has leads.draft_expires_at (30
// days from the start unless the API sets less); a renewal reaches at most 30 days from now and
// never past 90 days after the start (created_at), and neither does a resume link; the expiry is
// frozen once the lead leaves DRAFT; an expired draft is neither renewed nor submitted, it only
// becomes EXPIRED. When a draft expires the API clears its answers and deletes its uploads and
// their stored files, then marks the lead EXPIRED (leads are never deleted); then 410
// DRAFT_EXPIRED. leads.tax_year is set once, at the start (2000 to 2100).
// A submit deletes the files whose slot is not a shown upload field before the lead leaves DRAFT,
// in the same transaction.
// Every route is rate limited per IP address (429 RATE_LIMITED). The resume-link route always
// answers the same, whether or not that address has a draft: its email goes out asynchronously
// (no difference in timing), and a silent per-address limit sends nothing more after a few links
// an hour, with the same answer.
// SSNs and EINs are stored encrypted with the firm's KMS key and come back as `{ last4 }` only,
// also on resume (answers.ts, "SSNs and EINs").
// Responses are plain objects; requests are strict (unknown fields are refused).

const DateTime = z.iso.datetime({ offset: true });

/**
 * The six services as the "Choose Your Service" page shows them, in its order: the page path, the
 * card and its button, and which success page follows (TAX: "Success Tax Prep.png"; GENERAL:
 * "Success Page for all services except taxes.png").
 */
export const BEGIN_ONLINE_SERVICES = {
  ANNUAL_TAX: {
    path: 'annual-tax',
    title: 'Tax Preparation',
    tagline: 'Individual & Business Tax Returns',
    button: 'Tax Intake Form',
    success: 'TAX',
  },
  BOOKKEEPING: {
    path: 'bookkeeping',
    title: 'Business Bookkeeping',
    tagline: 'Keep Your Business on Track',
    button: 'Bookkeeping Intake Form',
    success: 'GENERAL',
  },
  PAYROLL: {
    path: 'payroll',
    title: 'Payroll Services',
    tagline: 'Simple. Accurate. On Time.',
    button: 'Payroll Intake Form',
    success: 'GENERAL',
  },
  BUSINESS_DEVELOPMENT: {
    path: 'business-development',
    title: 'Business Development',
    tagline: 'Plan. Grow. Succeed.',
    button: 'Business Development Intake Form',
    success: 'GENERAL',
  },
  QUARTERLY_TAX: {
    path: 'quarterly-tax',
    title: 'File Business Quarterly Taxes',
    tagline: 'Stay Compliant. Avoid Penalties.',
    button: 'Quarterly Tax Intake Form',
    success: 'GENERAL',
  },
  TAX_PLANNING: {
    path: 'tax-planning',
    title: 'Tax Planning',
    tagline: 'Strategize Today for a Brighter Tomorrow',
    button: 'Tax Planning Intake Form',
    success: 'GENERAL',
  },
} as const satisfies Record<
  IntakeFormKey,
  { path: string; title: string; tagline: string; button: string; success: 'TAX' | 'GENERAL' }
>;

/**
 * The six services in the "Choose Your Service" page's order (BEGIN_ONLINE_SERVICES' own order,
 * not IntakeFormKey's): the order `forms` answers in.
 */
export const BEGIN_ONLINE_FORM_ORDER = Object.keys(
  BEGIN_ONLINE_SERVICES,
) as readonly IntakeFormKey[];

/** The service whose page path this is (`annual-tax` is ANNUAL_TAX), or null. */
export function beginOnlineFormOfPath(path: string): IntakeFormKey | null {
  const found = Object.entries(BEGIN_ONLINE_SERVICES).find(([, s]) => s.path === path);
  return found ? (found[0] as IntakeFormKey) : null;
}

export const BEGIN_ONLINE_LIMITS = {
  /** A save, an upload or the start renews a draft to this many days from then... */
  draftDays: 30,
  /** ...but never past this many days after the start. */
  maxDraftDays: 90,
} as const;

// ---------- The firm's forms ----------
/**
 * GET /portal/{firmSlug}/begin/forms: the services the firm offers online (one per kind), in the
 * page's order (BEGIN_ONLINE_FORM_ORDER).
 */
export const BeginOnlineFormList = z.object({
  items: z
    .array(z.object({ form: IntakeFormKey, title: z.string(), version: z.number().int() }))
    .max(IntakeFormKey.options.length),
});
export type BeginOnlineFormItem = z.infer<typeof BeginOnlineFormList>['items'][number];

/**
 * GET /portal/{firmSlug}/begin/forms/{path}: the form to show before a draft exists. The
 * agreements to sign are not here: the review step reads them from `api.publicAgreements(slug)`.
 */
export const BeginOnlineForm = z.object({
  form: IntakeFormKey,
  version: z.number().int().min(1),
  title: z.string(),
  definition: IntakeFormDefinition,
  /**
   * For `{taxYear}` in the texts: the year the firm prepares (leads.tax_year, fixed in a draft at
   * its start).
   */
  taxYear: z.number().int(),
});
export type BeginOnlineForm = z.infer<typeof BeginOnlineForm>;

// ---------- The draft ----------
/** Who the draft is from: the resume link and the confirmation go to this email. */
export const BeginContact = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
});
export type BeginContact = z.infer<typeof BeginContact>;

/**
 * POST .../{path}/draft: the card the service page opens with ("Let's get started"). The API copies
 * these into the form's fields with the same keys (`beginOnlinePrefill`: firstName, lastName,
 * fullName, email, phone; each only when it fits its field). Starting again replaces this
 * browser's draft for the service (the old one stays resumable by its link). 404 when the firm
 * doesn't offer the service online.
 */
export const StartBeginDraftRequest = z.strictObject({
  firstName: text(100, 'one', 'Enter your first name'),
  lastName: text(100, 'one', 'Enter your last name'),
  email: Email,
  phone: clearable(Phone),
});
export type StartBeginDraftRequest = z.input<typeof StartBeginDraftRequest>;

/**
 * The answers a new draft starts with, as the API and the mock fill them: the start card's
 * contact copied into the form's fields with the same keys (firstName, lastName, fullName as
 * "first last", email, phone). Each is kept only when the form has that field and the value passes
 * it as a save of its step would, so the first save of that step never refuses it: a joined
 * fullName longer than the field's maxLength (each name may have 100 characters) is left out.
 */
export function beginOnlinePrefill(
  definition: IntakeFormDefinition,
  contact: { firstName: string; lastName: string; email: string; phone?: string | null },
): IntakeAnswers {
  const values: Record<string, string | null | undefined> = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: `${contact.firstName} ${contact.lastName}`,
    email: contact.email,
    phone: contact.phone,
  };
  const out: IntakeAnswers = {};
  for (const step of definition.steps) {
    for (const f of intakeStepFields(step)) {
      const value = values[f.key];
      if (typeof value !== 'string') continue;
      const { answers, issues } = checkIntakeAnswers(
        definition,
        { [f.key]: value },
        { mode: 'save', step: step.key },
      );
      const clean = answers[f.key];
      if (issues.length === 0 && clean !== undefined) out[f.key] = clean;
    }
  }
  return out;
}

/**
 * A draft: the form it is on (its own version), the answers so far and its files. A full SSN or
 * EIN in the answers fails to parse (only `{ last4 }` may come back).
 */
export const BeginDraft = BeginOnlineForm.extend({
  contact: BeginContact,
  answers: IntakeAnswers,
  uploads: z.array(IntakeUpload).max(INTAKE_LIMITS.maxFiles),
  /**
   * Steps saved at least once (intake_submissions.saved_steps; the stepper's ticks; resume at the
   * first one missing).
   */
  savedSteps: z.array(z.string()).max(10),
  /**
   * After this the draft is gone (410 DRAFT_EXPIRED). A start, a save or an upload renews it (30
   * days, at most 90 days after the start); a resume link does not.
   */
  expiresAt: DateTime,
  updatedAt: DateTime,
}).superRefine(refuseFullNumbers);
export type BeginDraft = z.infer<typeof BeginDraft>;

/** The resume link's token: 32 random bytes, base64url (43 characters). */
export const ResumeToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'This link is not complete. Open it again from your email.');

/**
 * The token in a resume link's fragment (`#token=...`), or null. The resume page reads
 * `window.location.hash`, posts the token, then clears the fragment (history.replaceState).
 */
export function resumeTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && ResumeToken.safeParse(token).success ? token : null;
}

/**
 * POST /portal/{firmSlug}/begin/resume: opens the draft (and sets this browser's draft cookie).
 * 410 DRAFT_EXPIRED for an expired, replaced or unknown link (the same answer for each); 409
 * DRAFT_SUBMITTED once the draft was sent. The answer's `form` says which service page to open.
 */
export const ResumeBeginDraftRequest = z.strictObject({ token: ResumeToken });
export type ResumeBeginDraftRequest = z.input<typeof ResumeBeginDraftRequest>;

/**
 * POST /portal/{firmSlug}/begin/resume-link ("Save and Continue Later", or "Email me my link" on
 * the resume page): the API emails a fresh link for each open draft of this address at the firm
 * (an older link stops working). It never extends a draft. Always `{ received: true }`, never
 * saying whether the address has a draft: the email is sent asynchronously, and past a few links
 * an hour for one address it silently sends nothing. 429 RATE_LIMITED per IP address.
 */
export const EmailResumeLinkRequest = z.strictObject({ email: Email });
export type EmailResumeLinkRequest = z.input<typeof EmailResumeLinkRequest>;

export const BeginReceived = z.object({ received: z.literal(true) });
export type BeginReceived = z.infer<typeof BeginReceived>;

/**
 * POST .../{path}/draft/submit (the body is SubmitIntakeRequest: the review step's answers and
 * the signature). The answers are locked, the files of slots that are not shown upload fields are
 * deleted, the lead goes to the firm's review queue and the visitor gets a confirmation email
 * that names the form, never the answers. Then this draft's calls answer 409 DRAFT_SUBMITTED.
 * Open `/{firmSlug}/begin/done?form={path}`.
 */
export const BeginSubmitted = z.object({
  received: z.literal(true),
  form: IntakeFormKey,
  submittedAt: DateTime,
});
export type BeginSubmitted = z.infer<typeof BeginSubmitted>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const BeginOnlineErrorCode = z.enum([
  /** 410: the draft or its resume link expired (or the link was replaced by a newer one). */
  'DRAFT_EXPIRED',
  /** 409: the draft was already submitted. */
  'DRAFT_SUBMITTED',
  /**
   * 409: the slot holds its field's `maxFiles` or the draft holds INTAKE_LIMITS.maxFiles; every
   * file counts, blocked ones too.
   */
  'TOO_MANY_FILES',
  /**
   * 409 on submit: the Terms of Service or Privacy Policy accepted on the review step is not the
   * firm's current version (as R3's sign-up). Reload them and accept again. The versions accepted
   * travel with R14's signature (intake_signatures.terms_document_id and privacy_document_id,
   * Begin Online only; see SubmitIntakeRequest).
   */
  'TERMS_OUTDATED',
  // The submit's agreement codes (IntakeAgreementErrorCode in intake/schemas.ts).
  'NO_INTAKE_AGREEMENT',
  'AGREEMENT_OUTDATED',
  'ACKNOWLEDGMENT_REQUIRED',
  'SIGNATURE_MISMATCH',
  'PDF_REQUIRED',
]);
export type BeginOnlineErrorCode = z.infer<typeof BeginOnlineErrorCode>;

/**
 * What visitors see: `errorMessage(error, { ...DOCUMENT_ERRORS, ...BEGIN_ONLINE_ERRORS })` (an
 * upload can also answer R5's UPLOAD_EXPIRED, UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED and
 * FILE_HAS_MACROS). 429 RATE_LIMITED is generic ("Too many attempts..."). A submit's 400
 * VALIDATION_FAILED carries `details: { issues }`; rerun `checkIntakeAnswers` to place them.
 */
export const BEGIN_ONLINE_ERRORS = {
  DRAFT_EXPIRED:
    'This link is no longer valid. If your form is still saved, enter your email for a new link.',
  DRAFT_SUBMITTED: 'This form has already been submitted. Thank you!',
  TOO_MANY_FILES: 'There is no room for more files here. Remove a file to add another.',
  TERMS_OUTDATED:
    'Our Terms of Service or Privacy Policy has been updated. Please review it and accept again.',
  ...INTAKE_AGREEMENT_ERRORS,
} as const satisfies Record<BeginOnlineErrorCode, string>;
