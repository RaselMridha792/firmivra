import { z } from 'zod';
import { FirmSlug } from '../schemas.js';
import { ScanStatus } from '../db-enums.js';
import {
  CreateMyUploadRequest,
  fileNameFitsType,
  UPLOAD_LIMITS,
  UploadContentType,
} from '../documents/schemas.js';
import {
  IntakeFormDefinition,
  IntakeFormKey,
  IntakeKey,
  type IntakeFormDefinition as Definition,
} from '../intake/definition.js';
import {
  IntakeAnswers,
  IntakeAnswersInput,
  IntakeIssue,
  intakeNumbersMasked,
} from '../intake/answers.js';
import { intakeStepFields } from '../intake/definition.js';

// Begin Online (R11): a visitor fills a service's intake form on a firm's portal site, signed
// out. Routes: /api/v1/portal/{firmSlug}/begin-online/... (ACTIVE firms only: any other slug is
// 404). No account is created.
//
// 1. `services()` lists the firm's Begin Online services; `form(serviceId)` gives the newest
//    published definition of one (the built-in form, version 1, until the firm publishes its own).
// 2. `startDraft()` with the first step's answers (they hold the contact: `email`, `phone` and
//    `fullName`, or `firstName` and `lastName`) starts a draft. The API answers the draft and sets
//    an HttpOnly cookie (`beginOnlineCookie(slug)`) that is the draft's only key: browser
//    JavaScript never sees it, and only its SHA-256 is stored.
// 3. `current()` reads the draft (with its own definition: a draft stays on the version it
//    started with); `saveStep(stepKey, answers)` autosaves one step (types and limits only;
//    nothing is required until submit). Saving a step replaces that step's answers.
// 4. A draft runs 30 days from its last save, and at most 90 days from its start: then 410
//    DRAFT_EXPIRED.
// SSNs and EINs come back only as `{ last4 }`; send one back unchanged to keep the stored number.
// Answer problems are 400 VALIDATION_FAILED with `details: { issues }` (IntakeIssue).

/** The draft cookie: its name and path (the API sets it; listed for tests and the docs). */
export function beginOnlineCookie(firmSlug: string) {
  const slug = firmSlug.toLowerCase();
  return { name: `fv_bo_${slug}`, path: `/api/v1/portal/${slug}/begin-online` } as const;
}

/** The service kinds whose drafts carry a tax year (the year the firm prepares). */
const TAX_YEAR_KINDS: readonly IntakeFormKey[] = ['ANNUAL_TAX', 'QUARTERLY_TAX', 'TAX_PLANNING'];

/**
 * The tax year a new draft is fixed to: the current year (as the mockups ask, R11 question 4)
 * for the tax services and for any form whose texts use `{taxYear}`; otherwise null.
 */
export function beginOnlineTaxYear(definition: Definition, today: string): number | null {
  const uses =
    TAX_YEAR_KINDS.includes(definition.key) || JSON.stringify(definition).includes('{taxYear}');
  return uses ? Number(today.slice(0, 4)) : null;
}

/** The visitor's contact, from the first step: what the lead is made of. */
export interface BeginOnlineContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * The contact in the first step's cleaned answers (`checkIntakeAnswers`): `email`, `phone`, and
 * `firstName` and `lastName`, or `fullName` (split at its last space; it needs two words). An
 * issue for each one missing: the API answers 400 VALIDATION_FAILED with them.
 */
