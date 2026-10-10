import { Injectable } from '@nestjs/common';
import { ESIGN_OPEN_STATUSES } from '@firmivra/types';
import type { Database, TxClient } from '@firmivra/db';
import { databaseErrorCode } from '@firmivra/db';
import {
  addEvents,
  addLinks,
  fresh,
  inFirm,
  InjectDatabase,
  lockRequest,
  nextActivity,
  queueEmails,
  toRequest,
} from '../requests/esign-prisma.js';
import type { EsignEventRecord } from '../requests/esign.repository.js';
import { requestWhere } from '../requests/prisma-esign.repository.js';
import type { LifecycleEmail, LifecycleWritten } from '../lifecycle/lifecycle.repository.js';
import type {
  ApprovalDecisionWrite,
  EsignExtrasRepository,
  EsignKioskLock,
  EsignReportFilter,
  EsignReportRow,
  EsignStaffRole,
  StartInPersonWrite,
  SubmitApprovalWrite,
} from './extras.repository.js';

const OPEN: readonly string[] = ESIGN_OPEN_STATUSES;
const LOCK = {
  userId: true,
  requestId: true,
  recipientId: true,
  signerName: true,
  startedAt: true,
  linkExpiresAt: true,
  activeAt: true,
} as const;
type Write = { at: Date; events: EsignEventRecord[]; emails: LifecycleEmail[] };

/**
 * Firm Sign's extras in PostgreSQL (R13, r0_esign): approvals, the members' Firm Sign roles,
 * reports and in-person signing, in the firm's scope. Request writes lock the request FOR UPDATE
 * and apply only in the expected status while its lastActivityAt is still `readAt`.
 */
@Injectable()
export class PrismaExtrasRepository implements EsignExtrasRepository {
  constructor(@InjectDatabase() private readonly database: Database) {}

  private db(businessId: string) {
    return this.database.forBusiness(businessId);
  }

