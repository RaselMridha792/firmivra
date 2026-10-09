import type {
  EsignAccessRole,
  EsignContentType,
  EsignDefaults,
  EsignDocument,
  EsignEvent,
  EsignField,
  EsignPage,
  EsignRecipient,
  EsignReminders,
  EsignRequestStatus,
  EsignRouting,
  EsignSource,
} from '@firmivra/types';

// Firm Sign's storage of requests (R13). Every read and write of the esign tables goes through
// this interface, and every method takes the firm (`businessId`, from the tenant context) first.
//
// The Prisma implementation lands once migration r0_esign (esign_requests, esign_documents,
// esign_recipients, esign_fields, esign_events) is on main. It uses only `forBusiness(businessId)`
// or TenantPrisma (row-level security), never the owner client, and runs each draft write in one
// transaction that locks the request row (FOR UPDATE) and checks it is still a DRAFT. Until then
// the API is wired to `notMigrated()` below and tests use InMemoryEsignRepository
// (test/unit/esign-fakes.ts).

/** An esign_requests row: what the request itself holds. */
export interface EsignRequestRecord {
  id: string;
  title: string;
  status: EsignRequestStatus;
  source: EsignSource;
  clientId: string | null;
  engagementId: string | null;
  /** The member who prepares and sends it. */
  senderUserId: string;
  internalNote: string | null;
  emailSubject: string | null;
  emailMessage: string | null;
  routing: EsignRouting;
  expiryDays: number;
  reminders: EsignReminders;
  expiryWarningDays: number;
  createdAt: Date;
  lastActivityAt: Date;
  sentAt: Date | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  /** Hex SHA-256 of the packet as sent; null until sent. */
  originalSha256: string | null;
}

export type NewEsignRequest = Omit<
  EsignRequestRecord,
  | 'id'
  | 'status'
  | 'createdAt'
  | 'lastActivityAt'
  | 'sentAt'
  | 'expiresAt'
  | 'completedAt'
  | 'originalSha256'
>;

/** What PATCH may change. */
export type EsignDraftPatch = Partial<
  Pick<
    EsignRequestRecord,
    | 'title'
    | 'internalNote'
    | 'emailSubject'
    | 'emailMessage'
    | 'clientId'
    | 'engagementId'
    | 'routing'
    | 'expiryDays'
    | 'reminders'
    | 'expiryWarningDays'
  >
>;

/** An esign_documents row: the contract's document plus where its bytes are. */
export type EsignDocumentRecord = Omit<EsignDocument, 'createdAt'> & {
  createdAt: Date;
  s3Key: string;
  sha256: string;
};

type RecipientDates = 'sentAt' | 'viewedAt' | 'signedAt' | 'declinedAt' | 'lastRemindedAt';
/** An esign_recipients row. Only the access code's hash is kept (CodeHasher). */
export type EsignRecipientRecord = Omit<EsignRecipient, RecipientDates | 'hasAccessCode'> & {
  [K in RecipientDates]: Date | null;
} & { accessCodeHash: string | null };

/** A file to add: the repository gives it the next position and appends its pages. */
export type NewEsignDocument = Omit<EsignDocumentRecord, 'position'>;

/**
 * An upload started by createUpload and not yet confirmed. Only the token's SHA-256 is kept; the
 * key, size, type and checksum are the API's, never the confirming request's.
 */
export interface EsignPendingUpload {
  tokenHash: string;
  requestId: string;
  /** Who started it: only they confirm it. */
  userId: string;
  /** The document's id once confirmed (the last part of `key`). */
  documentId: string;
  key: string;
  fileName: string;
  contentType: EsignContentType;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}

/** The request's documents (upload order), page plan (packet order), recipients and fields. */
export interface EsignRequestParts {
  documents: EsignDocumentRecord[];
  pagePlan: EsignPage[];
  recipients: EsignRecipientRecord[];
  fields: EsignField[];
}

/** What the list and counters ask for: every condition given holds (from inclusive, before not). */
export interface EsignRequestFilter {
  /**
   * Null: every request of the firm (Owner, Admin). A member's id: only the requests they send,
   * those whose client is assigned to them (clients.assigned_user_id) and those they are a STAFF
   * APPROVER recipient of.
   */
  visibleTo: string | null;
  statuses?: readonly EsignRequestStatus[];
  clientId?: string;
  senderUserId?: string;
  lastActivityFrom?: Date;
  lastActivityBefore?: Date;
  expiresFrom?: Date;
  expiresBefore?: Date;
  completedFrom?: Date;
  /** Has this member as a STAFF APPROVER recipient who has not APPROVED. */
  pendingApprover?: string;
  /**
   * Case-insensitive substring of the title, the client's display name, the sender's name or a
   * SIGNER recipient's name (Prisma: ILIKE with %, _ and \ escaped).
   */
  search?: string;
}

