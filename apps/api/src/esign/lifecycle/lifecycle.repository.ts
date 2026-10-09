import type { EsignEventRecord, EsignRequestRecord } from '../requests/esign.repository.js';

// Firm Sign's lifecycle storage (R13): remind and void (correct and replace follow). Like the other esign
// ports, every method takes the firm first and the Prisma implementation (with r0_esign) uses only
// forBusiness(businessId), never the owner client. Each write runs in one transaction under the
// request's FOR UPDATE lock and applies only while its lastActivityAt is still `readAt` (every
// write moves it strictly forward, so the status the service checked still holds); otherwise it
// answers null and writes nothing. Until r0_esign the API has notMigrated() and tests use
// InMemoryLifecycleRepository (test/unit/esign-fakes.ts).

/** Lifecycle emails (esign_emails, QUEUED): who and which template, never the address or link. */
export type LifecycleEmail =
  | { recipientId: string; template: 'esign.request' | 'esign.reminder' | 'esign.voided' }
  | { userId: string; template: 'esign.staff-update' };

/**
 * A new signing link, by its SHA-256 only (never the token). It joins the recipient's earlier
 * links, which keep working at the same token_version.
 */
export interface IssuedLink {
  recipientId: string;
  tokenHash: string;
}

interface LifecycleWrite {
  at: Date;
  events: EsignEventRecord[];
  emails: LifecycleEmail[];
}

/** A reminder: each recipient's lastRemindedAt = `at` and reminderCount + 1, and their links. */
export interface RemindWrite extends LifecycleWrite {
  recipientIds: string[];
  links: IssuedLink[];
}

/** VOIDED: voidedAt = `at`, the reason (staff only) and who. */
export interface VoidWrite extends LifecycleWrite {
  reason: string;
  byUserId: string;
}

/** The request as written and the queued emails' ids, in `emails` order. */
export interface LifecycleWritten {
  request: EsignRequestRecord;
  emailIds: string[];
}

export interface EsignLifecycleRepository {
  remind(
    businessId: string,
    id: string,
    write: RemindWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
  /** VOIDED: every link of the request stops working (findLink answers only open requests). */
  void(
    businessId: string,
    id: string,
    write: VoidWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
}

export const LIFECYCLE_REPOSITORY = Symbol('ESIGN_LIFECYCLE_REPOSITORY');