  /** `change` (false: refused, nothing written), then lastActivityAt, events and emails. */
  private apply(
    businessId: string,
    id: string,
    status: string,
    write: Write,
    readAt: Date,
    change: (tx: TxClient) => Promise<boolean>,
  ): Promise<LifecycleWritten | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const locked = await lockRequest(tx, id);
      if (locked?.status !== status || !fresh(locked, readAt) || !(await change(tx))) return null;
      const row = await tx.esignRequest.update({
        where: { id },
        data: { lastActivityAt: nextActivity(locked.lastActivityAt, write.at) },
      });
      await addEvents(tx, businessId, id, write.events);
      const emailIds = await queueEmails(tx, businessId, id, write.emails);
      return { request: toRequest(row), emailIds };
    });
  }

  submitForApproval(businessId: string, id: string, write: SubmitApprovalWrite, readAt: Date) {
    return this.apply(businessId, id, 'DRAFT', write, readAt, async (tx) => {
      await tx.esignRequest.update({ where: { id }, data: { status: 'NEEDS_APPROVAL' } });
      await tx.esignRecipient.updateMany({
        where: { requestId: id, kind: 'APPROVER' },
        data: { status: 'SENT', sentAt: write.at },
      });
      return true;
    });
  }

  decideApproval(businessId: string, id: string, write: ApprovalDecisionWrite, readAt: Date) {
    return this.apply(businessId, id, 'NEEDS_APPROVAL', write, readAt, async (tx) => {
      const me = await tx.esignRecipient.findFirst({
        where: { id: write.recipientId, requestId: id, kind: 'APPROVER' },
        select: { status: true },
      });
      if (!me || me.status === 'APPROVED') return false;
      if (write.decision === 'APPROVE') {
        await tx.esignRecipient.update({
          where: { id: write.recipientId },
          data: { status: 'APPROVED' },
        });
      } else {
        await tx.esignRecipient.updateMany({
          where: { requestId: id, kind: 'APPROVER' },
          data: { status: 'WAITING', sentAt: null },
        });
      }
      if (write.decision === 'REJECT' || write.last) {
        await tx.esignRequest.update({ where: { id }, data: { status: 'DRAFT' } });
      }
      await tx.esignApprovalNote.create({
        data: {
          ...{ businessId, requestId: id, recipientId: write.recipientId },
          decision: write.decision,
          note: write.note?.trim() ? write.note : null,
          createdAt: write.at,
        },
      });
      return true;
    });
  }

  queueEmails(businessId: string, id: string, emails: LifecycleEmail[]): Promise<string[]> {
    return inFirm(this.database, businessId, (tx) => queueEmails(tx, businessId, id, emails));
  }

  async staffRoles(businessId: string): Promise<Map<string, EsignStaffRole>> {
    const rows = await this.db(businessId).esignMemberRole.findMany({
      where: { businessId },
      select: { userId: true, role: true },
    });
    return new Map(rows.map((r) => [r.userId, r.role]));
  }

  async setStaffRole(
    businessId: string,
    userId: string,
    role: EsignStaffRole | null,
  ): Promise<EsignStaffRole | null> {
    const roles = this.db(businessId).esignMemberRole;
    if (role === null) {
      await roles.deleteMany({ where: { businessId, userId } });
      return null;
    }
    const row = await roles.upsert({
      where: { businessId_userId: { businessId, userId } },
      create: { businessId, userId, role },
      update: { role },
    });
    return row.role;
  }

  async report(businessId: string, f: EsignReportFilter): Promise<EsignReportRow[]> {
    const where = requestWhere({
      visibleTo: f.visibleTo,
      ...(f.senderUserId && { senderUserId: f.senderUserId }),
      ...(f.status && { statuses: [f.status] }),
    });
    const groups = await this.db(businessId).esignRequest.groupBy({
      by: ['senderUserId', 'status'],
      where: { ...where, sentAt: { gte: f.sentFrom, lt: f.sentBefore } },
      _count: { _all: true },
    });
    // Turnaround over the COMPLETED ones (sum of completed_at - sent_at).
    const completed = await this.db(businessId).esignRequest.findMany({
      where: { ...where, sentAt: { gte: f.sentFrom, lt: f.sentBefore }, status: 'COMPLETED' },
      select: { senderUserId: true, sentAt: true, completedAt: true },
    });
    const rows = new Map<string, EsignReportRow>();
    const rowOf = (senderUserId: string) => {
      let row = rows.get(senderUserId);
      if (!row) rows.set(senderUserId, (row = { senderUserId, counts: {}, completionMs: 0 }));
      return row;
    };
    for (const g of groups) rowOf(g.senderUserId).counts[g.status] = g._count._all;
    for (const q of completed) {
      if (q.sentAt && q.completedAt)
        rowOf(q.senderUserId).completionMs += +q.completedAt - +q.sentAt;
    }
    return [...rows.values()];
  }

  async startInPerson(
    businessId: string,
    id: string,
    write: StartInPersonWrite,
    readAt: Date,
  ): Promise<EsignKioskLock | null> {
    const { lock } = write;
    try {
      return await inFirm(this.database, businessId, async (tx) => {
        const held = await tx.esignKioskLock.findFirst({ where: { userId: lock.userId } });
        const locked = await lockRequest(tx, id);
        if (held || !locked || !OPEN.includes(locked.status) || !fresh(locked, readAt)) {
          return null;
        }
        // token_version + 1: every earlier link of theirs stops; the new one is at the new one.
        const me = await tx.esignRecipient.updateMany({
          where: { id: lock.recipientId, requestId: id, signedAt: null, declinedAt: null },
          data: { tokenVersion: { increment: 1 } },
        });
        if (me.count !== 1) return null;
        const link = {
          recipientId: lock.recipientId,
          tokenHash: write.tokenHash,
          expiresAt: lock.linkExpiresAt,
        };
        await addLinks(tx, businessId, id, [link], 'IN_PERSON');
        const created = await tx.esignKioskLock.create({
          data: { ...lock, businessId, wrongPasswords: 0 },
          select: LOCK,
        });
        await tx.esignRequest.update({
          where: { id },
          data: { lastActivityAt: nextActivity(locked.lastActivityAt, write.at) },
        });
        await addEvents(tx, businessId, id, write.events);
        return created;
      });
    } catch (error) {
      // Another tab of the same member started one first (one lock per member and firm).
      if (databaseErrorCode(error) === '23505') return null;
      throw error;
    }
  }

  kioskLock(businessId: string, userId: string): Promise<EsignKioskLock | null> {
    return this.db(businessId).esignKioskLock.findFirst({ where: { userId }, select: LOCK });
  }

  async kioskWrongPassword(businessId: string, userId: string): Promise<number> {
    return inFirm(this.database, businessId, async (tx) => {
      const [row] = await tx.$queryRaw<{ n: number }[]>`
        UPDATE esign_kiosk_locks SET wrong_passwords = LEAST(wrong_passwords + 1, 5)
        WHERE user_id = ${userId}::uuid RETURNING wrong_passwords AS n`;
      return row?.n ?? 0;
    });
  }

  async endKiosk(
    businessId: string,
    userId: string,
    write: { at: Date; events: EsignEventRecord[] },
  ): Promise<EsignKioskLock | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const lock = await tx.esignKioskLock.findFirst({ where: { userId }, select: LOCK });
      if (!lock) return null;
      const gone = await tx.esignKioskLock.deleteMany({ where: { userId } });
      if (gone.count !== 1) return null;
      await lockRequest(tx, lock.requestId);
      // The signer's session ends with token_version + 1, even after the request closed (the one
      // change the database lets a closed request's recipient have).
      await tx.esignRecipient.updateMany({
        where: { id: lock.recipientId, requestId: lock.requestId },
        data: { tokenVersion: { increment: 1 } },
      });
      await addEvents(tx, businessId, lock.requestId, write.events);
      return lock;
    });
  }
}
