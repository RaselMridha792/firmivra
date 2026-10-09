import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { Phone } from '../client-auth/schemas.js';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { ScanStatus } from '../db-enums.js';
import {
  DownloadLink,
  fileNameFitsType,
  UPLOAD_LIMITS,
  UploadTicket,
} from '../documents/schemas.js';
import {
  EsignAccessRole,
  EsignActorKind,
  EsignAuthMethod,
  EsignChosenAuthMethod,
  EsignDelivery,
  EsignEventType,
  EsignFieldType,
  EsignMergeKey,
  EsignQuickFilter,
  EsignRecipientKind,
  EsignRecipientRole,
  EsignRecipientStatus,
  EsignRequestStatus,
  EsignRouting,
  EsignSource,
  ESIGN_SIGNER_ONLY_FIELDS,
} from './enums.js';

// Firm Sign (R13), firm side: signature requests at /api/v1/esign/... (app host).
// The signer pages, the portal's Signature center, templates and settings come in contract 2.
//
// Every firm route needs the firm's 'esign' module (403 MODULE_OFF when it is off; read
// `status()` first, which never fails for that). Access, on every route:
// - Owner and Admin (and a Firm Sign MANAGER): every request of the firm.
// - Staff: requests they send, and requests for clients assigned to them. Any other request
//   answers 404, as if it did not exist. A VIEWER reads the same and changes nothing (403).
// A request is prepared as a DRAFT (documents, page plan, recipients, fields, settings), checked
// with `readiness()`, then sent; from then on only the lifecycle actions apply (remind, void,
// correct a recipient, replace, resend the completed copy). Completed, declined, expired and
// voided requests never change.
// The signed PDF and its completion certificate are filed in the client's documents ('Signed
// Documents', kept forever) under the request's service, so a request needs a client and one of
// the client's PENDING or ACTIVE services (`engagementId`) before it can be sent.
// Screens show errors with `errorMessage(error, ESIGN_ERRORS)`.
// Responses are plain objects (a field the API adds later is dropped); requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const EsignRequestId = z.uuid();
export const EsignDocumentId = z.uuid();
export const EsignRecipientId = z.uuid();
export const EsignFieldId = z.uuid();

const ClientRef = z.object({ id: z.uuid(), displayName: z.string() });
const ServiceRef = z.object({ id: z.uuid(), title: z.string() });

/** The most pages a request (all its files together) may have. */
export const ESIGN_MAX_PAGES = 100;
/** The most recipients and fields a request may have. */
export const ESIGN_MAX_RECIPIENTS = 20;
export const ESIGN_MAX_FIELDS = 500;

/**
 * Files Firm Sign takes, at most 10 MB each: PDF, JPG and PNG. An image becomes one page. Word
 * and Excel files are saved as PDF first.
 */
export const ESIGN_UPLOAD_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
} as const;
export const EsignContentType = z.enum(
  Object.keys(ESIGN_UPLOAD_TYPES) as [keyof typeof ESIGN_UPLOAD_TYPES],
  'Upload a PDF, JPG or PNG file',
);
export type EsignContentType = z.infer<typeof EsignContentType>;

// ---------- Status ----------
/**
 * GET /esign/status (Owner, Admin, Staff): whether Firm Sign is on for the firm, and the caller's
 * access in it (null when off). Off is 200 `{ enabled: false, myEsignRole: null }`, never 403. The firm menu shows 'Firm Sign' and the client record its Send for
 * Signature button only when `enabled`.
 */
export const EsignStatus = z.object({
  enabled: z.boolean(),
  myEsignRole: EsignAccessRole.nullable(),
});
export type EsignStatus = z.infer<typeof EsignStatus>;

/**
 * GET /portal/{slug}/me/signatures/status (a signed-in client): whether to show 'Signatures'.
 * Firm Sign off is 200 `{ enabled: false }`; 404 means only an unknown or inactive firm.
 */
export const MySignaturesStatus = z.object({ enabled: z.boolean() });
export type MySignaturesStatus = z.infer<typeof MySignaturesStatus>;