export function beginOnlineContact(
  definition: Definition,
  answers: Readonly<Record<string, unknown>>,
): { contact: BeginOnlineContact; issues: IntakeIssue[] } {
  const step = definition.steps[0];
  const fields = step ? intakeStepFields(step) : [];
  const text = (key: string) => {
    const value = answers[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const issues: IntakeIssue[] = [];
  const need = (key: string, message = 'This is required') => {
    const label = fields.find((f) => f.key === key)?.label ?? key;
    issues.push({ step: step?.key ?? '', path: [key], label, message });
  };
  let [firstName, lastName] = [text('firstName'), text('lastName')];
  if (fields.some((f) => f.key === 'fullName')) {
    const parts = text('fullName').split(/\s+/).filter(Boolean);
    if (parts.length < 2) need('fullName', 'Enter your first and last name');
    lastName = parts.pop() ?? '';
    firstName = parts.join(' ');
  } else {
    if (!firstName) need('firstName');
    if (!lastName) need('lastName');
  }
  if (!text('email')) need('email');
  if (!text('phone')) need('phone');
  return { issues, contact: { firstName, lastName, email: text('email'), phone: text('phone') } };
}

const DateTime = z.iso.datetime({ offset: true });
export const BeginOnlineSlug = FirmSlug;

/** GET .../begin-online/services: one card of "Choose Your Service". */
export const BeginOnlineService = z.object({
  id: z.uuid(),
  kind: IntakeFormKey,
  name: z.string(),
  description: z.string().nullable(),
  /** Package names offered (Bookkeeping: Starter, Growth, Premium). */
  packages: z.array(z.string()),
});
export type BeginOnlineService = z.infer<typeof BeginOnlineService>;
export const BeginOnlineServiceList = z.object({ items: z.array(BeginOnlineService) });
export type BeginOnlineServiceList = z.infer<typeof BeginOnlineServiceList>;

/**
 * GET .../begin-online/services/{serviceId}/form: the definition a new draft starts on.
 * `formId` is null while the firm has no stored version (the built-in form, version 1).
 */
export const BeginOnlineForm = z.object({
  formId: z.uuid().nullable(),
  version: z.number().int().min(1),
  definition: IntakeFormDefinition,
});
export type BeginOnlineForm = z.infer<typeof BeginOnlineForm>;

/**
 * POST .../begin-online/drafts. `step` is the form's first step; its answers must hold the
 * contact (400 VALIDATION_FAILED otherwise).
 */
export const StartDraftRequest = z.strictObject({
  serviceId: z.uuid(),
  step: IntakeKey,
  answers: IntakeAnswersInput,
});
export type StartDraftRequest = z.input<typeof StartDraftRequest>;

/** PUT .../begin-online/drafts/current/steps/{stepKey}: that step's answers, all of them. */
export const SaveDraftStepRequest = z.strictObject({ answers: IntakeAnswersInput });
export type SaveDraftStepRequest = z.input<typeof SaveDraftStepRequest>;

/**
 * A file of the draft, in an upload slot of its form. `scanStatus`: PENDING while the malware scan
 * runs; only CLEAN and PENDING files count for a required slot (COUNTED_UPLOAD_STATUSES).
 */
export const DraftUpload = z.object({
  id: z.uuid(),
  slot: IntakeKey,
  fileName: z.string(),
  contentType: UploadContentType,
  sizeBytes: z.number().int(),
  scanStatus: ScanStatus,
  createdAt: DateTime,
});
export type DraftUpload = z.infer<typeof DraftUpload>;

/** The draft as the visitor sees it. SSNs and EINs only as `{ last4 }`. */
export const BeginDraft = z
  .object({
    leadId: z.uuid(),
    service: z.object({ id: z.uuid(), kind: IntakeFormKey, name: z.string() }),
    /** The draft's own definition (it keeps the version it started with). */
    definition: IntakeFormDefinition,
    /** For `{taxYear}` in the texts (fillIntakeText); null when the service has none. */
    taxYear: z.number().int().nullable(),
    answers: IntakeAnswers,
    /** Steps saved at least once (the stepper's ticks). */
    savedSteps: z.array(IntakeKey),
    /** When the draft runs out unless it is saved again (30 days from the last save). */
    draftExpiresAt: DateTime,
    /** Its files, oldest first (`createUpload`; files are added only while it is a draft). */
    uploads: z.array(DraftUpload),
  })
  .refine((d) => intakeNumbersMasked(d.definition, d.answers), {
    message: 'An SSN or EIN must come back masked',
    path: ['answers'],
  });
export type BeginDraft = z.infer<typeof BeginDraft>;

// ---------- Resume links ----------

/**
 * POST .../drafts/current/resume-link answers when the draft now runs out. The email holds a link
 * `{portal}/{slug}/begin/resume#token=...` (the key in the fragment, never sent to a server); a
 * new link replaces the old one and this browser's cookie.
 */
export const ResumeLinkSent = z.object({ draftExpiresAt: DateTime });
export type ResumeLinkSent = z.infer<typeof ResumeLinkSent>;

/** POST .../drafts/resume: the fragment's token, in the body (never in a URL). */
export const ResumeDraftRequest = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This link is not complete'),
});
export type ResumeDraftRequest = z.input<typeof ResumeDraftRequest>;

/** The resume page's `#token=...`, or null. */
export function resumeTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && ResumeDraftRequest.safeParse({ token }).success ? token : null;
}

// ---------- Submit ----------

/** A name as typed: 1 to 200 characters after trimming, no control characters. */
const SignedName = z
  .string()
  .trim()
  .min(1, 'Enter your name')
  .max(200, 'Use at most 200 characters')
  .regex(/^[^\p{Cc}]*$/u, 'Remove the special characters');
/** Trimmed, inner whitespace collapsed, lower-cased: how the two names are compared. */
const comparable = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * POST .../drafts/current/submit: the printed name and the typed signature, which must be the
 * same name (letter case and spacing aside). The firm's agreements are signed with them (R14).
 */
export const SubmitDraftRequest = z
  .strictObject({ printedName: SignedName, typedSignature: SignedName })
  .refine((b) => comparable(b.printedName) === comparable(b.typedSignature), {
    message: 'Type the same name as your printed name',
    path: ['typedSignature'],
  });
