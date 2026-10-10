import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ESIGN_ERRORS, type EsignRequestDetail } from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { NOTIFY_SERVICE, type NotifyService } from '../../notify/notify.types.js';
import {
  ESIGN_RULES,
  ESIGN_STORE,
  EsignEngineError,
  type EsignRules,
  type EsignStore,
  LINK_TOKENS,
  type LinkTokens,
  PDF_ENGINE,
  type PdfEngine,
} from '../engine/engine.types.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from './esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRecipientRecord,
  type EsignRepository,
  type EsignRequestParts,
  type EsignRequestRecord,
} from './esign.repository.js';
import { EsignPrepareService } from './prepare.service.js';
import { type EsignActor, EsignRequestsService, esignRefusal } from './requests.service.js';

const DAY_MS = 86_400_000;
const entity = (id: string) => ({ type: 'esign_request', id });
/** An error's class name for the log and the outbox (never its message, which may quote values). */
const errorName = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
};

/**
 * POST /esign/requests/{id}/send (R13 step 7): a DRAFT the caller may change (an approver gets
 * 404) whose readiness check passes, else 409 NOT_READY with the problems in `details` (a DRAFT
 * waiting only on its approvers is NOT_READY too: it goes through submit-for-approval). Sending
 * composes and stores the packet and keeps its SHA-256, starts the expiry, moves the first turn's
 * signers to SENT with a one-time link token each (only the hash is stored), records the SENT
 * event, queues the invitations in the same write, then emails them. lastActivityAt is the
 * optimistic lock: a second click finds it changed (409 INVALID_STATE) and sends nothing.
 */