// ---------- List and counters ----------
/**
 * What a request waits on. FINISH_DRAFT: the sender. AWAIT_APPROVAL: its approvers.
 * AWAIT_SIGNATURE: `waitingOn` (the signers whose turn it is). NONE: it is closed.
 */
export const EsignNextAction = z.object({
  kind: z.enum(['FINISH_DRAFT', 'AWAIT_APPROVAL', 'AWAIT_SIGNATURE', 'NONE']),
  /** Names of the recipients it waits on; empty unless AWAIT_APPROVAL or AWAIT_SIGNATURE. */
  waitingOn: z.array(z.string()),
});
export type EsignNextAction = z.infer<typeof EsignNextAction>;

/** What the caller may do with the request now (their access and its status). */
export const EsignAction = z.enum([
  'EDIT',
  'DISCARD',
  'SEND',
  'REMIND',
  'VOID',
  'CORRECT',
  'REPLACE',
  'RESEND_COPY',
  'DOWNLOAD',
  // Contract 3.
  'SUBMIT_FOR_APPROVAL',
  'APPROVE',
  'START_IN_PERSON',
]);
export type EsignAction = z.infer<typeof EsignAction>;

/** One row of the dashboard's Recent Documents and of All requests. */
export const EsignRequestRow = z.object({
  id: z.uuid(),
  /** The document name. */
  title: z.string(),
  status: EsignRequestStatus,
  source: EsignSource,
  /** Null only for a draft that has no client yet. */
  client: ClientRef.nullable(),
  sender: MemberRef,
  /** The signers' names in signing order, for the Client/Recipient column. */
  signerNames: z.array(z.string()),
  signedCount: z.number().int().min(0),
  signerCount: z.number().int().min(0),
  nextAction: EsignNextAction,
  createdAt: DateTime,
  sentAt: DateTime.nullable(),
  lastActivityAt: DateTime,
  /** Set once sent. */
  expiresAt: DateTime.nullable(),
  completedAt: DateTime.nullable(),
  /** For the row's Actions menu, without a `get()` per row. */
  allowedActions: z.array(EsignAction),
});
export type EsignRequestRow = z.infer<typeof EsignRequestRow>;

/**
 * GET /esign/requests: newest activity first. `status: 'SENT'` includes DELIVERED. `from` and `to`
 * (calendar days, inclusive, UTC) apply to the last activity, for "Last 30 Days". `q` matches the
 * document name, the client, a signer or the sender. Filters combine with AND.
 */
export const ListEsignRequestsQuery = z
  .strictObject({
    status: EsignRequestStatus.optional(),
    quickFilter: EsignQuickFilter.optional(),
    clientId: z.uuid().optional(),
    senderId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    q: SearchText.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'The end date is before the start date',
  });
export type ListEsignRequestsQuery = z.input<typeof ListEsignRequestsQuery>;

export const EsignRequestList = z.object({
  items: z.array(EsignRequestRow),
  nextCursor: z.string().nullable(),
});
export type EsignRequestList = z.infer<typeof EsignRequestList>;

/**
 * GET /esign/requests/summary: the dashboard's 9 counters (ESIGN_COUNTERS; SENT includes
 * DELIVERED) and the quick filters' counts, over the requests the caller may see.
 */
export const EsignSummary = z.object({
  counts: z.object({
    DRAFT: z.number().int(),
    NEEDS_APPROVAL: z.number().int(),
    SENT: z.number().int(),
    VIEWED: z.number().int(),
    PARTIALLY_SIGNED: z.number().int(),
    COMPLETED: z.number().int(),
    DECLINED: z.number().int(),
    EXPIRED: z.number().int(),
    VOIDED: z.number().int(),
  }),
  quickFilters: z.object({
    AWAITING_SIGNATURE: z.number().int(),
    EXPIRING_SOON: z.number().int(),
    RECENTLY_COMPLETED: z.number().int(),
    MY_REQUESTS: z.number().int(),
    NEEDS_MY_APPROVAL: z.number().int(),
  }),
});
export type EsignSummary = z.infer<typeof EsignSummary>;

