import { z } from 'zod';
import { SignatureMethod } from '../db-enums.js';
import { fileNameFitsType, UPLOAD_LIMITS } from '../documents/schemas.js';
import { text } from '../clients/text.js';
import { SignatureCaptureInput, SignatureText } from './capture.js';
import {
  EsignFieldType,
  EsignRecipientKind,
  EsignRecipientRole,
  EsignRequestStatus,
} from './enums.js';
import { EsignContentType, EsignFieldId } from './schemas.js';

// Firm Sign (R13), signer side: the pages a recipient opens from their email, on the portal host
// at /{slug}/sign#t=<token>, and the portal's Signature center for signed-in clients.
//
// Signer routes are public, under /api/v1/portal/{slug}/sign (docs/AUTH-DESIGN.md, Firm Sign):
// - The link token stays in the URL fragment. The page posts it once to `session`, which answers
//   the signer's state and sets the HttpOnly cookie `fv_sign_{slug}` (path /api/v1/portal/{slug}/sign).
//   Every other signer call uses that cookie; the page never stores the token.
// - Any unknown, expired, used or other firm's link, or a missing or stale cookie, answers the one
//   404 LINK_INVALID. Firm Sign off, or an inactive firm, answers 404 too.
// - Steps, in order: VERIFY_EMAIL or VERIFY_ACCESS_CODE (when the sender asked for it), CONSENT,
//   then SIGN. A signer whose turn has not come is WAITING; one who finished is DONE.
// - A signed-in client who starts from the Signature center (`api.mySignatures(slug).startSigning`)
//   skips the email code: the portal sign-in already proved who they are.
// - Responses never carry the request's internal note or another signer's field values.

/** The email code: 6 digits, valid 15 minutes, 5 tries. */
export const ESIGN_CODE_LENGTH = 6;
export const ESIGN_CODE_MINUTES = 15;
export const ESIGN_CODE_TRIES = 5;
/** The completed-copy link sent after completion works this many days. */
export const ESIGN_COPY_LINK_DAYS = 30;

const DateTime = z.iso.datetime({ offset: true });

/**
 * Where the signer is:
 * - VERIFY_EMAIL: send and enter the email code (`sendCode`, `verifyCode`).
 * - VERIFY_ACCESS_CODE: enter the code the sender gave them (`verifyAccessCode`).
 * - CONSENT: read and accept the firm's e-signature consent (`consent`, `acceptConsent`).
 * - SIGN: the document is open to them (`envelope`, `adopt`, `finish`, `decline`).
 * - WAITING: someone before them signs first; they get an email when it is their turn.
 * - DONE: they signed or approved. The others may still be signing.
 * - DECLINED: they declined.
 * - CLOSED: the request was completed without them, declined by someone else, expired or voided.
 * - COPY: a completed-copy link (`copy`, `downloadCopy`), after VERIFY_EMAIL.
 */
export const SignerStep = z.enum([
  'VERIFY_EMAIL',
  'VERIFY_ACCESS_CODE',
  'CONSENT',
  'SIGN',
  'WAITING',
  'DONE',
  'DECLINED',
  'CLOSED',
  'COPY',
]);
export type SignerStep = z.infer<typeof SignerStep>;

/** The signer's state: every signer call that moves them on answers it. */
export const SignerState = z.object({
  step: SignerStep,
  /** The document name and who sent it. */
  title: z.string(),
  senderName: z.string(),
  firmName: z.string(),
  /** The recipient's own name, as the sender entered it. */
  signerName: z.string(),
  /** Where the code goes, masked (j***@example.com); null unless VERIFY_EMAIL. */
  codeSentTo: z.string().nullable(),
  /** The request's status when CLOSED or COPY; null otherwise. */
  requestStatus: EsignRequestStatus.nullable(),
  /** The link's or request's expiry; null once nothing more can be done. */
  expiresAt: DateTime.nullable(),
});
export type SignerState = z.infer<typeof SignerState>;

/** POST session: the token from the URL fragment (`#t=`), 43 base64url characters. */
export const SignerSessionBody = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This link is not complete'),
});
export type SignerSessionBody = z.input<typeof SignerSessionBody>;

/**
 * POST code/send: a new 6-digit code by email (any older one stops working). 429 CODE_TOO_SOON
 * within a minute of the last one.
 */
export const SignerCodeSent = z.object({
  sentTo: z.string(),
  expiresAt: DateTime,
  /** When the next code may be asked for. */
  resendAfter: DateTime,
});
export type SignerCodeSent = z.infer<typeof SignerCodeSent>;

