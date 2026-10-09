import type { EsignRequestStatus, SignatureMethod } from '@firmivra/types';
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
  /** SIGN: the invitation's link. COPY: the completed-copy link (slice 3). */
  purpose: 'SIGN' | 'COPY';
}

export interface SignerRecord {
  request: EsignRequestRecord;
  recipient: EsignRecipientRecord;
  /** esign_recipients.token_version: correcting the recipient raises it. */
  tokenVersion: number;
  consentVersionId: string | null;
  /** What the signer adopted (never the signature itself); null before `adopt`. */
  adopted: { method: SignatureMethod; hasInitials: boolean } | null;
}

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
  /** Completion hook: all signed. PARTIALLY_SIGNED, marked due, until the PDF is filed. */
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
  /** SIGNED and the rest of `write` (email ids answered); null unless lastActivityAt = `readAt`. */
  finish(...a: [...Signer, write: SignerFinishWrite, readAt: Date]): Promise<string[] | null>;
  /** The recipient and the request DECLINED, with the reason (timeline only) and the event. */
  decline(
    ...a: [...Signer, write: { at: Date; reason: string | null; event: EsignEventRecord }]
  ): Promise<boolean>;
}

export const SIGNER_REPOSITORY = Symbol('ESIGN_SIGNER_REPOSITORY');