// ---------- Detail ----------
/** One uploaded or vault file of a request. */
export const EsignDocument = z.object({
  id: z.uuid(),
  /** Upload order, from 0. */
  position: z.number().int().min(0),
  fileName: z.string(),
  contentType: EsignContentType,
  sizeBytes: z.number().int(),
  pageCount: z.number().int().min(1),
  /**
   * Each page's size in PDF points as the page shows, after its own /Rotate and before the page
   * plan's rotation. An image is one page.
   */
  pageSizes: z.array(z.object({ width: z.number(), height: z.number() })),
  /** The client's document it was copied from, when picked from the vault. */
  sourceDocumentId: z.uuid().nullable(),
  /** Uploads start PENDING; a vault file is CLEAN. A request sends only when all are CLEAN. */
  scanStatus: ScanStatus,
  createdAt: DateTime,
});
export type EsignDocument = z.infer<typeof EsignDocument>;

/** One page of the packet: which file and page it shows, turned clockwise by `rotation`. */
export const EsignPage = z.strictObject({
  documentId: z.uuid(),
  /** The page in that file, from 0. */
  page: z
    .number()
    .int()
    .min(0)
    .max(ESIGN_MAX_PAGES - 1),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export type EsignPage = z.infer<typeof EsignPage>;

/** A recipient as the firm sees it. */
export const EsignRecipient = z.object({
  id: z.uuid(),
  kind: EsignRecipientKind,
  role: EsignRecipientRole,
  /** CUSTOM's name for the role; null otherwise. */
  roleLabel: z.string().nullable(),
  /** 1 signs first. Equal numbers sign at the same time. PARALLEL requests use 1 for all. */
  routingOrder: z.number().int().min(1),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Who this is: one of the client's portal logins, a staff member, or someone else. */
  link: z.discriminatedUnion('type', [
    z.object({ type: z.literal('CLIENT_LOGIN'), clientAccountId: z.uuid() }),
    z.object({ type: z.literal('STAFF'), userId: z.uuid() }),
    z.object({ type: z.literal('EXTERNAL') }),
  ]),
  delivery: EsignDelivery,
  authMethod: EsignChosenAuthMethod,
  /** True when an ACCESS_CODE is set. The code itself is never returned. */
  hasAccessCode: z.boolean(),
  /** 0 to 7: the recipient's colour in the field editor, kept while they stay on the request. */
  colorIndex: z.number().int().min(0).max(7),
  status: EsignRecipientStatus,
  sentAt: DateTime.nullable(),
  viewedAt: DateTime.nullable(),
  signedAt: DateTime.nullable(),
  declinedAt: DateTime.nullable(),
  /** The signer's reason, when they gave one. */
  declineReason: z.string().nullable(),
  lastRemindedAt: DateTime.nullable(),
  reminderCount: z.number().int().min(0),
});
export type EsignRecipient = z.infer<typeof EsignRecipient>;

/**
 * A field on a packet page. Position and size are fractions (0 to 1) of the page as shown, after
 * its rotation, from the top-left corner.
 */
export const EsignField = z.object({
  id: z.uuid(),
  /** The signer who fills it; null when the sender fills it (a prefilled or merge value). */
  recipientId: z.uuid().nullable(),
  type: EsignFieldType,
  /** The packet page, from 0 (the position in `pagePlan`). */
  pageIndex: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  required: z.boolean(),
  label: z.string().nullable(),
  /** The value comes from this merge field when the request is sent. */
  mergeKey: EsignMergeKey.nullable(),
  /** DROPDOWN's choices; RADIO's own value (one choice per radio field). Empty otherwise. */
  options: z.array(z.string()),
  /** The radio fields that form one group share this key. */
  groupKey: z.string().nullable(),
  /** A sender-filled field's typed value; null for signer fields and merge fields. */
  value: z.string().nullable(),
  /** True once the signer filled it in. */
  filled: z.boolean(),
});
export type EsignField = z.infer<typeof EsignField>;

/** The default reminders: the first after `firstAfterDays`, then every `everyDays`, at most `max`. */
export const EsignReminders = z.strictObject({
  firstAfterDays: z.number().int().min(1).max(60),
  everyDays: z.number().int().min(1).max(60),
  /** 0 turns automatic reminders off. */
  max: z.number().int().min(0).max(10),
});
export type EsignReminders = z.infer<typeof EsignReminders>;

/** GET /esign/requests/{id}: everything about a request, for the wizard and the detail page. */
export const EsignRequestDetail = EsignRequestRow.extend({
  /** For staff only: never shown to a signer or in an email. */
  internalNote: z.string().nullable(),
  /** The email's subject and message; null uses the firm's defaults. */
  emailSubject: z.string().nullable(),
  emailMessage: z.string().nullable(),
  routing: EsignRouting,
  engagement: ServiceRef.nullable(),
  /** Days from sending until it expires (the expiry date is set when it is sent). */
  expiryDays: z.number().int().min(1).max(365),
  reminders: z.object(EsignReminders.shape),
  /** Days before expiry that open signers get a warning; 0 for none. */
  expiryWarningDays: z.number().int().min(0).max(30),
  documents: z.array(EsignDocument),
  /** The packet's pages in order. Pages left out of it are not sent. */
  pagePlan: z.array(z.object(EsignPage.shape)),
  recipients: z.array(EsignRecipient),
  fields: z.array(EsignField),
  /** The request this one replaces, and the one that replaced it. */
  replacesRequestId: z.uuid().nullable(),
  replacedByRequestId: z.uuid().nullable(),
  /** The template and version it was made from (source TEMPLATE or BULK); null otherwise. */
  template: z.object({ id: z.uuid(), version: z.number().int().min(1) }).nullable(),
  /** Each approver's decision note, for staff (contract 3). Never shown to a signer. */
  approvalNotes: z.array(
    z.object({ recipientId: z.uuid(), decision: z.enum(['APPROVE', 'REJECT']), note: z.string() }),
  ),
  declinedAt: DateTime.nullable(),
  expiredAt: DateTime.nullable(),
  voidedAt: DateTime.nullable(),
  voidReason: z.string().nullable(),
  voidedBy: MemberRef.nullable(),
  /** SHA-256 of the packet as sent, of the signed PDF and of the certificate. */
  originalSha256: Sha256.nullable(),
  finalSha256: Sha256.nullable(),
  certificateSha256: Sha256.nullable(),
  /** The filed documents (client record > Documents) once completed. */
  finalDocumentId: z.uuid().nullable(),
  certificateDocumentId: z.uuid().nullable(),
});
export type EsignRequestDetail = z.infer<typeof EsignRequestDetail>;

// ---------- Create and update a draft ----------
/**
 * POST /esign/requests: a new DRAFT sent by the caller, with the firm's default expiry and
 * reminders. From a client record pass `source: 'CLIENT_RECORD'` and the client. The client must
 * be one the caller may see (404 otherwise) and not archived; the service must be one of its
 * PENDING or ACTIVE ones (409 ENGAGEMENT_MISMATCH).
 */
export const CreateEsignRequestBody = z
  .strictObject({
    title: text(200, 'one', 'Name the document'),
    source: z.enum(['TAB', 'CLIENT_RECORD']).default('TAB'),
    clientId: z.uuid().optional(),
    engagementId: z.uuid().optional(),
  })
  .refine((b) => b.source !== 'CLIENT_RECORD' || b.clientId !== undefined, {
    path: ['clientId'],
    message: 'Choose the client',
  });
export type CreateEsignRequestBody = z.input<typeof CreateEsignRequestBody>;

/**
 * PATCH /esign/requests/{id} (DRAFT only, else 409 INVALID_STATE): any of these; `null` or `''`
 * clears a text. Changing the client clears the service; it answers 409 RECIPIENTS_LINKED while a
 * recipient is one of the old client's logins.
 */
export const UpdateEsignRequestBody = z
  .strictObject({
    title: text(200, 'one', 'Name the document').optional(),
    internalNote: clearable(text(2000, 'many')),
    emailSubject: clearable(text(200)),
    emailMessage: clearable(text(1000, 'many')),
    clientId: z.uuid().nullable().optional(),
    engagementId: z.uuid().nullable().optional(),
    routing: EsignRouting.optional(),
    expiryDays: z.number().int().min(1).max(365).optional(),
    reminders: EsignReminders.optional(),
    expiryWarningDays: z.number().int().min(0).max(30).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type UpdateEsignRequestBody = z.input<typeof UpdateEsignRequestBody>;

// ---------- Documents and pages ----------
/**
 * POST /esign/requests/{id}/documents/uploads (DRAFT only): step 1 of an upload, as in Documents
 * (`uploadFile()` runs all three steps). The answer is an UploadTicket.
 */
export const CreateEsignUploadBody = z
  .strictObject({
    fileName: z
      .string()
      .trim()
      .min(1, 'The file needs a name')
      .max(255, 'Use a file name of at most 255 characters')
      // The same rule as Documents' uploads (documents/schemas.ts): no lone surrogates either.
      .regex(
        /^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}/\\]+$/u,
        'Rename the file: its name has characters that are not allowed',
      ),
    contentType: EsignContentType,
    sizeBytes: z
      .number()
      .int()
      .min(1, 'The file is empty')
      .max(UPLOAD_LIMITS.maxBytes, 'The file is larger than 10 MB'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Not a SHA-256'),
  })
  .superRefine((b, ctx) => {
    if (!fileNameFitsType(b.fileName, b.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fileName'],
        message: `The file name must end in ${ESIGN_UPLOAD_TYPES[b.contentType].join(' or ')}`,
      });
    }
  });
export type CreateEsignUploadBody = z.input<typeof CreateEsignUploadBody>;
export { UploadTicket as EsignUploadTicket };

/**
 * POST /esign/requests/{id}/documents/uploads/confirm: the API reads the stored file (pages and
 * sizes; 409 PDF_ENCRYPTED, PDF_UNREADABLE or TOO_MANY_PAGES) and adds its pages to the end of
 * the page plan. 410 UPLOAD_EXPIRED, 409 UPLOAD_MISMATCH.
 */
export const ConfirmEsignUploadBody = z.strictObject({ uploadToken: z.string().min(1).max(4000) });
export type ConfirmEsignUploadBody = z.input<typeof ConfirmEsignUploadBody>;

/**
 * POST /esign/requests/{id}/documents/from-vault: copy one of the request's client's documents,
 * any direction the caller can see (INTERNAL ones too: the firm chose to send it)
 * (a PDF, JPG or PNG with a CLEAN scan; 409 SCAN_PENDING, FILE_BLOCKED or FILE_TYPE_NOT_ALLOWED).
 * Another client's document answers 404.
 */
export const EsignFromVaultBody = z.strictObject({ documentId: z.uuid() });
export type EsignFromVaultBody = z.input<typeof EsignFromVaultBody>;

/**
 * PUT /esign/requests/{id}/page-plan: the packet's pages in their new order; a page left out is
 * deleted from the packet. Each page at most once. Fields follow their page when it moves, and
 * are removed with it; rotating a page that has fields answers 409 PAGE_HAS_FIELDS.
 */
export const EsignPutPagePlanBody = z
  .strictObject({ pages: z.array(EsignPage).min(1, 'Keep at least one page').max(ESIGN_MAX_PAGES) })
  .refine(
    (b) => new Set(b.pages.map((p) => `${p.documentId}:${p.page}`)).size === b.pages.length,
    'A page can be in the packet only once',
  );
export type EsignPutPagePlanBody = z.input<typeof EsignPutPagePlanBody>;

// ---------- Recipients ----------
/** Each existing `id` at most once in a PUT list (new entries have none). */
const uniqueIds = (items: readonly { id?: string | undefined }[]) => {
  const ids = items.flatMap((x) => (x.id ? [x.id] : []));
  return new Set(ids).size === ids.length;
};

/**
 * One recipient in PUT /esign/requests/{id}/recipients. `id` keeps an existing recipient (and its
 * fields and colour); leave it out for a new one. Who they are:
 * - CLIENT_LOGIN: one of the request's client's ACTIVE portal logins (PRIMARY or SPOUSE). The name
 *   and email come from the login (409 LOGIN_NOT_ACTIVE otherwise). Never matched by email.
 * - STAFF: an active member of the firm (an approver, or a preparer who signs); 409 NOT_A_MEMBER.
 * - EXTERNAL: anyone else, by name and email.
 */
export const EsignPutRecipient = z
  .strictObject({
    id: z.uuid().optional(),
    kind: EsignRecipientKind.default('SIGNER'),
    role: EsignRecipientRole,
    roleLabel: text(60).optional(),
    routingOrder: z.number().int().min(1).max(ESIGN_MAX_RECIPIENTS),
    who: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('CLIENT_LOGIN'), clientAccountId: z.uuid() }),
      z.strictObject({ type: z.literal('STAFF'), userId: z.uuid() }),
      z.strictObject({
        type: z.literal('EXTERNAL'),
        name: text(120, 'one', 'Enter the name'),
        email: Email,
        phone: Phone.optional(),
      }),
    ]),
    /**
     * PORTAL only for a CLIENT_LOGIN. IN_PERSON: a signer who signs on the firm's device
     * (`startInPerson`); their auth method is not asked (the staff member vouches).
     */
    delivery: EsignDelivery.default('EMAIL'),
    authMethod: EsignChosenAuthMethod.default('EMAIL_CODE'),
    /** Required for a new ACCESS_CODE; leave it out to keep the code already set. */
    accessCode: z
      .string()
      .regex(/^[A-Za-z0-9]{4,20}$/, 'Use 4 to 20 letters or digits')
      .optional(),
  })
  .superRefine((r, ctx) => {
    if (r.role === 'CUSTOM' && !r.roleLabel) {
      ctx.addIssue({ code: 'custom', path: ['roleLabel'], message: 'Name the role' });
    }
    if (r.delivery === 'PORTAL' && r.who.type !== 'CLIENT_LOGIN') {
      ctx.addIssue({
        code: 'custom',
        path: ['delivery'],
        message: 'Only the client’s own login can sign in the portal',
      });
    }
    if (r.delivery === 'IN_PERSON' && r.kind !== 'SIGNER') {
      ctx.addIssue({
        code: 'custom',
        path: ['delivery'],
        message: 'Only a signer signs in person',
      });
    }
    if (r.authMethod === 'ACCESS_CODE' && r.delivery !== 'IN_PERSON' && !r.id && !r.accessCode) {
      ctx.addIssue({ code: 'custom', path: ['accessCode'], message: 'Set an access code' });
    }
    if (r.kind === 'APPROVER' && r.who.type !== 'STAFF') {
      ctx.addIssue({
        code: 'custom',
        path: ['who'],
        message: 'An approver is a member of the firm',
      });
    }
  });
