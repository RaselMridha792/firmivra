import { z } from 'zod';
import {
  CreateMyUploadRequest,
  fileNameFitsType,
  IntakeAnswers,
  IntakeAnswersInput,
  IntakeFormDefinition,
  IntakeFormKey,
  IntakeIssue,
  IntakeKey,
  intakeNumbersMasked,
  intakeStepFields,
  ScanStatus,
  UPLOAD_LIMITS,
  UploadContentType,
} from '@firmivra/types';

type Definition = IntakeFormDefinition;

// The Begin Online API's own wire shapes (R11 step 3, rasel/R15-begin-online), kept here, not in
// @firmivra/types: contract B (#257, packages/types/src/begin-online) is the reviewed contract
// the screens use, with other routes and shapes (per-form drafts under /portal/{slug}/begin/...).
// Until the API moves to contract B, only its submit body is contract B's (SubmitIntakeRequest).
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

// ---------- Submit (the body is contract B's SubmitIntakeRequest) ----------

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
