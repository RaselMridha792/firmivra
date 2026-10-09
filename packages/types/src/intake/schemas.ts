import { z } from 'zod';
import {
  INTAKE_SIGNING_ERRORS,
  IntakeSignatureInput,
  IntakeSigningErrorCode,
} from '../agreements/schemas.js';
import { CalendarDate } from '../clients/schemas.js';
import { IntakeStatus, type ScanStatus } from '../db-enums.js';
import { CreateMyUploadRequest, fileNameFitsType, UPLOAD_LIMITS } from '../documents/schemas.js';
import { IntakeAnswers, IntakeAnswersInput, intakeNumbersMasked } from './answers.js';
import { INTAKE_LIMITS, IntakeFormDefinition, IntakeFormKey, IntakeKey } from './definition.js';

// Intake forms in the portal (R11): the signed-in client's Intake Forms tab. The firm sends an
// intake (one form for one of the client's services); the client fills it in with autosave,
// uploads its files, signs and submits it, which locks that version. The firm reviews it and
// either accepts it (COMPLETED) or marks it NEEDS_CORRECTION with a note: the client then edits
// the same answers again (the next version) and resubmits.
// Portal routes: /api/v1/portal/{firmSlug}/me/intakes... The client comes from the session, never
// from the URL; another client's intake is 404. Every login of the client's record can list and
// open its intakes; only the PRIMARY login saves, uploads and submits (`canEdit`, `canSubmit`; a
// spouse or authorized login gets 403 FORBIDDEN), until members get permissions of their own.
// No form carries an agreement of its own: the review step shows the agreements of the intake's
// form from R14's `api.myIntakeAgreements(slug).block(intakeId)`, and the submit carries the
// signature (SubmitIntakeRequest).
// SSNs and EINs are stored encrypted with the firm's KMS key and come back as `{ last4 }` only; a
// response with a full one fails to parse, and so does one with an answer outside the form or a
// group answer that is not a list of the group's rows (answers.ts, "SSNs and EINs").
// The database (R0's r0_intake_engine) holds the API to these rules:
// - An intake's file is a client document with documents.intake_id and documents.intake_slot,
//   set together or both null (detaching clears both); it goes only into an ACTIVE engagement
//   (409 NO_OPEN_SERVICE).
// - A file leaves its intake (detached, or deleted before its retention ends) only while the
//   intake is open (SENT, IN_PROGRESS, NEEDS_CORRECTION). So a submit detaches the files of
//   hidden slots first and then changes the status, in the same transaction.
// - intakes.correction_note (with correction_requested_at) is set exactly while the intake is
//   NEEDS_CORRECTION: the firm's request sets both with that status, and the status change that
//   ends it (the resubmit) clears them in the same update.
// - intake_submissions.saved_steps: the open version's saved step keys, each once, at most 10.
// The pieces Begin Online shares (saving a step, uploads, the submit and its errors) are here.
// Responses are plain objects; requests are strict (unknown fields are refused).

const DateTime = z.iso.datetime({ offset: true });

/**
 * Refuses a response whose answers could hold a full SSN or EIN (`intakeNumbersMasked`): a full
 * number anywhere, group rows included, an answer outside the form, or a group answer that is not
 * a list of the group's rows. Used by every response that carries answers (MyIntake here,
 * BeginDraft in Begin Online).
 */
export const refuseFullNumbers = (
  value: { definition: IntakeFormDefinition; answers: IntakeAnswers },
  ctx: z.RefinementCtx,
) => {
  if (!intakeNumbersMasked(value.definition, value.answers)) {
    ctx.addIssue({
      code: 'custom',
      path: ['answers'],
      message: 'A full SSN or EIN, or an answer outside the form, was returned',
    });
  }
};

// ---------- Shared with Begin Online ----------
/**
 * PUT .../steps/{step} (autosave): the step's answers as they are now; a field left out is
 * cleared. `{ last4 }` keeps a stored SSN or EIN only when it matches it (otherwise 400).
 */
export const SaveIntakeStepRequest = z.strictObject({ answers: IntakeAnswersInput });
export type SaveIntakeStepRequest = z.input<typeof SaveIntakeStepRequest>;

/** What a save answers. */
export const SavedIntakeStep = z.object({ step: z.string(), savedAt: DateTime });
export type SavedIntakeStep = z.infer<typeof SavedIntakeStep>;