export type EsignPutRecipient = z.input<typeof EsignPutRecipient>;

/**
 * PUT /esign/requests/{id}/recipients (DRAFT only): the whole list, which replaces the old one. A
 * recipient left out, or no longer a SIGNER, loses their fields. PARALLEL requests ignore
 * `routingOrder`.
 */
export const EsignPutRecipientsBody = z.strictObject({
  recipients: z
    .array(EsignPutRecipient)
    .max(ESIGN_MAX_RECIPIENTS, 'At most 20 recipients')
    .refine(uniqueIds, 'A recipient can be in the list only once')
    .refine((list) => {
      const logins = list.flatMap((r) =>
        r.who.type === 'CLIENT_LOGIN' ? [r.who.clientAccountId] : [],
      );
      return new Set(logins).size === logins.length;
    }, 'A portal login can be a recipient only once'),
});
export type EsignPutRecipientsBody = z.input<typeof EsignPutRecipientsBody>;

// ---------- Fields ----------
const Fraction = z.number().min(0).max(1);

/** One field in PUT /esign/requests/{id}/fields. `id` keeps an existing field. */
export const EsignPutField = z
  .strictObject({
    id: z.uuid().optional(),
    recipientId: z.uuid().nullable(),
    type: EsignFieldType,
    pageIndex: z
      .number()
      .int()
      .min(0)
      .max(ESIGN_MAX_PAGES - 1),
    x: Fraction,
    y: Fraction,
    w: Fraction.refine((w) => w > 0, 'Too small'),
    h: Fraction.refine((h) => h > 0, 'Too small'),
    required: z.boolean().default(true),
    label: text(200).optional(),
    mergeKey: EsignMergeKey.optional(),
    options: z.array(text(100)).max(50).default([]),
    groupKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/)
      .optional(),
    /** A sender-filled field's value. */
    value: text(500).optional(),
  })
  .superRefine((f, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (f.x + f.w > 1 || f.y + f.h > 1) issue('w', 'The field must stay on the page');
    if (
      f.recipientId === null &&
      (ESIGN_SIGNER_ONLY_FIELDS as readonly string[]).includes(f.type)
    ) {
      issue('recipientId', 'Assign this field to a signer');
    }
    if (f.recipientId !== null && (f.mergeKey !== undefined || f.value !== undefined)) {
      issue('value', 'Only the sender’s fields take a value or a merge field');
    }
    if (f.recipientId === null && f.mergeKey === undefined && f.value === undefined) {
      issue('value', 'Give the field a value or a merge field');
    }
    if (f.mergeKey !== undefined && f.value !== undefined) {
      issue('value', 'Use a value or a merge field, not both');
    }
    if (f.value !== undefined && f.type === 'EMAIL' && !Email.safeParse(f.value).success) {
      issue('value', 'Enter a valid email');
    }
    if (f.value !== undefined && f.type === 'PHONE' && !Phone.safeParse(f.value).success) {
      issue('value', 'Enter the phone number with its country code');
    }
    if (f.type === 'DROPDOWN' && f.options.length === 0) issue('options', 'Add the choices');
    if (f.type === 'RADIO' && (f.options.length !== 1 || !f.groupKey)) {
      issue('options', 'A radio button needs its value and a group');
    }
  });
