import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { text } from '../clients/text.js';
import { AgreementScope, ScanStatus, SignatureMethod } from '../db-enums.js';
import { DownloadLink, FileName, UPLOAD_LIMITS } from '../documents/schemas.js';
import { ServiceRef } from '../engagements/schemas.js';
import { SignatureCaptureInput } from '../esign/capture.js';
import { IntakeFormKey } from '../intake/definition.js';

// Intake agreements (R14; Rasel's decision 3, Oct 8). Each firm keeps versioned agreements: the
// firm-wide one (every Begin Online form and portal intake) and up to 9 extras for one service.
// Every version has Markdown text shown in the form and a PDF original to download. Before an
// intake submits, the signer ticks the required acknowledgments and signs (IntakeSignatureInput,
// sent with R11's submit). The record pins each version and its SHA-256 values, the database's
// time, IP and user agent.
//
// Firm routes (Owner and Admin): /api/v1/business/agreements/...
// Begin Online (no sign-in, the firm from its slug): /api/v1/portal/{firmSlug}/intake-agreements
// Portal intake (signed-in client): /api/v1/portal/{firmSlug}/me/intakes/{intakeId}/agreements
// The PDF upload uses the documents pattern in three calls (createUpload, PUT, confirmUpload);
// a version can link a PDF only once its scan is CLEAN. With AGREEMENT_PDF_REQUIRED on (the
// default), publishing without a CLEAN PDF answers 409 PDF_REQUIRED (publish only: a submit
// never answers it, since the signature sends nothing for the PDF and the API pins the version's
// pdf_sha256 itself).
// Firm screens show errors with `errorMessage(error, AGREEMENT_ERRORS)`; the submit-time codes
// are INTAKE_SIGNING_ERRORS, which R11's INTAKE_ERRORS and BEGIN_ONLINE_ERRORS include.
// Responses are plain objects; requests are strict (unknown fields such as businessId are refused).
//
// Rendering (the only wall: the block is served to signed-out visitors on the portal origin that
// every firm shares): agreement text is Markdown rendered with raw HTML off, images off, and links
// only to https: and mailto: (any other link renders as plain text); never
// dangerouslySetInnerHTML. R14 builds `<Markdown>` in packages/ui for this (branch
// rasel/R14-markdown, pending); screens use only that component.

const DateTime = z.iso.datetime({ offset: true });
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'Not a SHA-256');
/** A version number: the columns are INTEGER, so at most 2,147,483,647 (else Postgres 500s). */
const VersionNumber = z.number().int().min(1).max(2_147_483_647);

export { AgreementScope };

/** Service agreements per service (unarchived); with the firm-wide one, a signature's maximum. */
export const MAX_SERVICE_AGREEMENTS = 9;
/** Agreements in one signature: the firm-wide one plus MAX_SERVICE_AGREEMENTS. */
export const MAX_SIGNED_AGREEMENTS = MAX_SERVICE_AGREEMENTS + 1;

// ---------- Text ----------
/** Stable id of an acknowledgment within a version: lower-case letters, digits and _. */
export const AcknowledgmentKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use 2 to 40 lower-case letters, digits or _');
export type AcknowledgmentKey = z.infer<typeof AcknowledgmentKey>;

/** One checkbox the signer ticks: a one-line label and the full text (several lines). */
export const Acknowledgment = z.strictObject({
  key: AcknowledgmentKey,
  label: text(120, 'one', 'Enter the label'),
  text: text(2000, 'many', 'Enter the text'),
  /** Required ones must be ticked before the intake can submit. */
  required: z.boolean(),
});
export type Acknowledgment = z.infer<typeof Acknowledgment>;

/** An acknowledgment in a response (a plain object: extra fields are ignored). */
export const AcknowledgmentView = z.object({
  key: z.string(),
  label: z.string(),
  text: z.string(),
  required: z.boolean(),
});
export type AcknowledgmentView = z.infer<typeof AcknowledgmentView>;