/**
 * POST .../submit, for a portal intake and a Begin Online draft. `answers`: the review step's
 * answers, saved first as a save of that step would (so the last change can't race the submit;
 * a submit refused after that still keeps them saved).
 * `signature` (required): R14's IntakeSignatureInput for the agreement block the review step
 * showed (Begin Online: `api.publicAgreements(slug).block({ form })`; portal:
 * `api.myIntakeAgreements(slug).block(intakeId)`): every agreement of the block with the version
 * and bodySha256 it gave, the ticked acknowledgments and the typed signature. Begin Online also
 * sends `acceptLegal` with the Terms and Privacy versions of the block's `legal` when it is set;
 * a portal submit never does (400 VALIDATION_FAILED). The database refuses a submitted version
 * without its intake_signatures row and one intake_signature_agreements row per agreement, so the
 * API inserts them in the submit's transaction.
 * The API checks the whole form (`checkIntakeAnswers` in submit mode: 400 VALIDATION_FAILED with
 * `details: { issues }`, IntakeValidationDetails), then the signature against the current block
 * (IntakeSigningErrorCode: 409 NO_INTAKE_AGREEMENT, 409 AGREEMENT_OUTDATED with
 * AgreementOutdatedDetails, 400 ACKNOWLEDGMENT_REQUIRED, 400 SIGNATURE_MISMATCH, and Begin
 * Online's 409 TERMS_OUTDATED). The locked version holds the cleaned answers of the
 * shown fields only (the answers of hidden fields are dropped; `restoreMaskedNumbers` keeps the
 * stored SSNs and EINs). The files whose slot is not a shown upload field leave the form
 * (`hiddenSlotUploads`): a portal intake detaches them (they stay in My Documents), a Begin
 * Online draft deletes them; both before the status changes, in the same transaction.
 */
export const SubmitIntakeRequest = z.strictObject({
  answers: IntakeAnswersInput.optional(),
  signature: IntakeSignatureInput,
});
export type SubmitIntakeRequest = z.input<typeof SubmitIntakeRequest>;

/**
 * A file in an upload slot. CHECKING: the malware scan is running. READY: stored and clean.
 * BLOCKED: it couldn't be checked; show `PORTAL_BLOCKED_TEXT.MINE` (never that it failed a malware
 * scan) and let the person remove it and upload it again. On submit only a CHECKING or READY file
 * answers a required slot (`intakeUploadCounts` on the database's scan status: PENDING and CLEAN);
 * a BLOCKED one never does, but every file counts toward the file limits until it is removed.
 */
export const IntakeUpload = z.object({
  id: z.uuid(),
  /** The upload field's key (documents.intake_slot; lead_uploads.slot in Begin Online). */
  slot: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['CHECKING', 'READY', 'BLOCKED']),
  uploadedAt: DateTime,
});
export type IntakeUpload = z.infer<typeof IntakeUpload>;
export const IntakeUploadList = z.object({
  items: z.array(IntakeUpload).max(INTAKE_LIMITS.maxFiles),
});

/**
 * What the person sees for each scan status (as R5's My Documents): INFECTED and FAILED are both
 * BLOCKED, so the screen never says a file failed the malware scan.
 */
export const INTAKE_UPLOAD_STATUS = {
  PENDING: 'CHECKING',
  CLEAN: 'READY',
  INFECTED: 'BLOCKED',
  FAILED: 'BLOCKED',
} as const satisfies Record<ScanStatus, IntakeUpload['status']>;

const { fileName, contentType, sizeBytes, sha256 } = CreateMyUploadRequest.shape;

/**
 * Step 1 of an upload for one slot (then the browser PUTs the file and calls `confirmUpload`, as
 * R5's `uploadFile()` does): R5's file rules (PDF, JPG, PNG, .xlsx or .docx, at most 10 MB, the
 * name's ending fitting its type). 400 for a slot that isn't an upload field of the form; 409
 * TOO_MANY_FILES when the slot has its field's `maxFiles` or the form has
 * INTAKE_LIMITS.maxFiles, counting every file (blocked ones too). Step 3 (`confirmUpload`) checks
 * both limits again, inside the transaction that adds the file, and answers 409 TOO_MANY_FILES
 * too: several uploads started at once each got a ticket, and only those that still fit are kept.
 */