export type EsignPutField = z.input<typeof EsignPutField>;

/**
 * PUT /esign/requests/{id}/fields (DRAFT only): the whole list. Each `recipientId` must be one of
 * the request's SIGNER recipients and each `pageIndex` a page of the packet (400 otherwise).
 */
export const EsignPutFieldsBody = z.strictObject({
  fields: z
    .array(EsignPutField)
    .max(ESIGN_MAX_FIELDS, 'At most 500 fields')
    .refine(uniqueIds, 'A field can be in the list only once'),
});
export type EsignPutFieldsBody = z.input<typeof EsignPutFieldsBody>;

/**
 * GET /esign/requests/{id}/merge-values: each merge field's value from the request's client, its
 * sender and the firm; null when the record has none. `missing` lists the keys this request's
 * fields use whose value is null: flag them, and readiness fails on them (MERGE_MISSING). The
 * client's values come only while the caller may still see that client (a Staff member whose
 * client was reassigned gets them as null, so they show as missing).
 */
export const EsignMergeValues = z.object({
  values: z.record(EsignMergeKey, z.string().nullable()),
  missing: z.array(EsignMergeKey),
});
export type EsignMergeValues = z.infer<typeof EsignMergeValues>;

// ---------- Readiness and send ----------
/** What the readiness check finds (spec section 10, plus our own). */
export const EsignReadinessCode = z.enum([
  'NO_DOCUMENTS',
  'NO_CLIENT',
  /** No PENDING or ACTIVE service picked to file the signed document under. */
  'NO_ENGAGEMENT',
  'NO_SIGNERS',
  /** A file is still being checked (SCAN_PENDING) or failed the check (SCAN_BLOCKED). */
  'SCAN_PENDING',
  'SCAN_BLOCKED',
  /** A required signature field has no signer. */
  'SIGNATURE_UNASSIGNED',
  /** A recipient has no valid email for EMAIL delivery, or no access code for ACCESS_CODE. */
  'RECIPIENT_NO_CONTACT',
  'ACCESS_CODE_MISSING',
  /** Fields are placed, but this signer has none. */
  'SIGNER_NO_FIELDS',
  /** A merge field this request uses has no value. */
  'MERGE_MISSING',
  /** The reminders would run past the expiry date. */
  'REMINDER_AFTER_EXPIRY',
  /** An approver has not approved yet. */
  'APPROVAL_PENDING',
  /** Signing Settings ask for an approval, and the request has no approver. */
  'APPROVER_MISSING',
  /** The firm has not published its e-signature consent text (Signing Settings). */
  'NO_CONSENT',
]);
export type EsignReadinessCode = z.infer<typeof EsignReadinessCode>;

