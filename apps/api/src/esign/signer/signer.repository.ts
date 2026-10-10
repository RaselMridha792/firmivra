import type { EsignContentType, EsignRequestStatus, SignatureMethod } from '@firmivra/types';
import type { EsignCodeKind } from '../engine/engine.types.js';
import type {
  EsignEventRecord,
  EsignQueuedTemplate,
  EsignRecipientRecord,
  EsignRequestRecord,
} from '../requests/esign.repository.js';

// Firm Sign's signer storage (R13): the firm first (from the slug), the request and recipient
// only from the link's hash or the sealed cookie. Prisma lands with r0_esign; until then the API
// has notMigrated() and tests use InMemorySignerRepository (test/unit/esign-fakes.ts).

export interface SignerLink {
  requestId: string;
  recipientId: string;
  tokenVersion: number;
  /**
   * SIGN: the invitation's link. COPY: the completed-copy link (30 days, SIGNER or CC).
   * IN_PERSON: the kiosk's link (EsignInPersonService.start), until its expiry; the staff member
   * vouches for the signer, so it skips the email and access codes.
   */
  purpose: 'SIGN' | 'COPY' | 'IN_PERSON';
}

export interface SignerRecord {
  request: EsignRequestRecord;
  recipient: EsignRecipientRecord;
  /** esign_recipients.token_version: correcting the recipient raises it. */
  tokenVersion: number;
  consentVersionId: string | null;
  /** What the signer adopted (never the signature itself); null before `adopt`. */
  adopted: { method: SignatureMethod; hasInitials: boolean } | null;
  /** esign_recipients.copy_expires_at: when the completed-copy link stops; null if none. */
  copyExpiresAt: Date | null;
}

/**
 * A signer's file for one of their ATTACHMENT fields, stored at keyFor(firm, request,
 * `attachments/<id>`); never shown to the firm until the malware scan marks it CLEAN.
 */
export interface SignerAttachment {
  fieldId: string;
  key: string;
  fileName: string;
  contentType: EsignContentType;
  sizeBytes: number;
  sha256: string;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
  createdAt: Date;
}

/** An attachment upload started and not confirmed: the token's SHA-256, never the token. */
export type SignerPendingAttachment = Omit<SignerAttachment, 'scanStatus'> & {
  tokenHash: string;
  requestId: string;
  recipientId: string;
};

/** A typed mark's text, or a PNG that passed SIGNATURE_IMAGE_CHECK. */
export type AdoptedMark = { method: SignatureMethod; text: string | null; png: Uint8Array | null };
/** POST adopt's signature and initials; adopting again replaces them. */
export type SignerAdoption = {
  printedName: string;
  signature: AdoptedMark;
  initials: AdoptedMark | null;
};

/** What POST finish writes, in one transaction under the request's FOR UPDATE lock. */
export interface SignerFinishWrite {
  signedAt: Date;
  /** Their field values (esign_fields.value and filled). */
  values: { fieldId: string; value: string }[];
  status: EsignRequestStatus;
  /** All signed: sets completion_due_at; PARTIALLY_SIGNED until EsignCompletionService files it. */
  allSigned: boolean;
  /** The next signers: SENT, with their link token's hash (as EsignSendWrite). */
  turn: { recipientId: string; tokenHash: string | null }[];
  emails: { recipientId: string; template: EsignQueuedTemplate }[];
  event: EsignEventRecord;
}

type Signer = [businessId: string, requestId: string, recipientId: string];

export interface EsignSignerRepository {
  /** The SIGNER recipient a link token's SHA-256 belongs to. */
  findLink(businessId: string, tokenHash: string): Promise<SignerLink | null>;
  signer(businessId: string, requestId: string, recipientId: string): Promise<SignerRecord | null>;
  /** Like `signer`, for a SIGNER or a CC: who may hold a completed-copy link. */
  copyHolder(...a: Signer): Promise<SignerRecord | null>;
  /** The recipient's attachments (one per field at most). */
  attachments(...a: Signer): Promise<SignerAttachment[]>;
  saveAttachmentUpload(businessId: string, upload: SignerPendingAttachment): Promise<void>;
  /** Deletes and returns the recipient's upload with this token hash: confirmed at most once. */
  takeAttachmentUpload(
    ...a: [...Signer, tokenHash: string]
  ): Promise<SignerPendingAttachment | null>;
  /** Replaces the email code and its tries; TOO_SOON within a minute or after 5 an hour. */
  issueCode(
    businessId: string,
    recipientId: string,
    code: { hash: string; sentAt: Date; expiresAt: Date },
  ): Promise<'OK' | 'TOO_SOON'>;
  /** Counts a try before the compare (atomic); null when no EMAIL code is open. */
  takeCodeTry(
    businessId: string,
    recipientId: string,
    kind: EsignCodeKind,
  ): Promise<{ hash: string | null; expiresAt: Date | null; triesBefore: number } | null>;
  /** The code passed: an EMAIL code is deleted, ACCESS tries go back to 0. */
  clearCode(businessId: string, recipientId: string, kind: EsignCodeKind): Promise<void>;
  addEvent(businessId: string, requestId: string, event: EsignEventRecord): Promise<void>;
  /**
   * In person: moves `active_at` of the kiosk lock that started this recipient's signing (the
   * newest one, of the member and firm that started it) to `at`; false when there is none or it
   * has been idle ESIGN_KIOSK_IDLE_MINUTES already (the kiosk is over, never revived).
   */
  touchKiosk(...a: [...Signer, at: Date]): Promise<boolean>;
  /** The firm's newest published consent version. */
  currentConsent(
    businessId: string,
  ): Promise<{ id: string; version: number; bodyMarkdown: string } | null>;
  /** Pins the version and records the event; false unless it is still the newest version. */
  acceptConsent(
    businessId: string,
    requestId: string,
    recipientId: string,
    versionId: string,
    event: EsignEventRecord,
  ): Promise<boolean>;
  // The writes below apply (and set lastActivityAt) only while the request is open and the
  // recipient has not signed or declined; else false (null), writing nothing.
  /** The first envelope read: the recipient VIEWED, the request `status`, the event. */
  markViewed(
    ...a: [...Signer, write: { at: Date; status: EsignRequestStatus; event: EsignEventRecord }]
  ): Promise<boolean>;
  adopt(...a: [...Signer, adoption: SignerAdoption]): Promise<boolean>;
  /** Sets the field's attachment, replacing any; null removes it. */
  setAttachment(
    ...a: [...Signer, fieldId: string, attachment: SignerAttachment | null]
  ): Promise<boolean>;
  /** SIGNED and the rest of `write` (email ids answered); null unless lastActivityAt = `readAt`. */
  finish(...a: [...Signer, write: SignerFinishWrite, readAt: Date]): Promise<string[] | null>;
  /** The recipient and the request DECLINED, with the reason (timeline only) and the event. */
  decline(
    ...a: [...Signer, write: { at: Date; reason: string | null; event: EsignEventRecord }]
  ): Promise<boolean>;
}

export const SIGNER_REPOSITORY = Symbol('ESIGN_SIGNER_REPOSITORY');