export const CreateIntakeUploadRequest = z
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
export type CreateIntakeUploadRequest = z.input<typeof CreateIntakeUploadRequest>;

/**
 * What people see for 503 ENCRYPTION_UNAVAILABLE (INTAKE_ERRORS and BEGIN_ONLINE_ERRORS): a save
 * or submit with a new SSN or EIN while the firm's key can't be used. Nothing was saved.
 */
export const INTAKE_NUMBERS_UNAVAILABLE =
  "Your SSN or EIN can't be saved right now, so nothing was saved. Please try again in a few minutes.";

/**
 * What people see for 400 TOO_MANY_NUMBERS (INTAKE_ERRORS and BEGIN_ONLINE_ERRORS): one save or
 * submit holds more than 120 new SSNs and EINs (the API's MAX_SEALED_NUMBERS_PER_SAVE; Annual Tax
 * allows 102). Nothing was saved.
 */
export const INTAKE_TOO_MANY_NUMBERS =
  'This step has too many new SSNs or EINs to save at once. Please save fewer rows, then add the rest.';

// ---------- The client's intakes (portal) ----------
export const IntakeId = z.uuid();
export const IntakeUploadId = z.uuid();

/** The statuses in which the client can still change the answers and submit. */
export const INTAKE_EDITABLE_STATUSES = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'] as const;

/** What the client sees for each status (the firm accepts before it shows "Completed"). */
export const INTAKE_STATUS_LABELS = {
  SENT: 'Not Started',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  NEEDS_CORRECTION: 'Needs Correction',
  UNDER_REVIEW: 'Under Review',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
} as const satisfies Record<IntakeStatus, string>;

/**
 * The Intake Forms tab's seven cards and the forms each opens. A card opens the client's open
 * intake of one of its forms; without one it shows the contact path (Send a Message). Octavia
 * confirms the mapping; "Other Tax Services" has no form yet.
 */
export const INTAKE_CARDS = [
  { key: 'PERSONAL_TAX', label: 'Personal Tax Preparation', forms: ['ANNUAL_TAX'] },
  {
    key: 'BUSINESS_TAX',
    label: 'Business Tax Preparation',
    forms: ['ANNUAL_TAX', 'QUARTERLY_TAX'],
  },
  { key: 'TAX_PLANNING', label: 'Tax Planning & Strategy', forms: ['TAX_PLANNING'] },
  { key: 'BOOKKEEPING', label: 'Bookkeeping Services', forms: ['BOOKKEEPING'] },
  { key: 'PAYROLL', label: 'Payroll Services', forms: ['PAYROLL'] },
  {
    key: 'BUSINESS_DEVELOPMENT',
    label: 'Business Development & Advisory',
    forms: ['BUSINESS_DEVELOPMENT'],
  },
  { key: 'OTHER_TAX', label: 'Other Tax Services', forms: [] },
] as const satisfies readonly { key: string; label: string; forms: readonly IntakeFormKey[] }[];

/**
 * The firm's request for changes (intakes.correction_note and correction_requested_at): set
 * exactly while the intake is NEEDS_CORRECTION, null otherwise.
 */
export const IntakeCorrection = z.object({
  /** The firm's note to the client (at most 2,000 characters). */
  note: z.string(),
  requestedAt: DateTime,
});
export type IntakeCorrection = z.infer<typeof IntakeCorrection>;

/** One row of the Intake Forms tab. */
export const MyIntakeListItem = z.object({
  id: z.uuid(),
  form: IntakeFormKey,
  /** The form's title, e.g. "Annual Tax Intake Form". */
  title: z.string(),
  /**
   * The service it is for: `id` is the client's engagement (engagements.id), not the firm's
   * service catalogue entry. The agreements to sign come from
   * `api.myIntakeAgreements(slug).block(intakeId)`, which resolves the service itself.
   */
  service: z.object({ id: z.uuid(), title: z.string() }),
  status: IntakeStatus,
  dueOn: CalendarDate.nullable(),
  /** The version shown: the open draft, or the newest submitted one. */
  version: z.number().int().min(1),
  /** When the newest version was submitted. */
  submittedAt: DateTime.nullable(),
  /** Set exactly while NEEDS_CORRECTION. */
  correction: IntakeCorrection.nullable(),
  updatedAt: DateTime,
});
export type MyIntakeListItem = z.infer<typeof MyIntakeListItem>;

