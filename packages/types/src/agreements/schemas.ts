import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { AgreementScope, ScanStatus } from '../db-enums.js';
import { DownloadLink, UPLOAD_LIMITS } from '../documents/schemas.js';
import { SignatureCaptureInput, SignatureText } from '../esign/capture.js';

// Intake agreements (R14; Rasel's decision 3, Oct 8). Each firm keeps versioned agreements: the
// firm-wide one (every Begin Online form and portal intake) and optional extras for one service.
// Every version has Markdown text shown in the form and a PDF original to download. Before an
// intake submits, the signer ticks the required acknowledgments and signs (IntakeSignatureInput,
// sent with R11's submit). The record pins each version and its SHA-256 values, the database's
// time, IP and user agent.
//
// Firm routes (Owner and Admin): /api/v1/business/agreements/...
// Public routes (no sign-in, the firm from its slug): /api/v1/portal/{firmSlug}/intake-agreements
// The PDF upload uses the documents pattern in three calls (createUpload, PUT, confirmUpload);
// a version can link a PDF only once its scan is CLEAN. With AGREEMENT_PDF_REQUIRED on (the
// default), publishing without a CLEAN PDF answers 409 PDF_REQUIRED.
// Screens show errors with `errorMessage(error, AGREEMENT_ERRORS)`.
// Responses are plain objects; requests are strict (unknown fields such as businessId are refused).

const DateTime = z.iso.datetime({ offset: true });
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'Not a SHA-256');

export { AgreementScope };

// ---------- Text ----------
/** Stable id of an acknowledgment within a version: lower-case letters, digits and _. */
export const AcknowledgmentKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use 2 to 40 lower-case letters, digits or _');
export type AcknowledgmentKey = z.infer<typeof AcknowledgmentKey>;