/** POST code/verify. 400 CODE_INVALID; 429 CODE_LOCKED after 5 wrong tries (ask for a new code). */
export const SignerVerifyCodeBody = z.strictObject({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type SignerVerifyCodeBody = z.input<typeof SignerVerifyCodeBody>;

/** POST access-code. 400 CODE_INVALID; 429 CODE_LOCKED after 5 wrong tries (ask the sender). */
export const SignerAccessCodeBody = z.strictObject({
  code: z.string().regex(/^[A-Za-z0-9]{4,20}$/, 'Enter the access code'),
});
export type SignerAccessCodeBody = z.input<typeof SignerAccessCodeBody>;

/** GET consent: the firm's e-signature consent, as published (Markdown, raw HTML off). */
export const SignerConsent = z.object({
  versionId: z.uuid(),
  version: z.number().int().min(1),
  bodyMarkdown: z.string(),
});
export type SignerConsent = z.infer<typeof SignerConsent>;

/**
 * POST consent: accept that version. 409 CONSENT_OUTDATED when the firm published a newer one
 * meanwhile (read `consent()` again).
 */
export const SignerAcceptConsentBody = z.strictObject({
  versionId: z.uuid(),
  agree: z.literal(true),
});
export type SignerAcceptConsentBody = z.input<typeof SignerAcceptConsentBody>;

/**
 * One of the signer's own fields. Position and size are fractions of the page as shown (after
 * rotation), from the top-left. SIGNATURE and INITIALS take the adopted signature; DATE_SIGNED is
 * set when they finish. `value` is a suggestion (their name, email) or what they saved.
 */
export const SignerField = z.object({
  id: z.uuid(),
  type: EsignFieldType,
  pageIndex: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  required: z.boolean(),
  label: z.string().nullable(),
  options: z.array(z.string()),
  groupKey: z.string().nullable(),
  value: z.string().nullable(),
  /** ATTACHMENT: the uploaded file's name, once uploaded. */
  attachmentName: z.string().nullable(),
});
export type SignerField = z.infer<typeof SignerField>;

/**
 * GET envelope (step SIGN): what the signer sees. `packetUrl` is the document as it stands, with
 * the sender's values and earlier signers' signatures stamped in (same-site, read with the cookie).
 */
export const SignerEnvelope = z.object({
  title: z.string(),
  /** The sender's message from the email; null when there was none. */
  message: z.string().nullable(),
  senderName: z.string(),
  firmName: z.string(),
  me: z.object({
    recipientId: z.uuid(),
    name: z.string(),
    kind: EsignRecipientKind,
    role: EsignRecipientRole,
    roleLabel: z.string().nullable(),
  }),
  packetUrl: z.string(),
  pageCount: z.number().int().min(1),
  /** Each packet page's size in PDF points as shown (after rotation). */
  pageSizes: z.array(z.object({ width: z.number(), height: z.number() })),
  /** Their own fields only. Empty when the firm placed none: a signature page is added at the end. */
  fields: z.array(SignerField),
  /** True when no fields were placed and they sign on the added signature page. */
  autoSignaturePage: z.boolean(),
  /** The adopted signature, once `adopt` ran (null before). */
  adopted: z.object({ method: SignatureMethod, hasInitials: z.boolean() }).nullable(),
  /** Everyone's progress, by name only. */
  progress: z.array(z.object({ name: z.string(), role: EsignRecipientRole, signed: z.boolean() })),
  expiresAt: DateTime,
});
export type SignerEnvelope = z.infer<typeof SignerEnvelope>;

/** A drawn or uploaded image: a PNG as base64, at most 200 KB and 1600x600 (the API checks). */
export const ESIGN_SIGNATURE_PNG_MAX_BYTES = 200 * 1024;
const PngBase64 = z
  .string()
  .max(Math.ceil(ESIGN_SIGNATURE_PNG_MAX_BYTES / 3) * 4, 'The image is too large (200 KB at most)')
  .regex(/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/, 'Use a PNG image');

/**
 * The signature a Firm Sign signer adopts: TYPED is the shared capture (esign/capture.ts: the
 * typed signature matches the printed name); DRAWN and UPLOADED carry the image and the name.
 */
export const EsignSignatureInput = z.union([
  SignatureCaptureInput,
  z.strictObject({
    printedName: SignatureText,
    method: z.enum(['DRAWN', 'UPLOADED']),
    imagePng: PngBase64,
  }),
]);
export type EsignSignatureInput = z.input<typeof EsignSignatureInput>;

/** Initials: typed (1 to 10 characters) or an image like the signature. */
export const EsignInitialsInput = z.union([
  z.strictObject({
    method: z.literal('TYPED'),
    text: z
      .string()
      .min(1, 'Enter your initials')
      .max(10)
      .regex(/^[^\p{Cc}\p{Cf}\s]+$/u, 'Use letters only'),
  }),
  z.strictObject({ method: z.enum(['DRAWN', 'UPLOADED']), imagePng: PngBase64 }),
]);
export type EsignInitialsInput = z.input<typeof EsignInitialsInput>;

/**
 * POST adopt: the signature (and initials, needed when they have an INITIALS field) they sign
 * with. Adopting again replaces it until they finish. 400 IMAGE_INVALID for a bad PNG.
 */
export const SignerAdoptBody = z.strictObject({
  signature: EsignSignatureInput,
  initials: EsignInitialsInput.optional(),
});
export type SignerAdoptBody = z.input<typeof SignerAdoptBody>;

/** One field value in `finish`: text, 'true'/'false' for a CHECKBOX, 'true' on the chosen RADIO. */
export const SignerFieldValue = z.strictObject({
  fieldId: EsignFieldId,
  value: z.string().max(1000),
});

/**
 * POST finish: their values for every field but SIGNATURE, INITIALS, DATE_SIGNED and ATTACHMENT
 * (stamped or uploaded by the server). Checks every required field: 409 REQUIRED_FIELDS_MISSING,
 * 409 SIGNATURE_REQUIRED before `adopt`. Answers DONE.
 */
export const SignerFinishBody = z
  .strictObject({ values: z.array(SignerFieldValue).max(500) })
  .refine(
    (b) => new Set(b.values.map((v) => v.fieldId)).size === b.values.length,
    'Each field at most once',
  );
export type SignerFinishBody = z.input<typeof SignerFinishBody>;

/** POST decline: the reason is shown to the sender. Answers DECLINED; the request is declined. */
export const SignerDeclineBody = z.strictObject({ reason: text(500).optional() });
export type SignerDeclineBody = z.input<typeof SignerDeclineBody>;

/**
 * POST attachments/uploads: an upload ticket for an ATTACHMENT field (PDF, JPG or PNG, at most
 * 10 MB). The file is checked for malware before the firm can open it.
 */
export const SignerAttachmentUploadBody = z
  .strictObject({
    fieldId: EsignFieldId,
    fileName: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}/\\]+$/u, 'This file name is not allowed'),
    contentType: EsignContentType,
    sizeBytes: z.number().int().min(1).max(UPLOAD_LIMITS.maxBytes, 'Files can be at most 10 MB'),
  })
  .refine((b) => fileNameFitsType(b.fileName, b.contentType), {
    path: ['fileName'],
    message: 'The file name does not match its type',
  });