/** Where the next page starts: after this row, in (lastActivityAt, id) descending order. */
export interface EsignListAfter {
  lastActivityAt: Date;
  id: string;
}

/** A list row: the request and its recipients (for the signers, next action and actions). */
export interface EsignListedRequest {
  record: EsignRequestRecord;
  recipients: EsignRecipientRecord[];
}

/** An esign_events row, with the names as they were then; never a field value or content. */
export type EsignEventRecord = Omit<EsignEvent, 'createdAt'> & { createdAt: Date };

/** The Firm Sign emails the send route queues (the other templates come with their routes). */
export type EsignQueuedTemplate = 'esign.request';

/** What sending a DRAFT writes, in one transaction. */
export interface EsignSendWrite {
  sentAt: Date;
  expiresAt: Date;
  /** Hex SHA-256 of the packet, stored at keyFor(businessId, id, `packet-<sha256>.pdf`). */
  originalSha256: string;
  /**
   * The recipients whose turn it is: SENT with `sentAt`. `tokenHash` is the SHA-256 of their
   * one-time link token (esign_recipients.token_hash); null when no link goes out (PORTAL signs
   * from the Signature center, IN_PERSON on a staff device). Never the token itself.
   */
  turn: { recipientId: string; tokenHash: string | null }[];
  /**
   * The emails to queue (esign_emails, QUEUED): who and which template, never the address, the
   * link or the token. A queued email that never went out is sent again by the job runner with a
   * fresh token, since the first one is not stored.
   */
  emails: { recipientId: string; template: EsignQueuedTemplate }[];
  /** The SENT event. */
  event: EsignEventRecord;
}