const words = (max: number, what: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${what}`)
    .max(max, `Use at most ${max.toLocaleString('en-US')} characters`);

/** One checkbox the signer ticks: a short label and the full text. */
export const Acknowledgment = z.strictObject({
  key: AcknowledgmentKey,
  label: words(120, 'label'),
  text: words(2000, 'text'),
  /** Required ones must be ticked before the intake can submit. */
  required: z.boolean(),
});
export type Acknowledgment = z.infer<typeof Acknowledgment>;

/** 0 to 8, with different keys. */
export const Acknowledgments = z
  .array(Acknowledgment)
  .max(8, 'Use at most 8 acknowledgments')
  .refine((list) => new Set(list.map((a) => a.key)).size === list.length, {
    message: 'Each acknowledgment needs its own key',
  });

/** The text the signer reads: Markdown, rendered with raw HTML off (as Terms and Privacy). */
export const AgreementMarkdown = z
  .string()
  .max(100_000, 'Use at most 100,000 characters')
  .refine((body) => body.trim().length > 0, 'Write the text first');

// ---------- Firm side ----------
/** POST /business/agreements: a new agreement series (no version yet). */
export const CreateAgreementRequest = z
  .strictObject({ scope: AgreementScope, serviceId: z.uuid().nullable().optional() })
  .refine((v) => (v.scope === 'SERVICE') === (v.serviceId != null), {
    path: ['serviceId'],
    message: 'A service agreement needs a service; the firm-wide one has none',
  });
export type CreateAgreementRequest = z.input<typeof CreateAgreementRequest>;

/**
 * POST /business/agreements/{id}/versions: publish the next version. Versions are never edited.
 * `expectedCurrentVersion` is the version the form was opened on (null for the first); another
 * publish in between answers 409 VERSION_CONFLICT. The firm-wide agreement needs at least one
 * required acknowledgment (400 VALIDATION_FAILED).
 */
export const PublishAgreementVersionRequest = z.strictObject({
  expectedCurrentVersion: z.number().int().positive().nullable(),
  title: words(200, 'title'),
  bodyMarkdown: AgreementMarkdown,
  acknowledgments: Acknowledgments,
  /** A confirmed, CLEAN agreement file (409 FILE_NOT_READY or FILE_BLOCKED otherwise). */
  pdfFileId: z.uuid().nullable().optional(),
  effectiveDate: CalendarDate.nullable().optional(),
});
export type PublishAgreementVersionRequest = z.input<typeof PublishAgreementVersionRequest>;

/** The PDF original of a version. */
export const AgreementPdf = z.object({
  fileId: z.uuid(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  sha256: Sha256,
});
export type AgreementPdf = z.infer<typeof AgreementPdf>;

/** One published version, as listed. */
export const AgreementVersionSummary = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  effectiveDate: CalendarDate.nullable(),
  publishedAt: DateTime,
  publishedBy: MemberRef.nullable(),
  pdf: AgreementPdf.nullable(),
});
export type AgreementVersionSummary = z.infer<typeof AgreementVersionSummary>;

/** GET /business/agreements: the firm-wide agreement first, then service ones by sort order. */
export const FirmAgreementSummary = z.object({
  id: z.uuid(),
  scope: AgreementScope,
  service: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  sortOrder: z.number().int(),
  archivedAt: DateTime.nullable(),
  /** Null until the first version is published. */
  current: AgreementVersionSummary.nullable(),
  versionCount: z.number().int(),
});
export type FirmAgreementSummary = z.infer<typeof FirmAgreementSummary>;
export const FirmAgreementList = z.object({ items: z.array(FirmAgreementSummary) });
export type FirmAgreementList = z.infer<typeof FirmAgreementList>;

/** GET /business/agreements/{id}: the series with every version, newest first. */
export const FirmAgreementDetail = FirmAgreementSummary.extend({
  versions: z.array(AgreementVersionSummary),
});
export type FirmAgreementDetail = z.infer<typeof FirmAgreementDetail>;

/** GET /business/agreements/{id}/versions/{version}: one version in full. */
export const AgreementVersion = AgreementVersionSummary.extend({
  agreementId: z.uuid(),
  bodyMarkdown: z.string(),
  /** SHA-256 of bodyMarkdown (UTF-8), set by the database. */
  bodySha256: Sha256,
  acknowledgments: z.array(Acknowledgment),
});
export type AgreementVersion = z.infer<typeof AgreementVersion>;

export const AgreementVersionNumber = z.number().int().positive();

// ---------- PDF originals ----------
/** PDF only, at most 10 MB (the same limit as documents). */
export const AGREEMENT_PDF_LIMITS = { maxBytes: UPLOAD_LIMITS.maxBytes, maxPages: 200 } as const;

/** POST /business/agreements/files/uploads: answers an UploadTicket (documents). */
export const CreateAgreementUploadRequest = z.strictObject({
  fileName: z
    .string()
    .trim()
    .min(1, 'The file needs a name')
    .max(255, 'Use a file name of at most 255 characters')
    .regex(
      /^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}/\\]+$/u,
      'Rename the file: its name has characters that are not allowed',
    )
    .refine((name) => /.\.pdf$/i.test(name), 'Upload a PDF file'),
  sizeBytes: z
    .number()
    .int()
    .min(1, 'The file is empty')
    .max(AGREEMENT_PDF_LIMITS.maxBytes, 'The file is larger than 10 MB'),
  sha256: Sha256,
});
export type CreateAgreementUploadRequest = z.input<typeof CreateAgreementUploadRequest>;

/**
 * POST /business/agreements/files/confirm (with ConfirmUploadRequest) and
 * GET /business/agreements/files/{fileId}: the file and its scan. Poll until CLEAN.
 */
export const AgreementFile = z.object({
  fileId: z.uuid(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  sha256: Sha256,
  scanStatus: ScanStatus,
});
export type AgreementFile = z.infer<typeof AgreementFile>;

export { DownloadLink };

// ---------- Public block (Begin Online and the portal intake tab) ----------
/** GET /portal/{firmSlug}/intake-agreements?serviceId=: the agreements to sign for a service. */
export const IntakeAgreementsQuery = z.strictObject({ serviceId: z.uuid().optional() });
export type IntakeAgreementsQuery = z.input<typeof IntakeAgreementsQuery>;

/** One agreement in the block: its current version, in full. */
export const IntakeAgreement = z.object({
  agreementId: z.uuid(),
  scope: AgreementScope,
  version: z.number().int().positive(),
  title: z.string(),
  effectiveDate: CalendarDate.nullable(),
  publishedAt: DateTime,
  bodyMarkdown: z.string(),
  bodySha256: Sha256,
  acknowledgments: z.array(Acknowledgment),
  /** The PDF original. `available` shows "Download original (PDF)"; sha256 is pinned when signed. */
  pdf: z.object({
    available: z.boolean(),
    sha256: Sha256.nullable(),
    fileName: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
  }),
});
export type IntakeAgreement = z.infer<typeof IntakeAgreement>;

/**
 * The block before submit. `ready` is false while the firm has no published firm-wide version:
 * the form shows "This form isn't available yet" (submit would answer NO_INTAKE_AGREEMENT).
 * The firm-wide agreement comes first, then the service's extras. `legal` names the Terms and
 * Privacy versions Begin Online asks to accept (null when the firm has none published).
 */
export const IntakeAgreementBlock = z.object({
  ready: z.boolean(),
  agreements: z.array(IntakeAgreement),
  legal: z.object({
    terms: z.object({ version: z.number().int().positive() }).nullable(),
    privacy: z.object({ version: z.number().int().positive() }).nullable(),
  }),
});
export type IntakeAgreementBlock = z.infer<typeof IntakeAgreementBlock>;

// ---------- Signing (sent with R11's submit) ----------
/**
 * `signature` in the Begin Online and portal intake submit bodies. `agreements` is exactly the
 * set shown (each with the version and bodySha256 the block gave); a newer version answers 409
 * AGREEMENT_OUTDATED with the current block in `details`. `acknowledgments` lists only the
 * ticked ones; a missing required one answers 400 ACKNOWLEDGMENT_REQUIRED. `acceptLegal` is
 * Begin Online's Terms and Privacy tick (409 TERMS_OUTDATED if either changed).
 */
export const IntakeSignatureInput = z.strictObject({
  agreements: z
    .array(
      z.strictObject({
        agreementId: z.uuid(),
        version: z.number().int().positive(),
        bodySha256: Sha256,
      }),
    )
    .min(1, 'Sign the agreement first')
    .max(10)
    .refine((list) => new Set(list.map((a) => a.agreementId)).size === list.length, {
      message: 'Each agreement once',
    }),
  acknowledgments: z
    .array(z.strictObject({ agreementId: z.uuid(), key: AcknowledgmentKey }))
    .max(80),
  acceptLegal: z
    .strictObject({
      termsVersion: z.number().int().positive(),
      privacyVersion: z.number().int().positive(),
    })
    .nullable()
    .optional(),
  signer: SignatureCaptureInput,
  /** Title or position, for business services. */
  title: SignatureText.nullable().optional(),
});
export type IntakeSignatureInput = z.input<typeof IntakeSignatureInput>;

/**
 * The signature on a submitted intake version, for the lead and intake detail (R11) and the
 * portal's locked view. `ip` and `userAgent` are null except for the Owner and Admins.
 */
export const IntakeSignatureSummary = z.object({
  id: z.uuid(),
  printedName: z.string(),
  typedSignature: z.string(),
  method: z.string(),
  title: z.string().nullable(),
  signedAt: DateTime,
  agreements: z.array(
    z.object({
      agreementId: z.uuid(),
      version: z.number().int().positive(),
      title: z.string(),
      bodySha256: Sha256,
      pdfSha256: Sha256.nullable(),
    }),
  ),
  acknowledgments: z.array(
    z.object({
      agreementId: z.uuid(),
      key: z.string(),
      label: z.string(),
      text: z.string(),
      required: z.boolean(),
      checked: z.boolean(),
    }),
  ),
  legal: z.object({ termsVersion: z.number().int(), privacyVersion: z.number().int() }).nullable(),
  evidenceSha256: Sha256,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type IntakeSignatureSummary = z.infer<typeof IntakeSignatureSummary>;

// ---------- Errors ----------
/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const AgreementErrorCode = z.enum([
  /** 409 (create): the firm already has an unarchived firm-wide agreement. */
  'FIRM_WIDE_EXISTS',
  /** 409 (archive): the firm-wide agreement can't be archived; publish a new version instead. */
  'FIRM_WIDE_REQUIRED',
  /** 409 (publish): someone published a newer version since the form opened; reload it. */
  'VERSION_CONFLICT',
  /** 409 (publish): the agreement is archived. */
  'AGREEMENT_ARCHIVED',
  /** 409 (publish): every version needs a CLEAN PDF original (AGREEMENT_PDF_REQUIRED). */
  'PDF_REQUIRED',
  /** 409 (publish): the PDF is still being checked for malware. */
  'FILE_NOT_READY',
  /** 409: the PDF failed the malware check or could not be checked. */
  'FILE_BLOCKED',
  /** 409 (download): the file is still being checked. */
  'SCAN_PENDING',
  /** 409 (confirm): the stored file is not a PDF. */
  'NOT_A_PDF',
  /** 409 (confirm): the PDF has a password or is encrypted. */
  'FILE_PASSWORD_PROTECTED',
  /** 409 (confirm): the PDF has more than 200 pages. */
  'TOO_MANY_PAGES',
  /** 409 (confirm): the stored file is not what createUpload described. */
  'UPLOAD_MISMATCH',
  /** 410 (confirm): the upload ticket is too old or was used. */
  'UPLOAD_EXPIRED',
  /** 409 (submit): the firm has no published firm-wide agreement yet. */
  'NO_INTAKE_AGREEMENT',
  /** 409 (submit): the firm published a newer version; `details` holds the new block. */
  'AGREEMENT_OUTDATED',
  /** 400 (submit): a required acknowledgment is not ticked. */
  'ACKNOWLEDGMENT_REQUIRED',
  /** 400 (submit): the typed signature does not match the printed name. */
  'SIGNATURE_MISMATCH',
  /** 409 (Begin Online submit): the Terms or Privacy Policy changed; read and accept again. */
  'TERMS_OUTDATED',
]);
export type AgreementErrorCode = z.infer<typeof AgreementErrorCode>;

/** What users see: `errorMessage(error, AGREEMENT_ERRORS)` on every agreement screen. */
export const AGREEMENT_ERRORS: Record<AgreementErrorCode, string> = {
  FIRM_WIDE_EXISTS: 'The firm already has a firm-wide agreement. Publish a new version of it.',
  FIRM_WIDE_REQUIRED: 'The firm-wide agreement can’t be archived. Publish a new version instead.',
  VERSION_CONFLICT: 'Someone published a newer version. Reload to see it, then try again.',
  AGREEMENT_ARCHIVED: 'This agreement is archived, so it can’t get new versions.',
  PDF_REQUIRED: 'Upload the PDF original before publishing.',
  FILE_NOT_READY: 'The PDF is still being checked. Try again in a moment.',
  FILE_BLOCKED: 'This PDF couldn’t be checked, so it can’t be used. Upload it again.',
  SCAN_PENDING: 'This file is still being checked. Try again in a moment.',
  NOT_A_PDF: 'This file isn’t a PDF. Save it as a PDF and upload it again.',
  FILE_PASSWORD_PROTECTED: 'This PDF has a password. Remove the password and upload it again.',
  TOO_MANY_PAGES: 'A PDF original can have at most 200 pages.',
  UPLOAD_MISMATCH: 'This file changed during upload. Upload it again.',
  UPLOAD_EXPIRED: 'This upload has expired. Please try again.',
  NO_INTAKE_AGREEMENT: 'This form isn’t available yet. Please contact the firm.',
  AGREEMENT_OUTDATED:
    'The firm updated its agreement. Please read it again and tick the boxes before you submit.',
  ACKNOWLEDGMENT_REQUIRED: 'Tick every required box before you submit.',
  SIGNATURE_MISMATCH: 'Type your name exactly as you printed it.',
  TERMS_OUTDATED: 'The Terms or Privacy Policy changed. Please read and accept them again.',
};
