import type { EsignEventRecord } from '../requests/esign.repository.js';
import type { SignerAdoption } from '../signer/signer.repository.js';

// Firm Sign's completion storage (R13). Like the other esign ports, every method takes the firm
// first and the Prisma implementation (with r0_esign) uses only forBusiness(businessId), never the
// owner client. Until then the API has notMigrated() and tests use InMemoryCompletionRepository.

/** What the signers left for the final PDF: never logged, audited or put in an email. */
export interface CompletionInputs {
  /** esign_fields.value written by each signer's finish, by field id. */
  values: { fieldId: string; value: string }[];
  /** Each signer's adopted signature and initials. */
  adoptions: { recipientId: string; adoption: SignerAdoption }[];
  /** The consent version number each signer pinned. */
  consentVersions: { recipientId: string; version: number }[];
}

/** A file for the vault, already stored under the request's final/ or certificate/ folder. */
export type CompletedFile = { key: string; fileName: string; sizeBytes: number; sha256: string };

/** What completing writes, in one transaction under the request's FOR UPDATE lock. */
export interface CompletionWrite {
  completedAt: Date;
  /**
   * Filed as `documents` rows: FIRM_TO_CLIENT, CLEAN (the scan exception), content type
   * application/pdf, on the request's client and engagement, in the firm's 'Signed Documents'
   * category (created on first use, no retention: kept forever), legal hold on.
   */
  final: CompletedFile;
  certificate: CompletedFile;
  /** The copy links (esign_recipients copy hash and expiry); never the token. */
  copyLinks: { recipientId: string; tokenHash: string; expiresAt: Date }[];
  /** The esign.completed emails to queue (esign_emails, QUEUED). */
  emails: { recipientId: string; template: 'esign.completed' }[];
  /** The COMPLETED event. */
  event: EsignEventRecord;
}

/** The filed documents' ids and the queued emails' ids (in `emails` order). */
export type CompletionResult = {
  finalDocumentId: string;
  certificateDocumentId: string;
  emailIds: string[];
};

export interface EsignCompletionRepository {
  /** The work under the job's advisory lock; null, running nothing, if another task holds it. */
  withJobLock<T>(work: () => Promise<T>): Promise<T | null>;
  /** The ACTIVE firms with Firm Sign on (the job's firms). */
  firms(): Promise<string[]>;
  /** PARTIALLY_SIGNED requests whose completion_due_at is at or before `now`, oldest first. */
  due(businessId: string, now: Date, limit: number): Promise<string[]>;
  inputs(businessId: string, requestId: string): Promise<CompletionInputs>;
  /**
   * Files both documents, sets COMPLETED, completedAt, final_sha256, certificate_sha256,
   * final_document_id and certificate_document_id, clears completion_due_at, writes the event,
   * the copy links and the queued emails. Null (nothing written) unless the request is still
   * PARTIALLY_SIGNED with completion due and every signer SIGNED: a second run completes nothing.
   */
  complete(
    businessId: string,
    id: string,
    write: CompletionWrite,
  ): Promise<CompletionResult | null>;
  /** A COMPLETED request's stored final PDF and certificate (the copy link's files); else null. */
  files(
    businessId: string,
    requestId: string,
  ): Promise<{ final: CompletedFile; certificate: CompletedFile } | null>;
  /** A failed run: completion_due_at moves to `retryAt` (only while still due). */
  retryLater(businessId: string, requestId: string, retryAt: Date): Promise<void>;
}

export const COMPLETION_REPOSITORY = Symbol('ESIGN_COMPLETION_REPOSITORY');