/** GET /portal/{firmSlug}/me/intakes: open ones first (by due date), then the newest. */
export const MyIntakeList = z.object({ items: z.array(MyIntakeListItem).max(200) });

/**
 * GET /portal/{firmSlug}/me/intakes/{id}: the form, its answers and files. A full SSN or EIN in
 * the answers fails to parse (only `{ last4 }` may come back). The agreements to sign are not
 * here: the review step reads them from R14's `api.myIntakeAgreements(slug).block(intakeId)`.
 */
export const MyIntake = MyIntakeListItem.extend({
  definition: IntakeFormDefinition,
  /** For `{taxYear}` in the texts: the service's tax year, or the current one. */
  taxYear: z.number().int(),
  answers: IntakeAnswers,
  uploads: z.array(IntakeUpload).max(INTAKE_LIMITS.maxFiles),
  /**
   * Steps saved at least once (intake_submissions.saved_steps; the stepper's ticks; resume at the
   * first one missing).
   */
  savedSteps: z.array(z.string()).max(10),
  /**
   * Who signed the newest submitted version, and when (R14's signature evidence: the printed name
   * and the database's time); null until the first submit.
   */
  signature: z.object({ printedName: z.string(), signedAt: DateTime }).nullable(),
  /** False for spouse and authorized logins, and outside the editable statuses. */
  canEdit: z.boolean(),
  canSubmit: z.boolean(),
}).superRefine(refuseFullNumbers);
export type MyIntake = z.infer<typeof MyIntake>;

/** Stable `error.code` values of the intake modules, besides the generic ones in ApiError. */
export const IntakeErrorCode = z.enum([
  /**
   * 409: the intake is not open for changes (SUBMITTED, UNDER_REVIEW, COMPLETED or ARCHIVED). A
   * NEEDS_CORRECTION intake is open again.
   */
  'INTAKE_LOCKED',
  /** 410: the intake expired; the client asks the firm to reopen it. */
  'INTAKE_EXPIRED',
  /**
   * 409: the slot holds its field's `maxFiles` or the form holds INTAKE_LIMITS.maxFiles; every
   * file counts, blocked ones too.
   */
  'TOO_MANY_FILES',
  /**
   * 503 on a save or submit that holds a new SSN or EIN: it can't be sealed with the firm's key
   * right now (no key yet, KMS down). Nothing is saved; try again later.
   */
  'ENCRYPTION_UNAVAILABLE',
  /** 400 on a save or submit with more than 120 new SSNs and EINs; nothing is saved. */
  'TOO_MANY_NUMBERS',
  /**
   * The submit's signing codes (R14's IntakeSigningErrorCode): 409 NO_INTAKE_AGREEMENT, 409
   * AGREEMENT_OUTDATED (`details`: R14's AgreementOutdatedDetails, the current block; until
   * ApiRequestError keeps `details`, reload the block), 400 ACKNOWLEDGMENT_REQUIRED, 400
   * SIGNATURE_MISMATCH, and 409 TERMS_OUTDATED (Begin Online only; a portal submit never answers
   * it, since it sends no `acceptLegal`).
   */
  ...IntakeSigningErrorCode.options,
]);
export type IntakeErrorCode = z.infer<typeof IntakeErrorCode>;

/**
 * What users see for these codes: `errorMessage(error, { ...DOCUMENT_ERRORS, ...INTAKE_ERRORS })`
 * (an upload can also answer R5's codes: UPLOAD_EXPIRED, UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED,
 * FILE_HAS_MACROS, and in the portal NO_OPEN_SERVICE). A submit's 400 VALIDATION_FAILED carries
 * `details: { issues }`; a screen reruns `checkIntakeAnswers` to place them on the form.
 */
export const INTAKE_ERRORS = {
  INTAKE_LOCKED: 'This form has been submitted and can no longer be changed.',
  INTAKE_EXPIRED: 'This form has expired. Contact your firm to reopen it.',
  TOO_MANY_FILES: 'There is no room for more files here. Remove a file to add another.',
  ENCRYPTION_UNAVAILABLE: INTAKE_NUMBERS_UNAVAILABLE,
  TOO_MANY_NUMBERS: INTAKE_TOO_MANY_NUMBERS,
  ...INTAKE_SIGNING_ERRORS,
} as const satisfies Record<IntakeErrorCode, string>;