export const EsignReadiness = z.object({
  ready: z.boolean(),
  problems: z.array(
    z.object({
      code: EsignReadinessCode,
      recipientId: z.uuid().nullable(),
      fieldId: z.uuid().nullable(),
      documentId: z.uuid().nullable(),
      mergeKey: EsignMergeKey.nullable(),
    }),
  ),
  /**
   * True when no fields are placed: each signer then gets a signature page added at the end
   * (signature, printed name and date).
   */
  autoSignaturePage: z.boolean(),
});
export type EsignReadiness = z.infer<typeof EsignReadiness>;

/**
 * POST /esign/requests/{id}/send: `confirm: true` is the review screen's explicit confirmation.
 * 409 NOT_READY when the readiness check fails, INVALID_STATE unless DRAFT.
 */
export const SendEsignRequestBody = z.strictObject({ confirm: z.literal(true) });
export type SendEsignRequestBody = z.input<typeof SendEsignRequestBody>;

// ---------- Lifecycle ----------
/**
 * POST /esign/requests/{id}/remind: an email now to every signer whose turn it is, or to one.
 * 409 REMIND_TOO_SOON within an hour of the last reminder to them, REQUEST_CLOSED once closed.
 */
export const EsignRemindBody = z.strictObject({ recipientId: z.uuid().optional() });
export type EsignRemindBody = z.input<typeof EsignRemindBody>;