export type SubmitDraftRequest = z.input<typeof SubmitDraftRequest>;

/** The answer to a submit: the draft is sent; its cookie is cleared. */
export const DraftSubmitted = z.object({
  leadId: z.uuid(),
  service: z.object({ id: z.uuid(), kind: IntakeFormKey, name: z.string() }),
  submittedAt: DateTime,
});
export type DraftSubmitted = z.infer<typeof DraftSubmitted>;

// ---------- Uploads ----------
const { fileName, contentType, sizeBytes, sha256 } = CreateMyUploadRequest.shape;

/**
 * POST .../drafts/current/uploads: a file for an upload slot of the draft's form (PDF, JPG, PNG,
 * .xlsx or .docx, at most 10 MB). Then PUT it to the ticket's URL and `confirmUpload`
 * (ConfirmUploadRequest), as with documents (`uploadFile()` in apps/web/src/lib/upload.ts).
 */
export const CreateDraftUploadRequest = z
  .strictObject({ slot: IntakeKey, fileName, contentType, sizeBytes, sha256 })
  .superRefine((body, ctx) => {
    if (!fileNameFitsType(body.fileName, body.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fileName'],
        message: `The file name must end in ${UPLOAD_LIMITS.types[body.contentType].join(' or ')}`,
      });
    }
  });
export type CreateDraftUploadRequest = z.input<typeof CreateDraftUploadRequest>;

/** `error.details` of a 400 VALIDATION_FAILED about answers (the same as intake submit's). */
export const BeginOnlineValidationDetails = z.object({ issues: z.array(IntakeIssue) });

export const BeginOnlineErrorCode = z.enum([
  /** 400: the body or the answers (`details.issues`): a wrong step, a missing contact... */
  'VALIDATION_FAILED',
  /** 404: no such firm (or not ACTIVE), service or form. */
  'NOT_FOUND',
  /** 404: no draft for this browser (no cookie, or one that was replaced or is for another firm). */
  'DRAFT_NOT_FOUND',
  /** 410: the draft ran out (30 days without a save, or 90 days in all). */
  'DRAFT_EXPIRED',
  /** 409: the firm published a new version of the form meanwhile: reload it and start again. */
  'FORM_CHANGED',
  /** 410: a resume link that is not (or no longer) valid: replaced, expired or sent. */
  'RESUME_LINK_EXPIRED',
  /** 409: the slot (its `maxFiles`) or the draft (50 files) is full. */
  'TOO_MANY_FILES',
  /** 410: the upload ticket expired or was used. */
  'UPLOAD_EXPIRED',
  /** 409: the stored file is not the described one (size, checksum or type). */
  'UPLOAD_MISMATCH',
  'FILE_PASSWORD_PROTECTED',
  'FILE_HAS_MACROS',
  /** 503: files or email can't be reached right now. */
  'SERVICE_UNAVAILABLE',
  /** 409: the draft changed while it was being sent (another tab saved): review and send again. */
  'INTAKE_CHANGED',
  /** 503: the agreements can't be signed right now. */
  'SIGNING_UNAVAILABLE',
  /** 429: too many requests; try again later. */
  'RATE_LIMITED',
  /** 503: SSNs and EINs can't be saved right now. */
  'ENCRYPTION_UNAVAILABLE',
]);
export type BeginOnlineErrorCode = z.infer<typeof BeginOnlineErrorCode>;

export const BEGIN_ONLINE_ERRORS = {
  VALIDATION_FAILED: 'Check the highlighted answers.',
  NOT_FOUND: 'This page is not available.',
  DRAFT_NOT_FOUND: 'We could not find your saved form. Please start again.',
  DRAFT_EXPIRED: 'Your saved form has expired. Please start again.',
  FORM_CHANGED: 'This form was just updated. Please reload the page.',
  RESUME_LINK_EXPIRED: 'This link has expired or was replaced by a newer one.',
  TOO_MANY_FILES: 'No more files can be added here.',
  UPLOAD_EXPIRED: 'This upload has expired. Please try again.',
  UPLOAD_MISMATCH: "This file doesn't match its type. Check the file and upload it again.",
  FILE_PASSWORD_PROTECTED: 'Remove the password and upload the file again.',
  FILE_HAS_MACROS: 'Save it as a regular .xlsx or .docx without macros and upload again.',
  SERVICE_UNAVAILABLE: 'This is not available right now. Please try again in a moment.',
  INTAKE_CHANGED: 'Your form changed in another window. Please review it and send it again.',
  SIGNING_UNAVAILABLE: 'Signing is not available right now. Please try again later.',
  RATE_LIMITED: 'Too many attempts. Please try again later.',
  ENCRYPTION_UNAVAILABLE: 'Your answers cannot be saved right now. Please try again later.',
} as const satisfies Record<BeginOnlineErrorCode, string>;
