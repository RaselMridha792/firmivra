import type { TxClient } from '@firmivra/db';
import type {
  EsignActorKind,
  EsignAuthMethod,
  EsignContentType,
  EsignDocument,
  EsignErrorCode,
  EsignEventType,
  EsignField,
  EsignPage,
  EsignReadiness,
  EsignRecipient,
  EsignReminders,
  EsignRequestStatus,
  EsignRouting,
} from '@firmivra/types';

// Firm Sign's signing engine (R18): the interfaces R13-api's requests, send, signer and
// completion code call. Library code only: no routes, no database access except the events
// recorder, which writes in the caller's transaction.

// ---------- PDF engine ----------

/** The refusals of inspect() and compose(): 409 with this code (ESIGN_ERRORS has the text). */
export type PdfRefusal = Extract<
  EsignErrorCode,
  'PDF_ENCRYPTED' | 'PDF_UNREADABLE' | 'TOO_MANY_PAGES'
>;

/** Thrown by the PDF engine; the caller maps `code` to its 409 answer. */
export class EsignEngineError extends Error {
  constructor(readonly code: PdfRefusal) {
    super(code);
    this.name = 'EsignEngineError';
  }
}

/**
 * A page size in PDF points as a viewer shows it: the visible box turned by the page's own
 * /Rotate, before any plan rotation (EsignDocument.pageSizes).
 */
export type PageSize = EsignDocument['pageSizes'][number];

/** One stored file of a request: a PDF, or a JPG or PNG that becomes one page. */
export interface SourceFile {
  documentId: string;
  contentType: EsignContentType;
  bytes: Uint8Array;
}

/** What inspect() reads from a file: what EsignDocument stores as pageCount and pageSizes. */
export interface InspectedFile {
  pageCount: number;
  pageSizes: PageSize[];
}

/**
 * Where a value goes: a packet page (from 0) and a box in fractions of that page as shown, after
 * its rotation, from the top-left corner (as EsignField).
 */
export type FieldBox = Pick<EsignField, 'pageIndex' | 'x' | 'y' | 'w' | 'h'>;

/** One value to print on the packet. */
export type Stamp = FieldBox &
  (
    | { kind: 'TEXT'; text: string }
    | { kind: 'CHECK'; checked: boolean }
    /** A signature or initials image, checked by SignatureImageCheck first. */
    | { kind: 'IMAGE'; png: Uint8Array }
  );

/** A signer on the automatic signature page (no fields placed: EsignReadiness.autoSignaturePage). */
export interface SignaturePageSigner {
  name: string;
  /** The drawn, uploaded or typed-and-rendered signature. */
  signaturePng: Uint8Array;
  signedAt: Date;
}

export interface FinalizeInput {
  stamps: Stamp[];
  /** One page per signer, added at the end. Empty when fields are placed. */
  signaturePages: SignaturePageSigner[];
  /** The firm's time zone: dates print in it. */
  timeZone: string;
}

/** The certificate's input. Ids, names, methods and hashes only: never field values or content. */
export interface CertificateInput {
  request: { id: string; title: string; firmName: string; sentAt: Date; completedAt: Date };
  signers: {
    name: string;
    email: string | null;
    role: string;
    authMethod: EsignAuthMethod;
    consentVersion: number | null;
    viewedAt: Date | null;
    signedAt: Date | null;
    ip: string | null;
    userAgent: string | null;
  }[];
  events: { at: Date; type: EsignEventType; actor: string; authMethod: EsignAuthMethod | null }[];
  /** Hex SHA-256 of the packet as sent, and of the signed PDF. */
  originalSha256: string;
  finalSha256: string;
  timeZone: string;
}

export interface PdfEngine {
  /** Pages and sizes. Refuses encrypted, unreadable, XFA and over-100-page files. */
  inspect(file: Pick<SourceFile, 'contentType' | 'bytes'>): Promise<InspectedFile>;
  /** The packet: the plan's pages in order, each turned by its rotation; images become pages. */
  compose(files: SourceFile[], plan: EsignPage[]): Promise<Uint8Array>;
  /** Stamps values and signatures, adds signature pages and flattens every form field. */
  finalize(packet: Uint8Array, input: FinalizeInput): Promise<Uint8Array>;
  /** Certificate and audit-trail pages. The same input gives the same bytes. */
  certificate(input: CertificateInput): Promise<Uint8Array>;
}

// ---------- Store ----------

