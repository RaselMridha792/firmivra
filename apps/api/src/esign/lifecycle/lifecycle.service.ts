import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type {
  EsignCorrectRecipientBody,
  EsignEventType,
  EsignRecipientStatus,
  EsignRequestDetail,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import {
  NOTIFY_SERVICE,
  type NotifyMessage,
  type NotifyService,
} from '../../notify/notify.types.js';
import {
  ESIGN_STORE,
  type EsignStore,
  LINK_TOKENS,
  type LinkTokens,
} from '../engine/engine.types.js';
import { isOpen, TURN } from '../requests/actions.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignEventRecord,
  type EsignRecipientRecord,
  type EsignRepository,
  type EsignRequestRecord,
} from '../requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
  esignRefusal,
} from '../requests/requests.service.js';
import {
  type EsignLifecycleRepository,
  type IssuedLink,
  LIFECYCLE_REPOSITORY,
  type LifecycleEmail,
  type LifecycleWritten,
} from './lifecycle.repository.js';

const HOUR_MS = 3_600_000;
const DONE: readonly EsignRecipientStatus[] = ['SIGNED', 'APPROVED', 'REJECTED', 'DECLINED'];
const entity = (id: string) => ({ type: 'esign_request', id });
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
/** An error's class name for the log and the outbox (never its message). */
const errorName = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
};
/** Who acts: a staff member by name, or Firmivra's jobs. */
export type LifecycleBy = { kind: 'STAFF'; name: string } | { kind: 'SYSTEM' };
/** An email to queue and the message it becomes (its link carries a token: memory only). */
export type Outgoing = { email: LifecycleEmail; message: NotifyMessage };

/**
 * The lifecycle of a sent request (R13 step 8): remind, void, correct a recipient and replace.
 * Each is a write (the sender, the client's assigned member, Owner and Admin; an approver gets
 * 404, a Viewer 403) on an open request: 409 REQUEST_CLOSED once closed, INVALID_STATE before it
 * is sent (void and replace also take NEEDS_APPROVAL). lastActivityAt is the optimistic lock (a
 * write in between is 409 INVALID_STATE). Emails go through the outbox; the timeline, the audit
 * and the log get ids only, never a reason, an address, a link or a token.
 */
