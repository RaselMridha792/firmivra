import type {
  EsignEventRecord,
  EsignRecipientRecord,
  EsignRequestParts,
  EsignRequestRecord,
} from '../requests/esign.repository.js';

// Firm Sign's lifecycle storage (R13): remind, void, correct and replace, and the jobs' reminders,
// expiry warnings and expiry. Like the other esign
// ports, every method takes the firm first and the Prisma implementation (with r0_esign) uses only
// forBusiness(businessId), never the owner client. Each write runs in one transaction under the
// request's FOR UPDATE lock and applies only while its lastActivityAt is still `readAt` (every
// write moves it strictly forward, so the status the service checked still holds); otherwise it
// answers null and writes nothing. Until r0_esign the API has notMigrated() and tests use
// InMemoryLifecycleRepository (test/unit/esign-fakes.ts).

/** Lifecycle emails (esign_emails, QUEUED): who and which template, never the address or link. */
export type LifecycleEmail =
  | {
      recipientId: string;
      template: 'esign.request' | 'esign.reminder' | 'esign.expiring' | 'esign.voided';
    }
  | { userId: string; template: 'esign.staff-update' };

/**
 * A new signing link, by its SHA-256 only (never the token). It joins the recipient's earlier
 * links, which keep working at the same token_version.
 */
export interface IssuedLink {
  recipientId: string;
  tokenHash: string;
}

export interface LifecycleWrite {
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

/**
 * The recipient's name, email or phone. token_version + 1, so every earlier link of theirs stops
 * working, and an open email code is dropped; then `link`, when it is their turn.
 */
export interface CorrectWrite extends LifecycleWrite {
  recipientId: string;
  patch: Partial<Pick<EsignRecipientRecord, 'name' | 'email' | 'phone'>>;
  link: IssuedLink | null;
}

/** The new DRAFT, with its own ids throughout (its files already copied in the store). */
export interface Replacement {
  record: EsignRequestRecord;
  parts: EsignRequestParts;
  /** Its CREATED event (`events` are the old request's). */
  event: EsignEventRecord;
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
  /** The expiry warning: expiryWarnedAt = `at` (once), and the recipients' new links. */
  warn(
    businessId: string,
    id: string,
    write: RemindWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
  /** EXPIRED with expiredAt = `at`; like VOIDED, every link of the request stops working. */
  expire(
    businessId: string,
    id: string,
    write: LifecycleWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
  /** VOIDED: every link of the request stops working (findLink answers only open requests). */
  void(
    businessId: string,
    id: string,
    write: VoidWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
  correct(
    businessId: string,
    id: string,
    write: CorrectWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
  /**
   * Voids the request as `void` does, with replacedByRequestId, and inserts the new DRAFT (its
   * replacesRequestId set) with its documents, page plan, recipients, fields and CREATED event.
   */
  replace(
    businessId: string,
    id: string,
    write: VoidWrite & { replacement: Replacement },
    readAt: Date,
  ): Promise<(LifecycleWritten & { created: EsignRequestRecord }) | null>;
  // The jobs (no request context: each call names its firm and runs in that firm's scope).
  /** The work under the job's advisory lock; null, running nothing, if another task holds it. */
  withJobLock<T>(work: () => Promise<T>): Promise<T | null>;
  /** The ACTIVE firms with Firm Sign on. */
  firms(): Promise<string[]>;
  /**
   * Up to `limit` open requests (SENT, DELIVERED, VIEWED, PARTIALLY_SIGNED) with work at `now`,
   * soonest expiry first: expires_at <= now while a signer has not signed; or the warning is due
   * (expiry_warning_days > 0, expiry_warned_at null, expires_at - warning days <= now); or a
   * SIGNER whose turn it is (not IN_PERSON) has reminder_count < reminders.max and
   * COALESCE(last_reminded_at + everyDays, sent_at + firstAfterDays) <= now, before expires_at.
   */
  due(businessId: string, now: Date, limit: number): Promise<string[]>;
}

export const LIFECYCLE_REPOSITORY = Symbol('ESIGN_LIFECYCLE_REPOSITORY');