export interface EsignRepository {
  /** Up to `limit` matching requests after `after`, by lastActivityAt then id, descending. */
  listRequests(
    businessId: string,
    filter: EsignRequestFilter,
    page: { after: EsignListAfter | null; limit: number },
  ): Promise<EsignListedRequest[]>;
  /** How many requests match the filter, by status (a status with none may be left out). */
  countRequests(
    businessId: string,
    filter: EsignRequestFilter,
  ): Promise<Partial<Record<EsignRequestStatus, number>>>;
  /** The request's timeline, oldest first; empty for another firm's request. */
  events(businessId: string, id: string): Promise<EsignEventRecord[]>;
  /** The firm's defaults for new requests (Signing Settings). */
  defaults(businessId: string): Promise<EsignDefaults>;
  createRequest(businessId: string, input: NewEsignRequest): Promise<EsignRequestRecord>;
  /** Null when the firm has no such request (another firm's id included). */
  findRequest(businessId: string, id: string): Promise<EsignRequestRecord | null>;
  parts(businessId: string, id: string): Promise<EsignRequestParts>;
  /** A member's Firm Sign access (OWNER and ADMIN follow the firm role); null if not a member. */
  esignRole(businessId: string, userId: string): Promise<EsignAccessRole | null>;
  /** True once the firm has published a consent version (Signing Settings). */
  consentPublished(businessId: string): Promise<boolean>;
  // Draft writes: each applies only while the request is still a DRAFT, sets lastActivityAt and
  // refuses (false, null or INVALID_STATE; changing nothing) when it is not, or no longer exists. The
  // lastActivityAt written is strictly later than the value it replaces (the Prisma
  // implementation writes GREATEST(now(), old + 1 ms), never now() alone): it is the version the
  // `readAt` checks below compare, so an equal value would hide a write in between, and a value
  // that only differs below the millisecond (Postgres keeps microseconds, a JS Date does not)
  // would refuse every later write.
  // TODO(r0_esign): every Prisma draft write also resets every APPROVER recipient to WAITING in
  // the same transaction (contract 3, extras.ts: any edit to a DRAFT clears its approvals).
  /**
   * Applies the patch and returns the request as written. With `clientChange`, it refuses
   * (RECIPIENTS_LINKED, changing nothing) while a recipient is linked to a client login: the
   * Prisma implementation checks esign_recipients after taking the FOR UPDATE lock, so a PUT
   * recipients cannot slip in between. INVALID_STATE: not a DRAFT, or gone.
   */
  updateDraft(
    businessId: string,
    id: string,
    patch: EsignDraftPatch,
    options?: { clientChange?: boolean },
  ): Promise<EsignRequestRecord | 'INVALID_STATE' | 'RECIPIENTS_LINKED'>;
  /**
   * Deletes the draft and its documents, pages, recipients and fields, and returns the deleted
   * documents (read in the same locked transaction) so their files can be removed; null when it
   * is not a DRAFT, or gone.
   */
  deleteDraft(
    businessId: string,
    id: string,
  ): Promise<Pick<EsignDocumentRecord, 'id' | 's3Key'>[] | null>;
  // The three below replace what the service computed from parts() read before the write, so each
  // also refuses (null or false) unless the request's lastActivityAt is still `readAt`: checked
  // under the FOR UPDATE lock, a write in between (from another tab, say) is never silently
  // reverted. The first two return the request as written, read in the same transaction.
  /** Replaces the page plan and the fields (moved with their pages) together. */
  savePagePlan(
    businessId: string,
    id: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
    readAt: Date,
  ): Promise<EsignRequestRecord | null>;
  /** Replaces the recipients and the fields (those of removed signers dropped) together. */
  saveRecipients(
    businessId: string,
    id: string,
    recipients: EsignRecipientRecord[],
    fields: EsignField[],
    readAt: Date,
  ): Promise<EsignRequestRecord | null>;
  /** Replaces the fields. */
  saveFields(businessId: string, id: string, fields: EsignField[], readAt: Date): Promise<boolean>;
  /**
   * Sends the DRAFT: status SENT, the dates, the hash, the turn's recipients, the events row and
   * the queued emails, under the request's FOR UPDATE lock. Approvals stand. Answers the queued
   * emails' ids in `emails` order; null (nothing written) unless it is still a DRAFT whose
   * lastActivityAt is `readAt`, so a double-click sends once.
   */
  sendDraft(
    businessId: string,
    id: string,
    write: EsignSendWrite,
    readAt: Date,
  ): Promise<string[] | null>;
  /** Records a queued email's attempt: SENT, or FAILED with the error's class name only. */
  emailOutcome(
    businessId: string,
    emailId: string,
    outcome: { sent: true } | { sent: false; error: string },
  ): Promise<void>;
  // Uploads between createUpload and confirmUpload (draft writes from addDocument on).
  saveUpload(businessId: string, upload: EsignPendingUpload): Promise<void>;
  /**
   * Deletes and returns this request's upload with the token hash, started by `userId`: each is
   * confirmed at most once. Null when there is none (another firm's, request's or person's).
   */
  takeUpload(
    businessId: string,
    requestId: string,
    userId: string,
    tokenHash: string,
  ): Promise<EsignPendingUpload | null>;
  /**
   * Adds the file at the next position and its pages, unturned, to the end of the page plan.
   * TOO_MANY_PAGES (nothing added) when the plan would pass ESIGN_MAX_PAGES.
   */
  addDocument(
    businessId: string,
    id: string,
    document: NewEsignDocument,
  ): Promise<EsignDocumentRecord | 'NOT_DRAFT' | 'TOO_MANY_PAGES'>;
  /**
   * Deletes the file and replaces the page plan and the fields (those pages' removed). Like the
   * saves above, false unless lastActivityAt is still `readAt`.
   */
  removeDocument(
    businessId: string,
    id: string,
    documentId: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
    readAt: Date,
  ): Promise<boolean>;
}

export const ESIGN_REPOSITORY = Symbol('ESIGN_REPOSITORY');

/**
 * A stand-in for a port whose implementation is not on main yet (the esign tables, R18's
 * engine): every call fails. The module switch keeps Firm Sign off until then, so no request
 * reaches it.
 */
export function notMigrated<T extends object>(what: string): T {
  return new Proxy({} as T, {
    // Nothing for `then` (Nest awaits providers: a thenable would never settle), lifecycle hooks
    // (onModuleInit, beforeApplicationShutdown...) or symbols.
    get: (_, method) =>
      typeof method !== 'string' || method === 'then' || /^(on|before)[A-Z]/.test(method)
        ? undefined
        : () => {
            throw new Error(`${what}.${method} is not available yet`);
          },
  });
}