@Injectable()
export class EsignLifecycleService {
  private readonly logger = new Logger(EsignLifecycleService.name);

  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(LIFECYCLE_REPOSITORY) private readonly lifecycle: EsignLifecycleRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(ESIGN_STORE)
    private readonly store: Pick<EsignStore, 'keyFor' | 'read' | 'put' | 'remove'>,
    @Inject(LINK_TOKENS) private readonly tokens: Pick<LinkTokens, 'issue'>,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
    @Inject(ENV) private readonly env: Pick<Env, 'PORTAL_BASE_URL' | 'APP_BASE_URL'>,
  ) {}

  /** Every signer whose turn it is (but IN_PERSON ones), or one; at most once an hour each. */
  async remind(
    businessId: string,
    actor: EsignActor,
    id: string,
    recipientId?: string,
  ): Promise<EsignRequestDetail> {
    const record = await this.sent(businessId, actor, id, false);
    const { recipients } = await this.repo.parts(businessId, id);
    const one = recipientId === undefined ? null : recipients.find((r) => r.id === recipientId);
    if (one === undefined) throw notFound();
    if (one && DONE.includes(one.status)) throw esignRefusal('RECIPIENT_DONE');
    const targets = recipients.filter(
      (r) =>
        r.kind === 'SIGNER' &&
        TURN.includes(r.status) &&
        r.delivery !== 'IN_PERSON' &&
        (!one || r.id === one.id),
    );
    if (targets.length === 0) throw esignRefusal('INVALID_STATE');
    const now = new Date();
    if (targets.some((r) => r.lastRemindedAt && +now - +r.lastRemindedAt < HOUR_MS)) {
      throw esignRefusal('REMIND_TOO_SOON');
    }
    const by = await this.staff(businessId, actor);
    const written = await this.nudge(businessId, record, targets, by, now);
    if (!written) throw esignRefusal('INVALID_STATE');
    await this.audit.log('esign.request_reminded', entity(id), {
      clientId: record.clientId,
      recipientIds: targets.map((r) => r.id),
      emailIds: written.emailIds,
    });
    return this.requests.answer(businessId, written.request);
  }

  /**
   * Reminds `targets` (their turn, checked by the caller): a fresh link each by email (PORTAL
   * signers get the Signature center), REMINDER_SENT each. Null when the request changed.
   */
  async nudge(
    businessId: string,
    record: EsignRequestRecord,
    targets: EsignRecipientRecord[],
    by: LifecycleBy,
    now: Date,
  ): Promise<LifecycleWritten | null> {
    const portal = await this.portal(businessId);
    const links: IssuedLink[] = [];
    const outgoing = targets.flatMap((r): Outgoing[] => {
      if (!r.email) return [];
      let link = `${portal}/signatures`;
      if (r.delivery !== 'PORTAL') {
        const { token, hash } = this.tokens.issue();
        links.push({ recipientId: r.id, tokenHash: hash });
        link = `${portal}/sign#t=${token}`;
      }
      const data = { name: r.name, title: record.title, link };
      const message = { template: 'esign.reminder' as const, to: r.email, businessId, data };
      return [{ email: { recipientId: r.id, template: 'esign.reminder' }, message }];
    });
    const write = {
      at: now,
      recipientIds: targets.map((r) => r.id),
      links,
      events: targets.map((r) => event('REMINDER_SENT', now, by, r)),
      emails: outgoing.map((o) => o.email),
    };
    const written = await this.lifecycle.remind(
      businessId,
      record.id,
      write,
      record.lastActivityAt,
    );
    if (written) await this.deliver(businessId, written.emailIds, outgoing);
    return written;
  }

  /** VOIDED with the reason; every signer who was sent it is told (no reason in the email). */
  async void(
    businessId: string,
    actor: EsignActor,
    id: string,
    reason: string,
  ): Promise<EsignRequestDetail> {
    const record = await this.sent(businessId, actor, id, true);
    const { recipients } = await this.repo.parts(businessId, id);
    const now = new Date();
    const by = await this.staff(businessId, actor);
    const outgoing = this.voidedEmails(businessId, record, recipients);
    const write = {
      at: now,
      reason,
      byUserId: actor.userId,
      events: [{ ...event('VOIDED', now, by, null), reason }],
      emails: outgoing.map((o) => o.email),
    };
    const written = await this.lifecycle.void(businessId, id, write, record.lastActivityAt);
    if (!written) throw esignRefusal('INVALID_STATE');
    await this.audit.log('esign.request_voided', entity(id), {
      clientId: record.clientId,
      emailIds: written.emailIds,
    });
    await this.deliver(businessId, written.emailIds, outgoing);
    return this.requests.answer(businessId, written.request);
  }

  /**
   * An EXTERNAL recipient who has not finished: their earlier links stop working, and when it is
   * their turn by email a new invitation goes to the (corrected) address.
   */
  async correct(
    businessId: string,
    actor: EsignActor,
    id: string,
    recipientId: string,
    body: z.output<typeof EsignCorrectRecipientBody>,
  ): Promise<EsignRequestDetail> {
    const record = await this.sent(businessId, actor, id, false);
    const { recipients } = await this.repo.parts(businessId, id);
    const old = recipients.find((r) => r.id === recipientId);
    if (!old) throw notFound();
    if (DONE.includes(old.status)) throw esignRefusal('RECIPIENT_DONE');
    if (old.link.type !== 'EXTERNAL') throw esignRefusal('INVALID_STATE');
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const r: EsignRecipientRecord = { ...old, ...patch };
    const now = new Date();
    let link: IssuedLink | null = null;
    const outgoing: Outgoing[] = [];
    if (TURN.includes(r.status) && r.delivery === 'EMAIL' && r.email) {
      const { token, hash } = this.tokens.issue();
      link = { recipientId: r.id, tokenHash: hash };
      const sender = await this.directory.member(businessId, record.senderUserId);
      const data = {
        name: r.name,
        title: record.title,
        link: `${await this.portal(businessId)}/sign#t=${token}`,
        senderName: sender?.name ?? '',
        message: record.emailMessage,
      };
      const message = { template: 'esign.request' as const, to: r.email, businessId, data };
      outgoing.push({ email: { recipientId: r.id, template: 'esign.request' }, message });
    }
    const write = {
      at: now,
      recipientId,
      patch,
      link,
      events: [event('CORRECTED', now, await this.staff(businessId, actor), r)],
      emails: outgoing.map((o) => o.email),
    };
    const written = await this.lifecycle.correct(businessId, id, write, record.lastActivityAt);
    if (!written) throw esignRefusal('INVALID_STATE');
    await this.audit.log('esign.recipient_corrected', entity(id), {
      clientId: record.clientId,
      recipientId,
      changed: Object.keys(patch),
      emailIds: written.emailIds,
    });
    await this.deliver(businessId, written.emailIds, outgoing);
    return this.requests.answer(businessId, written.request);
  }

  /**
   * Voids it (REPLACED on its timeline) and answers a new DRAFT sent by the caller: its files
   * copied in the store, pages, recipients (WAITING, access codes to set again: a code's hash is
   * bound to the recipient's id), fields (unfilled) and settings, with `replacesRequestId`.
   */
  async replace(
    businessId: string,
    actor: EsignActor,
    id: string,
    reason: string,
  ): Promise<EsignRequestDetail> {
    const old = await this.sent(businessId, actor, id, true);
    const parts = await this.repo.parts(businessId, id);
    const newId = randomUUID();
    const now = new Date();
    const by = await this.staff(businessId, actor);
    const docIds = new Map(parts.documents.map((d) => [d.id, randomUUID()]));
    const recipientIds = new Map(parts.recipients.map((r) => [r.id, randomUUID()]));
    const copied: string[] = [];
    try {
      const documents = [];
      for (const d of parts.documents) {
        const docId = docIds.get(d.id)!;
        const bytes = await this.store.read(businessId, d.s3Key);
        if (!bytes) throw new Error(`esign document ${d.id} is missing from the store`);
        const s3Key = this.store.keyFor(businessId, newId, `source/${docId}`);
        await this.store.put(businessId, s3Key, bytes, d.contentType);
        copied.push(s3Key);
        documents.push({ ...d, id: docId, s3Key, createdAt: now });
      }
      const replacement = {
        record: {
          ...old,
          id: newId,
          status: 'DRAFT' as const,
          senderUserId: actor.userId,
          createdAt: now,
          lastActivityAt: now,
          sentAt: null,
          expiresAt: null,
          completedAt: null,
          originalSha256: null,
          expiredAt: null,
          voidedAt: null,
          voidReason: null,
          voidedByUserId: null,
          replacesRequestId: old.id,
          replacedByRequestId: null,
        },
        parts: {
          documents,
          pagePlan: parts.pagePlan.map((p) => ({ ...p, documentId: docIds.get(p.documentId)! })),
          recipients: parts.recipients.map((r) => ({
            ...r,
            id: recipientIds.get(r.id)!,
            accessCodeHash: null,
            status: 'WAITING' as const,
            sentAt: null,
            viewedAt: null,
            signedAt: null,
            declinedAt: null,
            declineReason: null,
            lastRemindedAt: null,
            reminderCount: 0,
          })),
          fields: parts.fields.map((f) => ({
            ...f,
            id: randomUUID(),
            recipientId: f.recipientId && recipientIds.get(f.recipientId)!,
            filled: false,
          })),
        },
        event: event('CREATED', now, by, null),
      };
      const outgoing = this.voidedEmails(businessId, old, parts.recipients);
      const write = {
        at: now,
        reason,
        byUserId: actor.userId,
        replacement,
        events: [{ ...event('REPLACED', now, by, null), reason }],
        emails: outgoing.map((o) => o.email),
      };
      const written = await this.lifecycle.replace(businessId, id, write, old.lastActivityAt);
      if (!written) throw esignRefusal('INVALID_STATE');
      copied.length = 0; // the new draft owns them now
      await this.audit.log('esign.request_replaced', entity(id), {
        clientId: old.clientId,
        replacedByRequestId: newId,
        emailIds: written.emailIds,
      });
      await this.deliver(businessId, written.emailIds, outgoing);
      return this.requests.answer(businessId, written.created);
    } finally {
      for (const key of copied) {
        await this.store.remove(businessId, key).catch((error: unknown) => {
          this.logger.warn(`Could not remove a copied esign file of ${newId}: ${errorName(error)}`);
        });
      }
    }
  }

  /** The request if the caller may change it and it was sent; `approval`: NEEDS_APPROVAL too. */
  private async sent(businessId: string, actor: EsignActor, id: string, approval: boolean) {
    const { record } = await this.requests.reach(businessId, actor, id, 'write');
    if (!isOpen(record.status) && !(approval && record.status === 'NEEDS_APPROVAL')) {
      const closed = record.status !== 'DRAFT' && record.status !== 'NEEDS_APPROVAL';
      throw esignRefusal(closed ? 'REQUEST_CLOSED' : 'INVALID_STATE');
    }
    return record;
  }

  private voidedEmails(businessId: string, record: EsignRequestRecord, rs: EsignRecipientRecord[]) {
    return rs.flatMap((r): Outgoing[] => {
      if (r.kind !== 'SIGNER' || !r.sentAt || !r.email || DONE.includes(r.status)) return [];
      const data = { name: r.name, title: record.title };
      const message = { template: 'esign.voided' as const, to: r.email, businessId, data };
      return [{ email: { recipientId: r.id, template: 'esign.voided' }, message }];
    });
  }

  async staff(businessId: string, actor: EsignActor): Promise<LifecycleBy> {
    const member = await this.directory.member(businessId, actor.userId);
    return { kind: 'STAFF', name: member?.name ?? '' };
  }

  private async portal(businessId: string) {
    const firm = await this.directory.firm(businessId);
    return `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}`;
  }

  /**
   * Sends each queued email and records its outcome. A failure leaves the write standing and the
   * email FAILED; the log gets the email's id and the error's class name only.
   */
  async deliver(businessId: string, emailIds: string[], outgoing: Outgoing[]) {
    for (const [i, o] of outgoing.entries()) {
      const emailId = emailIds[i];
      if (!emailId) continue;
      let outcome: { sent: true } | { sent: false; error: string } = { sent: true };
      try {
        await this.notify.send(o.message);
      } catch (error) {
        outcome = { sent: false, error: errorName(error) };
        this.logger.warn(`${o.email.template} email ${emailId} not sent (${outcome.error})`);
      }
      try {
        await this.repo.emailOutcome(businessId, emailId, outcome);
      } catch (error) {
        this.logger.warn(`esign email ${emailId}: outcome not recorded (${errorName(error)})`);
      }
    }
  }
}

/** A timeline row: the names as they are now, never a field value. */
export function event(
  type: EsignEventType,
  at: Date,
  by: LifecycleBy,
  recipient: Pick<EsignRecipientRecord, 'id' | 'name'> | null,
): EsignEventRecord {
  return {
    id: randomUUID(),
    type,
    createdAt: at,
    actorKind: by.kind,
    actorName: by.kind === 'STAFF' ? by.name : 'Firmivra',
    recipient: recipient && { id: recipient.id, name: recipient.name },
    reason: null,
    authMethod: null,
  };
}