/** Firm Sign's objects in the documents bucket, always under tenant/<businessId>/esign/. */
export interface EsignStore {
  /** tenant/<businessId>/esign/<requestId>/<name>. */
  keyFor(businessId: string, requestId: string, name: string): string;
  /** Every method refuses (throws) a key outside tenant/<businessId>/. */
  put(businessId: string, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(businessId: string, key: string): Promise<Uint8Array | null>;
  head(businessId: string, key: string): Promise<{ sizeBytes: number } | null>;
  /** Copies a vault document (tenant/<businessId>/documents/...) into the request's folder. */
  copyFromVault(businessId: string, sourceKey: string, key: string): Promise<void>;
  presignDownload(
    businessId: string,
    file: { key: string; fileName: string; contentType: string },
  ): Promise<string>;
  remove(businessId: string, key: string): Promise<void>;
}

// ---------- Signer security ----------

export type SignatureImageResult =
  | { ok: true; width: number; height: number }
  /** NOT_PNG: not a well-formed PNG. TOO_MANY_BYTES: over 200 KB. TOO_MANY_PIXELS: over 1600x600. */
  | { ok: false; reason: 'NOT_PNG' | 'TOO_MANY_BYTES' | 'TOO_MANY_PIXELS' };

/** A signature or initials PNG: a real PNG, at most 200 KB and 1600x600 pixels. */
export interface SignatureImageCheck {
  check(png: Uint8Array): SignatureImageResult;
}

/** A link token (base64url of 32 random bytes) and the hex SHA-256 that is stored. */
export interface IssuedToken {
  token: string;
  hash: string;
}

/** Signer links and the 30-day copy link: only the hash is ever stored. */
export interface LinkTokens {
  issue(): IssuedToken;
  /** The hash to look up; never compare tokens themselves. */
  hash(token: string): string;
}

export type EsignCodeKind = 'EMAIL' | 'ACCESS';

/** Email and access codes: an HMAC (HKDF label fv-esign-code-v1), bound to the recipient. */
export interface CodeHasher {
  /** A random 6-digit code. */
  generate(): string;
  /** The kind is in the HMAC input, so an email code never passes as the access code. */
  hash(recipientId: string, kind: EsignCodeKind, code: string): string;
  /** Constant-time comparison. */
  verify(recipientId: string, kind: EsignCodeKind, code: string, storedHash: string): boolean;
}

/** What the sealed fv_sign_{slug} cookie holds once a signer opened their link. */
export interface SignerSession {
  slug: string;
  businessId: string;
  requestId: string;
  recipientId: string;
  /** esign_recipients.token_version: a corrected recipient's old cookie stops working. */
  tokenVersion: number;
  /**
   * SIGN: a signing session. COPY: the completed-copy link's read-only session, which may only
   * download the final PDF and the certificate; every signing step refuses it.
   */
  purpose: 'SIGN' | 'COPY';
  /** The email code passed (true from the start for a portal session or a LINK recipient). */
  emailCodePassed: boolean;
  /** The access code passed, after the email code (true when the recipient has none). */
  accessCodePassed: boolean;
  /** The consent version the signer accepted (pinned on the recipient); null until then. */
  consentVersionId: string | null;
}

export interface SignerCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
}

/** The sealed signer cookie, bound to its slug: it never opens under another firm's slug. */
export interface SignerCookie {
  /** fv_sign_{slug}. */
  name(slug: string): string;
  /** HttpOnly, SameSite=Strict, path /api/v1/portal/{slug}/sign; maxAge in ms (Express). */
  options(slug: string, ttlSeconds: number): SignerCookieOptions;
  seal(session: SignerSession, ttlSeconds: number): Promise<string>;
  /** The session, or undefined when expired, tampered with or sealed for another slug. */
  open(slug: string, value: string): Promise<SignerSession | undefined>;
}

// ---------- Events ----------

/** One esign_events row. Metadata holds ids, hashes and methods only, never field values. */
export interface EsignEventInput {
  businessId: string;
  /** Exactly one of requestId and intakeSubmissionId. */
  requestId?: string;
  intakeSubmissionId?: string;
  recipientId?: string | null;
  type: EsignEventType;
  actorKind: EsignActorKind;
  actorUserId?: string | null;
  actorLabel?: string | null;
  authMethod?: EsignAuthMethod | null;
  metadata?: Record<string, string | number | boolean | null>;
}

/** Appends an event and its audit row in the caller's transaction (IP and agent from context). */
export interface EsignEventsRecorder {
  record(tx: TxClient, event: EsignEventInput): Promise<void>;
}

// ---------- Rules (pure; `now` is passed in) ----------

export type RuleRecipient = Pick<
  EsignRecipient,
  'id' | 'kind' | 'routingOrder' | 'status' | 'delivery' | 'authMethod' | 'email' | 'hasAccessCode'
>;

export interface ReadinessInput {
  documents: Pick<EsignDocument, 'id' | 'scanStatus'>[];
  clientId: string | null;
  engagementId: string | null;
  recipients: RuleRecipient[];
  fields: Pick<EsignField, 'id' | 'recipientId' | 'type' | 'required' | 'mergeKey'>[];
  /** EsignMergeValues.missing for this request's fields. */
  missingMergeKeys: EsignField['mergeKey'][];
  expiryDays: number;
  reminders: EsignReminders;
  consentPublished: boolean;
}

export interface EsignRules {
  readiness(input: ReadinessInput): EsignReadiness;
  /** The recipients whose turn it is now (SIGNER and APPROVER not yet done). */
  currentTurn(routing: EsignRouting, recipients: RuleRecipient[]): string[];
  /** The request's status after a recipient's status changed (open requests only). */
  statusAfter(recipients: RuleRecipient[], current: EsignRequestStatus): EsignRequestStatus;
  /** When the next automatic reminder is due; null when none is left before expiry. */
  nextReminderAt(input: {
    sentAt: Date;
    reminders: EsignReminders;
    sentCount: number;
    expiresAt: Date;
  }): Date | null;
  /** When the expiry warning is due; null for none (0 days, or already past sending). */
  expiryWarningAt(input: { sentAt: Date; expiresAt: Date; warningDays: number }): Date | null;
  /** Remind Now: at most once an hour per recipient. */
  canRemindNow(lastRemindedAt: Date | null, now: Date): boolean;
}

// ---------- Nest injection tokens ----------

export const PDF_ENGINE = Symbol('ESIGN_PDF_ENGINE');
export const ESIGN_STORE = Symbol('ESIGN_STORE');
export const SIGNATURE_IMAGE_CHECK = Symbol('ESIGN_SIGNATURE_IMAGE_CHECK');
export const LINK_TOKENS = Symbol('ESIGN_LINK_TOKENS');
export const CODE_HASHER = Symbol('ESIGN_CODE_HASHER');
export const SIGNER_COOKIE = Symbol('ESIGN_SIGNER_COOKIE');
export const ESIGN_EVENTS = Symbol('ESIGN_EVENTS');
export const ESIGN_RULES = Symbol('ESIGN_RULES');
