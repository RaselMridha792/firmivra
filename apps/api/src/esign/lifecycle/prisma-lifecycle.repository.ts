import { Inject, Injectable } from '@nestjs/common';
import { ESIGN_OPEN_STATUSES } from '@firmivra/types';
import type { Database, TxClient } from '@firmivra/db';
import { esignFirms, withJobLock } from '../completion/prisma-completion.repository.js';
import {
  addEvents,
  addLinks,
  EsignFieldValues,
  fresh,
  inFirm,
  InjectDatabase,
  insertDraft,
  lockRequest,
  nextActivity,
  queueEmails,
  toRecipient,
  toRequest,
} from '../requests/esign-prisma.js';
import { expiryDue, reminderDue, warningDue } from './lifecycle.job.js';
import type {
  CorrectWrite,
  EsignLifecycleRepository,
  LifecycleWrite,
  LifecycleWritten,
  RemindWrite,
  Replacement,
  VoidWrite,
} from './lifecycle.repository.js';

type Change = (tx: TxClient, lastActivityAt: Date) => Promise<void>;

/**
 * Firm Sign's lifecycle in PostgreSQL (R13, r0_esign): remind, warn, expire, void, correct and
 * replace, each in one transaction in the firm's scope under the request's FOR UPDATE lock, only
 * while its lastActivityAt is still `readAt`. Recipients change before the request closes (the
 * database freezes a closed request's recipients).
 */
@Injectable()
export class PrismaLifecycleRepository implements EsignLifecycleRepository {
  constructor(
    @InjectDatabase() private readonly database: Database,
    @Inject(EsignFieldValues) private readonly values: EsignFieldValues,
  ) {}

  /** The write: `change`, then lastActivityAt, the events and the emails. */
  private apply(
    businessId: string,
    id: string,
    write: LifecycleWrite,
    readAt: Date,
    change: Change,
  ): Promise<LifecycleWritten | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const locked = await lockRequest(tx, id);
      if (!locked || !fresh(locked, readAt)) return null;
      const lastActivityAt = nextActivity(locked.lastActivityAt, write.at);
      await change(tx, lastActivityAt);
      const row = await tx.esignRequest.update({ where: { id }, data: { lastActivityAt } });
      await addEvents(tx, businessId, id, write.events);
      const emailIds = await queueEmails(tx, businessId, id, write.emails);
      return { request: toRequest(row), emailIds };
    });
  }

  remind(businessId: string, id: string, write: RemindWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, async (tx) => {
      await tx.esignRecipient.updateMany({
        where: { requestId: id, id: { in: write.recipientIds } },
        data: { lastRemindedAt: write.at, reminderCount: { increment: 1 } },
      });
      await addLinks(tx, businessId, id, write.links, 'SIGN');
    });
  }

  warn(businessId: string, id: string, write: RemindWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, async (tx) => {
      await addLinks(tx, businessId, id, write.links, 'SIGN');
      await tx.esignRequest.update({ where: { id }, data: { expiryWarnedAt: write.at } });
    });
  }

  expire(businessId: string, id: string, write: LifecycleWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, async (tx) => {
      await tx.esignRequest.update({
        where: { id },
        data: { status: 'EXPIRED', expiredAt: write.at },
      });
    });
  }

  void(businessId: string, id: string, write: VoidWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, (tx) => voided(tx, id, write));
  }

  correct(businessId: string, id: string, write: CorrectWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, async (tx) => {
      const { recipientId } = write;
      // token_version + 1: every earlier link of theirs stops; an open email code goes too.
      await tx.esignRecipient.update({
        where: { id: recipientId },
        data: { ...write.patch, tokenVersion: { increment: 1 } },
      });
      await tx.esignVerificationCode.deleteMany({ where: { recipientId, kind: 'EMAIL' } });
      if (write.link) await addLinks(tx, businessId, id, [write.link], 'SIGN');
    });
  }

  async replace(
    businessId: string,
    id: string,
    write: VoidWrite & { replacement: Replacement },
    readAt: Date,
  ) {
    const { record, parts, event } = write.replacement;
    const sealed = await this.values.seal(businessId, parts.fields);
    let created: ReturnType<typeof toRequest> | null = null;
    const written = await this.apply(businessId, id, write, readAt, async (tx) => {
      const draft = { ...record, replacesRequestId: id };
      created = await insertDraft(tx, businessId, draft, parts, sealed, event);
      await voided(tx, id, write, record.id);
    });
    return written && created ? { ...written, created } : null;
  }

  withJobLock<T>(work: () => Promise<T>): Promise<T | null> {
    return withJobLock(this.database, 'lifecycle', work);
  }

  firms(): Promise<string[]> {
    return esignFirms(this.database);
  }

  async due(businessId: string, now: Date, limit: number): Promise<string[]> {
    const rows = await this.database.forBusiness(businessId).esignRequest.findMany({
      where: { status: { in: [...ESIGN_OPEN_STATUSES] } },
      include: { recipients: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
    const due: string[] = [];
    for (const { recipients, ...row } of rows) {
      const q = toRequest(row);
      const rs = recipients.map(toRecipient);
      if (expiryDue(q, rs, now) || warningDue(q, now) || rs.some((r) => reminderDue(q, r, now))) {
        due.push(q.id);
        if (due.length >= limit) break;
      }
    }
    return due;
  }
}

/** VOIDED: the time, the reason (staff only) and who; with the request that replaces it. */
async function voided(tx: TxClient, id: string, write: VoidWrite, replacedBy?: string) {
  await tx.esignRequest.update({
    where: { id },
    data: {
      status: 'VOIDED',
      voidedAt: write.at,
      voidReason: write.reason,
      voidedByUserId: write.byUserId,
      ...(replacedBy && { replacedByRequestId: replacedBy }),
    },
  });
}
