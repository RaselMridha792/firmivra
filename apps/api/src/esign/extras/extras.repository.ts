import type { EsignRequestStatus } from '@firmivra/types';
import type { EsignEventRecord, EsignRequestFilter } from '../requests/esign.repository.js';
import type { LifecycleEmail, LifecycleWritten } from '../lifecycle/lifecycle.repository.js';

// Firm Sign's extras storage (R13, contract 3): approvals and the members' Firm Sign roles. Like
// the other esign ports, every method takes the firm first and the Prisma implementation (with
// r0_esign) uses only forBusiness(businessId), never the owner client. Each request write runs
// in one transaction under the request's FOR UPDATE lock and applies only while its
// lastActivityAt is still `readAt` (moving it strictly forward); otherwise it answers null and
// writes nothing. Until r0_esign the API has notMigrated() and tests use InMemoryExtrasRepository
// (test/unit/esign-fakes.ts).

/** DRAFT to NEEDS_APPROVAL: every APPROVER recipient SENT with sentAt = `at`. */
export interface SubmitApprovalWrite {
  at: Date;
  events: EsignEventRecord[];
  emails: LifecycleEmail[];
}

/**
 * One approver's decision (NEEDS_APPROVAL only, and only while that APPROVER recipient has not
 * APPROVED). APPROVE: the recipient APPROVED; with `last`, the request goes back to DRAFT with
 * its approvals standing, ready to send. REJECT: the request back to DRAFT and every APPROVER
 * WAITING again. The note (staff only: never in an email, a log or the audit) is kept in
 * esign_approval_notes either way.
 */
export interface ApprovalDecisionWrite {
  at: Date;
  recipientId: string;
  decision: 'APPROVE' | 'REJECT';
  note: string | null;
  last: boolean;
  events: EsignEventRecord[];
  emails: LifecycleEmail[];
}

/** A Staff member's Firm Sign access beyond STAFF (esign_member_roles). */
export type EsignStaffRole = 'MANAGER' | 'VIEWER';

/** The requests a report counts: sent at or after `sentFrom` and before `sentBefore`. */
export type EsignReportFilter = Pick<EsignRequestFilter, 'visibleTo' | 'senderUserId'> & {
  sentFrom: Date;
  sentBefore: Date;
  status?: EsignRequestStatus;
};

/** One sender's requests in a report: how many have each status now, and their turnaround. */
export interface EsignReportRow {
  senderUserId: string;
  counts: Partial<Record<EsignRequestStatus, number>>;
  /** Sum of completed_at - sent_at over the COMPLETED ones, in milliseconds. */
  completionMs: number;
}

export interface EsignExtrasRepository {
  submitForApproval(
    businessId: string,
    id: string,
    write: SubmitApprovalWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
  decideApproval(
    businessId: string,
    id: string,
    write: ApprovalDecisionWrite,
    readAt: Date,
  ): Promise<LifecycleWritten | null>;
  /** Queues emails about a request (esign_emails, QUEUED) outside a request write; their ids. */
  queueEmails(businessId: string, id: string, emails: LifecycleEmail[]): Promise<string[]>;
  /** The Staff members made MANAGER or VIEWER, by user id (every other Staff member is STAFF). */
  staffRoles(businessId: string): Promise<Map<string, EsignStaffRole>>;
  /** Sets (null: removes, back to STAFF) a Staff member's role; answers the role as stored. */
  setStaffRole(
    businessId: string,
    userId: string,
    role: EsignStaffRole | null,
  ): Promise<EsignStaffRole | null>;
  /**
   * One row per sender with a matching request (SQL: GROUP BY sender_user_id, status), with the
   * same visibility as the list (`visibleTo`).
   */
  report(businessId: string, filter: EsignReportFilter): Promise<EsignReportRow[]>;
}

export const EXTRAS_REPOSITORY = Symbol('ESIGN_EXTRAS_REPOSITORY');
