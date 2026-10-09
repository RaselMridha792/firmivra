import type {
  EsignAccessRole,
  EsignDefaults,
  EsignDocument,
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
}

export type NewEsignRequest = Omit<
  EsignRequestRecord,
  'id' | 'status' | 'createdAt' | 'lastActivityAt' | 'sentAt' | 'expiresAt' | 'completedAt'
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

/** The request's documents (upload order), page plan (packet order), recipients and fields. */
export interface EsignRequestParts {
  documents: EsignDocumentRecord[];
  pagePlan: EsignPage[];
  recipients: EsignRecipientRecord[];
  fields: EsignField[];
}

export interface EsignRepository {
  /** The firm's defaults for new requests (Signing Settings). */
  defaults(businessId: string): Promise<EsignDefaults>;
  createRequest(businessId: string, input: NewEsignRequest): Promise<EsignRequestRecord>;
  /** Null when the firm has no such request (another firm's id included). */
  findRequest(businessId: string, id: string): Promise<EsignRequestRecord | null>;
  parts(businessId: string, id: string): Promise<EsignRequestParts>;
  /** A member's Firm Sign access (OWNER and ADMIN follow the firm role); null if not a member. */
  esignRole(businessId: string, userId: string): Promise<EsignAccessRole | null>;
  // Draft writes: each applies only while the request is still a DRAFT, sets lastActivityAt and
  // refuses (false, null or INVALID_STATE; changing nothing) when it is not, or no longer exists.
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
  // The two below replace what the service computed from parts() read before the write, so each
  // also refuses (false) unless the request's lastActivityAt is still `readAt`: checked under the
  // FOR UPDATE lock, a write in between (a PUT fields, say) is never silently reverted.
  /** Replaces the page plan and the fields (moved with their pages) together. */
  savePagePlan(
    businessId: string,
    id: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
    readAt: Date,
  ): Promise<boolean>;
  /** Replaces the recipients and the fields (those of removed signers dropped) together. */
  saveRecipients(
    businessId: string,
    id: string,
    recipients: EsignRecipientRecord[],
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
