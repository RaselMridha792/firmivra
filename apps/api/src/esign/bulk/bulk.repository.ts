import type { z } from 'zod';
import type {
  EsignBulkItemState,
  EsignBulkSendBody,
  EsignErrorCode,
  EsignReadinessCode,
} from '@firmivra/types';

// Firm Sign's bulk send storage (R13). Like the other esign ports, every method takes the firm
// first and the Prisma implementation (with r0_esign: esign_bulk_batches and esign_bulk_items)
// uses only forBusiness(businessId), never the owner client. A batch keeps ids and role fills
// only (never an access code: EsignBulkRoleFill refuses one). Until r0_esign the API has
// notMigrated() and tests use InMemoryBulkRepository (test/unit/esign-fakes.ts).

/** A readiness code or a Firm Sign error code (EsignBulkBatch's `problem`). */
export type EsignBulkProblem = EsignReadinessCode | EsignErrorCode;

/** One client's row, in the order given. */
export interface EsignBulkItemRecord {
  position: number;
  clientId: string;
  /** The service given; else the client's only open one, picked when the job makes the DRAFT. */
  engagementId: string | null;
  /**
   * The request's id, chosen with the batch: a run that stopped half way finds the DRAFT it made
   * by this id and never makes a second one.
   */
  requestId: string;
  /** True once the DRAFT exists (requestId is answered from then on). */
  created: boolean;
  state: EsignBulkItemState;
  problem: EsignBulkProblem | null;
  /** Runs that failed on something other than a refusal (the row gives up after 3). */
  attempts: number;
}

export interface EsignBulkBatchRecord {
  id: string;
  templateId: string;
  /** The template's newest version when the batch was made: every client gets the same one. */
  templateVersion: number;
  templateName: string;
  createdByUserId: string;
  createdAt: Date;
  title: string | null;
  roles: z.output<typeof EsignBulkSendBody>['roles'];
  items: EsignBulkItemRecord[];
}

/** What a run changes on a QUEUED row. */
export type EsignBulkItemPatch = Partial<
  Pick<EsignBulkItemRecord, 'engagementId' | 'created' | 'state' | 'problem' | 'attempts'>
>;

export interface EsignBulkRepository {
  /** Inserts the batch and its rows in one transaction. */
  create(businessId: string, batch: EsignBulkBatchRecord): Promise<void>;
  /** Null when the firm has no such batch (another firm's id included). */
  find(businessId: string, id: string): Promise<EsignBulkBatchRecord | null>;
  /** Changes one row while it is still QUEUED; false (nothing written) otherwise. */
  updateItem(
    businessId: string,
    batchId: string,
    position: number,
    patch: EsignBulkItemPatch,
  ): Promise<boolean>;
  // The job (no request context: each call names its firm and runs in that firm's scope).
  /** The work under bulk send's own advisory lock; null, running nothing, if another task has it. */
  withJobLock<T>(work: () => Promise<T>): Promise<T | null>;
  /** Up to `limit` QUEUED rows of the firm, oldest batch first, then by position. */
  queued(businessId: string, limit: number): Promise<{ batchId: string; position: number }[]>;
}

export const BULK_REPOSITORY = Symbol('ESIGN_BULK_REPOSITORY');