/** 0 to 8, with different keys. */
export const Acknowledgments = z
  .array(Acknowledgment)
  .max(8, 'Use at most 8 acknowledgments')
  .refine((list) => new Set(list.map((a) => a.key)).size === list.length, {
    message: 'Each acknowledgment needs its own key',
  });

/**
 * The text the signer reads: Markdown (see "Rendering" above), not trimmed, since its SHA-256 is
 * pinned. No control characters but tab, line feed and carriage return (Postgres text cannot hold
 * NUL), no lone surrogates, and no bidi embeddings, overrides or isolates (U+202A to U+202E,
 * U+2066 to U+2069), which could make signed text read differently from what is stored.
 */
export const AgreementMarkdown = z
  .string()
  .max(100_000, 'Use at most 100,000 characters')
  .regex(/^(?:[^\p{Cc}\p{Cs}‪-‮⁦-⁩]|[\t\n\r])*$/u, 'Remove the special characters')
  .refine((body) => body.trim().length > 0, 'Write the text first');

// ---------- Firm side ----------
/**
 * POST /business/agreements: a new agreement series (no version yet). At most
 * MAX_SERVICE_AGREEMENTS unarchived service agreements per service (409 SERVICE_AGREEMENT_LIMIT),
 * so a signature never needs more than MAX_SIGNED_AGREEMENTS.
 */
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
  expectedCurrentVersion: VersionNumber.nullable(),
  title: text(200, 'one', 'Enter the title'),
  bodyMarkdown: AgreementMarkdown,
  acknowledgments: Acknowledgments,
  /** A confirmed, CLEAN agreement file (409 FILE_NOT_READY or FILE_BLOCKED otherwise). */
  pdfFileId: z.uuid().nullable().optional(),
  /**
   * Display only ("Effective October 1, 2026"). A new version is current from the moment it is
   * published (#155), so a future date does not delay it.
   */
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
  version: VersionNumber,
  title: z.string(),
  effectiveDate: CalendarDate.nullable(),
  publishedAt: DateTime,
  publishedBy: MemberRef.nullable(),
  pdf: AgreementPdf.nullable(),
});
export type AgreementVersionSummary = z.infer<typeof AgreementVersionSummary>;

/**
 * GET /business/agreements: the firm-wide agreement first, then service ones by sortOrder, then
 * by creation (oldest first), then by id. There is no reorder call yet, so sortOrder is 0 for
 * every service agreement and the creation order decides.
 */
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
/**
 * GET /business/agreements: the firm's agreements, plus its unarchived services (sort order,
 * creation, then id) so the editor can pick one for a service agreement.
 */
export const FirmAgreementList = z.object({
  items: z.array(FirmAgreementSummary),
  services: z.array(ServiceRef),
});
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
  acknowledgments: z.array(AcknowledgmentView),
});
export type AgreementVersion = z.infer<typeof AgreementVersion>;

/** A version number in a path. */
export const AgreementVersionNumber = VersionNumber;
/** An id in a path (an agreement, an agreement file or an intake). */
export const AgreementPathId = z.uuid();

// ---------- PDF originals ----------
/** PDF only, at most 10 MB (the same limit as documents). */
export const AGREEMENT_PDF_LIMITS = { maxBytes: UPLOAD_LIMITS.maxBytes, maxPages: 200 } as const;

/**
 * POST /business/agreements/files/uploads: answers an UploadTicket (documents). Takes the facts
 * `uploadFile()` sends (UploadFileFacts), so `start: (facts) => api.agreements.createUpload(facts)`
 * works; contentType must be application/pdf and the name must end in .pdf.
 */
