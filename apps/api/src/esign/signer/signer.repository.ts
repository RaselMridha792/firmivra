import type { EsignCodeKind } from '../engine/engine.types.js';
import type {
  EsignEventRecord,
  EsignRecipientRecord,
  EsignRequestRecord,
} from '../requests/esign.repository.js';

// Firm Sign's signer storage (R13, signer routes). Like EsignRepository, every method takes the
// firm first (from the URL's slug), and the request and recipient only from the sealed cookie.
// The Prisma implementation lands with r0_esign; until then the API is wired to notMigrated()
// and tests use InMemorySignerRepository (test/unit/esign-fakes.ts).

/** What a link token's hash points to. */
export interface SignerLink {
  requestId: string;
  recipientId: string;
  tokenVersion: number;
  /** SIGN: the invitation's link. COPY: the completed-copy link (slice 2). */
  purpose: 'SIGN' | 'COPY';
  /** The copy link's own expiry (30 days); null for a signing link, which follows the request. */
  expiresAt: Date | null;
}

/** A recipient as their signing pages need it. */
export interface SignerRecord {
  request: EsignRequestRecord;
  recipient: EsignRecipientRecord;
  /** esign_recipients.token_version: correcting the recipient raises it. */
  tokenVersion: number;
  /** The consent version pinned on the recipient; null until they accepted one. */
  consentVersionId: string | null;
}

/** One try of an open code, taken before comparing so parallel guesses never pass the limit. */
export interface SignerCodeTry {
  /** The email code's HMAC; null for ACCESS (its hash is on the recipient). */
  hash: string | null;
  expiresAt: Date | null;
  /** Tries used before this one (this one is already counted). */
  triesBefore: number;
}

export interface EsignSignerRepository {
  /** The SIGNER recipient a link token's SHA-256 belongs to; null for any other hash. */
  findLink(businessId: string, tokenHash: string): Promise<SignerLink | null>;
  /** Null when the firm has no such recipient on that request. */
  signer(businessId: string, requestId: string, recipientId: string): Promise<SignerRecord | null>;
  /**
   * Stores a new email code (only its HMAC), replacing any older one and its tries. TOO_SOON
   * (nothing stored) within a minute of the last code or after 5 in the last hour, checked under
   * the recipient's row lock.
   */
  issueCode(
    businessId: string,
    recipientId: string,
    code: { hash: string; sentAt: Date; expiresAt: Date },
  ): Promise<'OK' | 'TOO_SOON'>;
  /**
   * Counts one try of the recipient's open code of that kind (atomically) and answers it as it
   * was; null when no EMAIL code is open. ACCESS always answers (its tries live per recipient).
   */
  takeCodeTry(
    businessId: string,
    recipientId: string,
    kind: EsignCodeKind,
  ): Promise<SignerCodeTry | null>;
  /** The code passed: an EMAIL code is deleted, ACCESS tries go back to 0. */
  clearCode(businessId: string, recipientId: string, kind: EsignCodeKind): Promise<void>;
  /** Appends a timeline row (AUTH_PASSED, AUTH_FAILED...). */
  addEvent(businessId: string, requestId: string, event: EsignEventRecord): Promise<void>;
  /** The firm's newest published consent version; null when none is published. */
  currentConsent(
    businessId: string,
  ): Promise<{ id: string; version: number; bodyMarkdown: string } | null>;
  /**
   * Pins the version on the recipient and records CONSENTED; false (nothing written) unless it is
   * still the firm's newest version.
   */
  acceptConsent(
    businessId: string,
    requestId: string,
    recipientId: string,
    versionId: string,
    event: EsignEventRecord,
  ): Promise<boolean>;
  /**
   * The recipient DECLINED with the reason, and the request DECLINED, with the event; false
   * (nothing written) unless the request is still open and the recipient neither signed nor
   * declined.
   */
  decline(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: { at: Date; reason: string | null; event: EsignEventRecord },
  ): Promise<boolean>;
}

export const SIGNER_REPOSITORY = Symbol('ESIGN_SIGNER_REPOSITORY');