export type SignerAttachmentUploadBody = z.input<typeof SignerAttachmentUploadBody>;

export const SignerAttachmentConfirmBody = z.strictObject({
  fieldId: EsignFieldId,
  uploadToken: z.string().min(1).max(4000),
});
export type SignerAttachmentConfirmBody = z.input<typeof SignerAttachmentConfirmBody>;

/** GET copy (step COPY): the completed request's files. Download each with `downloadCopy`. */
export const SignerCopy = z.object({
  title: z.string(),
  completedAt: DateTime,
  files: z.array(z.object({ file: z.enum(['final', 'certificate']), fileName: z.string() })),
});
export type SignerCopy = z.infer<typeof SignerCopy>;

export const SignerCopyFile = z.enum(['final', 'certificate']);
export type SignerCopyFile = z.infer<typeof SignerCopyFile>;

// ---------- The portal's Signature center (a signed-in client) ----------
/**
 * Where a client's request stands for them. ACTION_NEEDED: theirs to sign now. WAITING: someone
 * signs before them, or they signed and others have not yet. The rest are final.
 */
export const MySignatureState = z.enum([
  'ACTION_NEEDED',
  'WAITING',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'VOIDED',
]);
export type MySignatureState = z.infer<typeof MySignatureState>;

/** One row of the Signature center: a request where one of the client's logins is a recipient. */
export const MySignatureRow = z.object({
  /** The recipient (this login on that request): pass it to `startSigning` and `download`. */
  recipientId: z.uuid(),
  title: z.string(),
  senderName: z.string(),
  state: MySignatureState,
  sentAt: DateTime,
  expiresAt: DateTime.nullable(),
  signedAt: DateTime.nullable(),
  completedAt: DateTime.nullable(),
});
export type MySignatureRow = z.infer<typeof MySignatureRow>;

/** GET /portal/{slug}/me/signatures?tab=: PENDING (action needed and waiting) or SIGNED (the rest). */
export const ListMySignaturesQuery = z.strictObject({
  tab: z.enum(['PENDING', 'SIGNED']).default('PENDING'),
});
export type ListMySignaturesQuery = z.input<typeof ListMySignaturesQuery>;

export const MySignatureList = z.object({ items: z.array(MySignatureRow) });
export type MySignatureList = z.infer<typeof MySignatureList>;