export const CreateAgreementUploadRequest = z.strictObject({
  fileName: FileName.refine((name) => /.\.pdf$/i.test(name), 'Upload a PDF file'),
  contentType: z.literal('application/pdf', 'Upload a PDF file'),
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

// ---------- The block (Begin Online and the portal intake) ----------
/**
 * GET /portal/{firmSlug}/intake-agreements?form=BOOKKEEPING (Begin Online, no sign-in): the
 * agreements to sign for that form. The API resolves the firm's unarchived Begin Online service
 * of that kind; a firm with no such service answers 404. The signed-in portal intake uses
 * GET /portal/{firmSlug}/me/intakes/{intakeId}/agreements instead (resolved from the intake's
 * form; another client's intake answers 404).
 */
export const IntakeAgreementsQuery = z.strictObject({ form: IntakeFormKey });
export type IntakeAgreementsQuery = z.input<typeof IntakeAgreementsQuery>;

/** One agreement in the block: its current version, in full. */
export const IntakeAgreement = z.object({
  agreementId: z.uuid(),
  scope: AgreementScope,
  version: VersionNumber,
  title: z.string(),
  effectiveDate: CalendarDate.nullable(),
  publishedAt: DateTime,
  bodyMarkdown: z.string(),
  bodySha256: Sha256,
  acknowledgments: z.array(AcknowledgmentView),
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
 * The firm-wide agreement comes first, then the service's extras in the firm list's order.
 * `legal` names the Terms and Privacy versions Begin Online asks to accept. It is null unless
 * the firm has published both (#155 records both or neither); then Begin Online asks for no
 * acceptance. The portal block's `legal` is always null: a client accepted them at sign-up.
 */
export const IntakeAgreementBlock = z.object({
  ready: z.boolean(),
  agreements: z.array(IntakeAgreement),
  legal: z
    .object({
      terms: z.object({ version: VersionNumber }),
      privacy: z.object({ version: VersionNumber }),
    })
    .nullable(),
});
export type IntakeAgreementBlock = z.infer<typeof IntakeAgreementBlock>;

/**
 * `error.details` of 409 AGREEMENT_OUTDATED: the current block, for the review step to show
 * again (B's IntakeAgreementOutdatedDetails becomes this). `ApiRequestError` does not keep
 * `details` yet: until it does, screens reload the block.
 */
export const AgreementOutdatedDetails = IntakeAgreementBlock;
export type AgreementOutdatedDetails = IntakeAgreementBlock;

// ---------- Signing (sent with R11's submit) ----------
/**
 * `signature` in the Begin Online and portal intake submit bodies. `agreements` is exactly the
 * set shown (each with the version and bodySha256 the block gave); a newer version answers 409
 * AGREEMENT_OUTDATED with the current block in `details`. `acknowledgments` lists only the
 * ticked ones, each once and each for an agreement in `agreements` (400 VALIDATION_FAILED); a
 * missing required one answers 400 ACKNOWLEDGMENT_REQUIRED. Nothing is sent for the PDF: the
 * API pins the version's pdf_sha256.
 * `acceptLegal` is Begin Online's Terms and Privacy tick: required there when the block's `legal`
 * is set (400 VALIDATION_FAILED if missing), with the versions shown (409 TERMS_OUTDATED if either
 * changed); refused on a portal submit (400 VALIDATION_FAILED).
 */
export const IntakeSignatureInput = z
  .strictObject({
    agreements: z
      .array(
        z.strictObject({
          agreementId: z.uuid(),
          version: VersionNumber,
          bodySha256: Sha256,
        }),
      )
      .min(1, 'Sign the agreement first')
      .max(MAX_SIGNED_AGREEMENTS)
      .refine((list) => new Set(list.map((a) => a.agreementId)).size === list.length, {
        message: 'Each agreement once',
      }),
    acknowledgments: z
      .array(z.strictObject({ agreementId: z.uuid(), key: AcknowledgmentKey }))
      .max(80),
    acceptLegal: z
      .strictObject({ termsVersion: VersionNumber, privacyVersion: VersionNumber })
      .nullable()
      .optional(),
    signer: SignatureCaptureInput,
    /** Title or position, for business services (intake_signatures allows 100 characters). */
    title: text(100, 'one', 'Enter your title').nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const signed = new Set(v.agreements.map((a) => a.agreementId));
    const seen = new Set<string>();
    v.acknowledgments.forEach((a, i) => {
      const id = `${a.agreementId}:${a.key}`;
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['acknowledgments', i], message: 'Each box once' });
      }
      seen.add(id);
      if (!signed.has(a.agreementId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['acknowledgments', i, 'agreementId'],
          message: 'This box is for an agreement that is not signed',
        });
      }
    });
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
  method: SignatureMethod,
  title: z.string().nullable(),
  signedAt: DateTime,
  agreements: z.array(
    z.object({
      agreementId: z.uuid(),
      version: VersionNumber,
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
  legal: z.object({ termsVersion: VersionNumber, privacyVersion: VersionNumber }).nullable(),
  /** SHA-256 of the intake answers signed, set by the database (#155's answers_sha256). */
  answersSha256: Sha256,
  evidenceSha256: Sha256,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type IntakeSignatureSummary = z.infer<typeof IntakeSignatureSummary>;

// ---------- Errors ----------
/** Stable `error.code` values of the firm routes, besides the generic ones in ApiError. */
export const AgreementErrorCode = z.enum([
  /** 409 (create): the firm already has an unarchived firm-wide agreement. */
  'FIRM_WIDE_EXISTS',
  /** 409 (create): the service already has MAX_SERVICE_AGREEMENTS unarchived agreements. */
  'SERVICE_AGREEMENT_LIMIT',
  /** 409 (archive): the firm-wide agreement can't be archived; publish a new version instead. */
  'FIRM_WIDE_REQUIRED',
  /** 409 (publish): someone published a newer version since the form opened; reload it. */
  'VERSION_CONFLICT',
  /** 409 (publish): the agreement is archived. */
  'AGREEMENT_ARCHIVED',
  /**
   * 409 (publish only): every version needs a CLEAN PDF original (AGREEMENT_PDF_REQUIRED). A
   * submit never answers it.
   */
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
]);
export type AgreementErrorCode = z.infer<typeof AgreementErrorCode>;

/** What users see: `errorMessage(error, AGREEMENT_ERRORS)` on every firm agreement screen. */
export const AGREEMENT_ERRORS: Record<AgreementErrorCode, string> = {
  FIRM_WIDE_EXISTS: 'The firm already has a firm-wide agreement. Publish a new version of it.',
  SERVICE_AGREEMENT_LIMIT:
    'This service already has 9 agreements. Archive one before you add another.',
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
};

/** The `error.code` values a Begin Online or portal intake submit answers for its signature. */
export const IntakeSigningErrorCode = z.enum([
  /** 409: the firm has no published firm-wide agreement yet. */
  'NO_INTAKE_AGREEMENT',
  /** 409: the firm published a newer version; `details` is AgreementOutdatedDetails. */
  'AGREEMENT_OUTDATED',
  /** 400: a required acknowledgment is not ticked. */
  'ACKNOWLEDGMENT_REQUIRED',
  /**
   * 400: the typed signature does not match the printed name. SignatureCaptureInput already
   * refuses an ordinary mismatch (400 VALIDATION_FAILED on signer.typedSignature); this code is
   * for the rare names where Postgres' app_signature_name_key differs from signatureNameKey (a
   * no-break space U+00A0, which JavaScript's \s matches). The API maps the
   * intake_signatures_typed_matches check violation to it, never to a 500.
   */
  'SIGNATURE_MISMATCH',
  /** 409 (Begin Online): the Terms or Privacy Policy changed; read and accept again. */
  'TERMS_OUTDATED',
]);
export type IntakeSigningErrorCode = z.infer<typeof IntakeSigningErrorCode>;

/** What signers see; R11 spreads it into INTAKE_ERRORS and BEGIN_ONLINE_ERRORS. */
export const INTAKE_SIGNING_ERRORS: Record<IntakeSigningErrorCode, string> = {
  NO_INTAKE_AGREEMENT: "This form can't be signed right now. Please contact the firm.",
  AGREEMENT_OUTDATED: 'The agreement has been updated. Please read the new version and sign again.',
  ACKNOWLEDGMENT_REQUIRED: 'Please tick each required box to continue.',
  SIGNATURE_MISMATCH: 'Type your name exactly as printed.',
  TERMS_OUTDATED: 'The Terms or Privacy Policy changed. Please read and accept them again.',
};
