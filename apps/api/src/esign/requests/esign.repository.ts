import type {
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
  // Draft writes: each applies only while the request is still a DRAFT, sets lastActivityAt and
  // returns false (changing nothing) when it is not, or no longer exists.
  updateDraft(businessId: string, id: string, patch: EsignDraftPatch): Promise<boolean>;
  /** Deletes the draft and its documents, pages, recipients and fields. */
  deleteDraft(businessId: string, id: string): Promise<boolean>;
  /** Replaces the page plan and the fields (moved with their pages) together. */
  savePagePlan(
    businessId: string,
    id: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
  ): Promise<boolean>;
  /** Replaces the recipients and the fields (those of removed signers dropped) together. */
  saveRecipients(
    businessId: string,
    id: string,
    recipients: EsignRecipientRecord[],
    fields: EsignField[],
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