/** POST /esign/requests/{id}/void: an open or NEEDS_APPROVAL request; signers are told. */
export const EsignVoidBody = z.strictObject({ reason: text(500, 'many', 'Give a reason') });
export type EsignVoidBody = z.input<typeof EsignVoidBody>;

/**
 * POST /esign/requests/{id}/recipients/{recipientId}/correct: fix an EXTERNAL recipient who has not
 * finished (409 RECIPIENT_DONE). Their old link stops working and a new one goes out if it is
 * their turn. A client login's name and email are corrected on the client's record instead.
 */
export const EsignCorrectRecipientBody = z
  .strictObject({
    name: text(120, 'one', 'Enter the name').optional(),
    email: Email.optional(),
    phone: Phone.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type EsignCorrectRecipientBody = z.input<typeof EsignCorrectRecipientBody>;

/**
 * POST /esign/requests/{id}/replace: voids an open request with the reason and answers a new DRAFT
 * copied from it (files, pages, recipients, fields and settings), with `replacesRequestId` set.
 */
export const EsignReplaceBody = z.strictObject({ reason: text(500, 'many', 'Give a reason') });
export type EsignReplaceBody = z.input<typeof EsignReplaceBody>;

/**
 * POST /esign/requests/{id}/resend-copy: emails a fresh link to the completed copy (valid 30
 * days, behind an email code) to every external signer, or to one. COMPLETED only.
 */
export const EsignResendCopyBody = z.strictObject({ recipientId: z.uuid().optional() });
export type EsignResendCopyBody = z.input<typeof EsignResendCopyBody>;

/**
 * GET /esign/requests/{id}/download?file=: a 5-minute download link. `final` and `certificate`
 * once COMPLETED; `original` is the packet as sent. 409 INVALID_STATE before that.
 */
export const EsignDownloadFile = z.enum(['final', 'certificate', 'original']);
export type EsignDownloadFile = z.infer<typeof EsignDownloadFile>;
export { DownloadLink as EsignDownloadLink };

// ---------- Timeline ----------
/** One event of the request's timeline (oldest first). Never holds field values. */
export const EsignEvent = z.object({
  id: z.uuid(),
  type: EsignEventType,
  createdAt: DateTime,
  actorKind: EsignActorKind,
  /** The staff member's or signer's name; 'Firmivra' for SYSTEM. */
  actorName: z.string(),
  recipient: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** VOIDED, DECLINED and APPROVAL_REJECTED: the reason given. */
  reason: z.string().nullable(),
  /** AUTH_PASSED, AUTH_FAILED, CONSENTED and SIGNED: how the signer proved who they are. */
  authMethod: EsignAuthMethod.nullable(),
});
export type EsignEvent = z.infer<typeof EsignEvent>;

export const EsignEventList = z.object({ items: z.array(EsignEvent) });
export type EsignEventList = z.infer<typeof EsignEventList>;