@Injectable()
export class EsignSendService {
  private readonly logger = new Logger(EsignSendService.name);

  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(EsignPrepareService) private readonly prepare: Pick<EsignPrepareService, 'check'>,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(ESIGN_RULES) private readonly rules: Pick<EsignRules, 'currentTurn'>,
    @Inject(PDF_ENGINE) private readonly pdf: Pick<PdfEngine, 'compose'>,
    @Inject(ESIGN_STORE) private readonly store: Pick<EsignStore, 'keyFor' | 'read' | 'put'>,
    @Inject(LINK_TOKENS) private readonly tokens: Pick<LinkTokens, 'issue'>,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
    @Inject(ENV) private readonly env: Pick<Env, 'PORTAL_BASE_URL'>,
  ) {}

  async send(businessId: string, actor: EsignActor, id: string): Promise<EsignRequestDetail> {
    const record = await this.requests.draft(businessId, actor, id);
    const parts = await this.repo.parts(businessId, id);
    const readiness = await this.prepare.check(businessId, actor, record, parts);
    if (!readiness.ready) {
      throw new ConflictException({
        code: 'NOT_READY',
        message: ESIGN_ERRORS.NOT_READY,
        details: readiness.problems,
      });
    }
    const originalSha256 = await this.storePacket(businessId, id, parts);
    const [firm, caller, sender] = await Promise.all([
      this.directory.firm(businessId),
      this.directory.member(businessId, actor.userId),
      this.directory.member(businessId, record.senderUserId),
    ]);
    const rule = parts.recipients.map((r) => ({ ...r, hasAccessCode: r.accessCodeHash !== null }));
    const turnIds = this.rules.currentTurn(record.routing, rule);
    const { turn, links, mailed } = this.startTurn(firm.slug, parts.recipients, turnIds);
    const now = new Date();
    const sent = await this.repo.sendDraft(
      businessId,
      id,
      {
        sentAt: now,
        expiresAt: new Date(now.getTime() + record.expiryDays * DAY_MS),
        originalSha256,
        turn,
        emails: mailed.map((r) => ({ recipientId: r.id, template: 'esign.request' as const })),
        event: {
          id: randomUUID(),
          type: 'SENT',
          createdAt: now,
          actorKind: 'STAFF',
          actorName: caller?.name ?? '',
          recipient: null,
          reason: null,
          authMethod: null,
        },
      },
      record.lastActivityAt,
    );
    if (!sent) throw esignRefusal('INVALID_STATE');
    const { emailIds } = sent;
    if (sent.defaultConsentId) {
      // The firm had no consent text: its first send published the default one (version 1).
      await this.audit.log(
        'esign.consent_published',
        { type: 'esign_consent_version', id: sent.defaultConsentId },
        { version: 1, source: 'DEFAULT', requestId: id },
      );
    }
    await this.audit.log('esign.request_sent', entity(id), {
      clientId: record.clientId,
      recipientIds: turn.map((t) => t.recipientId),
      emailIds,
    });
    for (const [i, r] of mailed.entries()) {
      const emailId = emailIds[i];
      if (emailId) await this.invite(businessId, emailId, r, links.get(r.id)!, record, sender);
    }
    return this.requests.answer(businessId, sent.request);
  }

  /** A turn: EMAIL gets a one-time token (`turn` has its hash; `links`, memory only, the token). */
  startTurn(slug: string, all: EsignRecipientRecord[], ids: string[]) {
    const portal = `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${slug}`;
    const links = new Map<string, string>();
    const recipients = all.filter((r) => ids.includes(r.id));
    const turn = recipients.map((r) => {
      if (r.delivery === 'IN_PERSON') return { recipientId: r.id, tokenHash: null };
      if (r.delivery === 'PORTAL') {
        links.set(r.id, `${portal}/signatures`);
        return { recipientId: r.id, tokenHash: null };
      }
      const { token, hash } = this.tokens.issue();
      links.set(r.id, `${portal}/sign#t=${token}`);
      return { recipientId: r.id, tokenHash: hash };
    });
    return { turn, links, mailed: recipients.filter((r) => links.has(r.id) && r.email) };
  }

  /** Composes the packet, stores it under its own hash (a lost race never overwrites it). */
  private async storePacket(businessId: string, id: string, parts: EsignRequestParts) {
    const files = await Promise.all(
      parts.documents.map(async (d) => {
        const bytes = await this.store.read(businessId, d.s3Key);
        if (!bytes) throw new Error(`esign document ${d.id} is missing from the store`);
        return { documentId: d.id, contentType: d.contentType, bytes };
      }),
    );
    let packet: Uint8Array;
    try {
      packet = await this.pdf.compose(files, parts.pagePlan);
    } catch (error) {
      if (error instanceof EsignEngineError) throw esignRefusal(error.code);
      throw error;
    }
    const sha256 = createHash('sha256').update(packet).digest('hex');
    const key = this.store.keyFor(businessId, id, `packet-${sha256}.pdf`);
    await this.store.put(businessId, key, packet, 'application/pdf');
    return sha256;
  }

  /**
   * One invitation. A failure leaves the request sent and the email FAILED in the outbox; the log
   * gets the email's id and the error's class name only (never the address, link or token).
   */
  async invite(
    businessId: string,
    emailId: string,
    r: EsignRecipientRecord,
    link: string,
    record: EsignRequestRecord,
    sender: { name: string } | null,
  ): Promise<void> {
    let outcome: { sent: true } | { sent: false; error: string } = { sent: true };
    try {
      await this.notify.send({
        template: 'esign.request',
        to: r.email!,
        businessId,
        data: {
          name: r.name,
          title: record.title,
          link,
          senderName: sender?.name ?? '',
          message: record.emailMessage,
        },
      });
    } catch (error) {
      outcome = { sent: false, error: errorName(error) };
      this.logger.warn(`esign.request email ${emailId} not sent (${outcome.error})`);
    }
    try {
      await this.repo.emailOutcome(businessId, emailId, outcome);
    } catch (error) {
      this.logger.warn(`esign email ${emailId}: outcome not recorded (${errorName(error)})`);
    }
  }
}
