import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ESIGN_COPY_LINK_DAYS } from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { NOTIFY_SERVICE, type NotifyService } from '../../notify/notify.types.js';
import { safeTimeZone } from '../engine/certificate.js';
import * as engine from '../engine/engine.types.js';
import type { EsignStore, LinkTokens, PdfEngine } from '../engine/engine.types.js';
import type { SignaturePageSigner, Stamp } from '../engine/engine.types.js';
import { sha256Hex } from '../engine/pdf-engine.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { ESIGN_REPOSITORY, type EsignRepository } from '../requests/esign.repository.js';
import type { EsignEventRecord, EsignRecipientRecord } from '../requests/esign.repository.js';
import type { EsignRequestParts, EsignRequestRecord } from '../requests/esign.repository.js';
import { COMPLETION_REPOSITORY, type CompletionInputs } from './completion.repository.js';
import type { EsignCompletionRepository } from './completion.repository.js';

const DAY_MS = 86_400_000;
/** A failed completion waits this long before the job tries it again. */
export const COMPLETION_RETRY_MS = 5 * 60_000;
export type CompletionOutcome = 'COMPLETED' | 'ALREADY' | 'NOT_DUE' | 'FAILED';
/** An error's class name only: never its message, which may quote a value. */
const errorName = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
};
/** Runs a best-effort write; a failure (even a synchronous throw) is ignored. */
const quietly = (work: () => Promise<unknown>) =>
  Promise.resolve()
    .then(work)
    .catch(() => undefined);
const failure = (name: string) => Object.assign(new Error(name), { name });
const pdfName = (title: string, what: string) =>
  `${title.replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').trim() || 'Signed document'} - ${what}.pdf`;
type Notice = { r: EsignRecipientRecord; link: { copyLink: string } | { portalLink: string } };

/**
 * Completion and filing (R13 step 8): once every signer signed, the packet gets each signer's
 * values, signatures, initials and dates stamped and is flattened; the certificate and audit
 * trail are built from the events; both are stored under the request's prefix, filed in the
 * client's vault, the request becomes COMPLETED and everyone gets esign.completed. Safe to run
 * again: files are stored under their own hash and only the first `complete` write lands. A
 * failure leaves the request due (5 minutes later) and logs its id and the error's name only.
 */
@Injectable()
export class EsignCompletionService {
  private readonly logger = new Logger(EsignCompletionService.name);

  constructor(
    @Inject(COMPLETION_REPOSITORY) private readonly repo: EsignCompletionRepository,
    @Inject(ESIGN_REPOSITORY)
    private readonly requests: Pick<
      EsignRepository,
      'findRequest' | 'parts' | 'events' | 'emailOutcome'
    >,
    @Inject(ESIGN_DIRECTORY) private readonly directory: Pick<EsignDirectory, 'firm'>,
    @Inject(engine.PDF_ENGINE) private readonly pdf: Pick<PdfEngine, 'finalize' | 'certificate'>,
    @Inject(engine.ESIGN_STORE) private readonly store: Pick<EsignStore, 'keyFor' | 'read' | 'put'>,
    @Inject(engine.LINK_TOKENS) private readonly tokens: Pick<LinkTokens, 'issue'>,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
    @Inject(ENV) private readonly env: Pick<Env, 'PORTAL_BASE_URL'>,
  ) {}

  /** Completes the request if it is due; never throws. */
  async complete(businessId: string, requestId: string): Promise<CompletionOutcome> {
    try {
      return await this.run(businessId, requestId);
    } catch (error) {
      this.logger.warn(`esign completion ${requestId} failed (${errorName(error)})`);
      const retryAt = new Date(Date.now() + COMPLETION_RETRY_MS);
      await quietly(() => this.repo.retryLater(businessId, requestId, retryAt));
      return 'FAILED';
    }
  }

  private async run(businessId: string, id: string): Promise<CompletionOutcome> {
    const q = await this.requests.findRequest(businessId, id);
    if (q?.status === 'COMPLETED') return 'ALREADY';
    if (q?.status !== 'PARTIALLY_SIGNED' || !q.originalSha256) return 'NOT_DUE';
    // Readiness requires both before send; filing needs them (the vault's client and service).
    if (!q.clientId || !q.engagementId) throw failure('NoClientOrEngagement');
    const parts = await this.requests.parts(businessId, id);
    const signers = parts.recipients.filter((r) => r.kind === 'SIGNER');
    if (signers.length === 0 || signers.some((r) => r.status !== 'SIGNED')) return 'NOT_DUE';
    const [firm, inputs, events] = await Promise.all([
      this.directory.firm(businessId),
      this.repo.inputs(businessId, id),
      this.requests.events(businessId, id),
    ]);
    const timeZone = safeTimeZone(firm.timeZone);
    const packet = await this.store.read(
      businessId,
      this.store.keyFor(businessId, id, `packet-${q.originalSha256}.pdf`),
    );
    if (!packet) throw failure('PacketMissing');
    const signed = await this.pdf.finalize(packet, {
      ...this.stamps(parts, inputs, timeZone),
      timeZone,
    });
    const finalSha256 = sha256Hex(signed);
    const completedAt = new Date();
    const event: EsignEventRecord = {
      ...{ id: randomUUID(), type: 'COMPLETED', createdAt: completedAt, actorKind: 'SYSTEM' },
      ...{ actorName: 'Firmivra', recipient: null, reason: null, authMethod: null },
    };
    const consent = new Map(inputs.consentVersions.map((c) => [c.recipientId, c.version]));
    const certificate = await this.pdf.certificate({
      request: { id, title: q.title, firmName: firm.name, sentAt: q.sentAt!, completedAt },
      signers: signers.map((r) => ({
        ...{ name: r.name, email: r.email, role: r.roleLabel ?? r.role },
        ...{ authMethod: r.authMethod, consentVersion: consent.get(r.id) ?? null },
        ...{ viewedAt: r.viewedAt, signedAt: r.signedAt, ip: null, userAgent: null },
      })),
      events: [...events, event].map((e) => ({
        ...{ at: e.createdAt, type: e.type, actor: e.actorName, authMethod: e.authMethod },
      })),
      originalSha256: q.originalSha256,
      finalSha256,
      timeZone,
    });
    const final = await this.put(businessId, q, 'final', signed);
    const cert = await this.put(businessId, q, 'certificate', certificate);
    const notices = this.notices(firm.slug, parts.recipients);
    const expiresAt = new Date(completedAt.getTime() + ESIGN_COPY_LINK_DAYS * DAY_MS);
    const result = await this.repo.complete(businessId, id, {
      completedAt,
      final,
      certificate: cert,
      copyLinks: notices.flatMap((n) =>
        n.hash ? [{ recipientId: n.r.id, tokenHash: n.hash, expiresAt }] : [],
      ),
      emails: notices.map((n) => ({ recipientId: n.r.id, template: 'esign.completed' as const })),
      event,
    });
    if (!result) return 'ALREADY';
    const ids = { clientId: q.clientId, engagementId: q.engagementId, ...result };
    const entity = { type: 'esign_request', id };
    await this.audit.log('esign.request_completed', entity, ids, { businessId });
    for (const [i, n] of notices.entries()) {
      if (result.emailIds[i]) await this.email(businessId, result.emailIds[i], q, n);
    }
    return 'COMPLETED';
  }

  /**
   * The packet as it stands for a signer (GET .../sign/packet): the sender's own values and the
   * marks and values of everyone who already signed, stamped by the engine; the packet as sent
   * while there are none. Built on each read, never stored.
   */
  async stampedPacket(businessId: string, requestId: string, packet: Uint8Array) {
    const [parts, inputs, firm] = await Promise.all([
      this.requests.parts(businessId, requestId),
      this.repo.inputs(businessId, requestId),
      this.directory.firm(businessId),
    ]);
    const timeZone = safeTimeZone(firm.timeZone);
    const { stamps } = this.stamps(parts, inputs, timeZone, true);
    if (stamps.length === 0) return packet;
    return this.pdf.finalize(packet, { stamps, signaturePages: [], timeZone });
  }

  /**
   * Every signer's marks and values, and the sender's own values, as stamps. `signedOnly`: only
   * the recipients who signed already, and no signature pages.
   */
  private stamps(
    parts: EsignRequestParts,
    inputs: CompletionInputs,
    timeZone: string,
    signedOnly = false,
  ) {
    const values = new Map(inputs.values.map((v) => [v.fieldId, v.value]));
    const marks = new Map(inputs.adoptions.map((a) => [a.recipientId, a.adoption]));
    const people = new Map(parts.recipients.map((r) => [r.id, r]));
    const date = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'long' });
    const stamps: Stamp[] = [];
    for (const f of parts.fields) {
      const box = { pageIndex: f.pageIndex, x: f.x, y: f.y, w: f.w, h: f.h };
      const who = f.recipientId ? people.get(f.recipientId) : undefined;
      if (signedOnly && f.recipientId && who?.status !== 'SIGNED') continue;
      const adopted = who && marks.get(who.id);
      const mark = { SIGNATURE: adopted?.signature, INITIALS: adopted?.initials }[f.type as string];
      const value = f.recipientId ? values.get(f.id) : (f.value ?? undefined);
      if (mark?.png) stamps.push({ ...box, kind: 'IMAGE', png: mark.png });
      else if (mark?.text) stamps.push({ ...box, kind: 'TEXT', text: mark.text });
      else if (f.type === 'DATE_SIGNED' && who?.signedAt) {
        stamps.push({ ...box, kind: 'TEXT', text: date.format(who.signedAt) });
      } else if (f.type === 'CHECKBOX' || f.type === 'RADIO') {
        stamps.push({ ...box, kind: 'CHECK', checked: value === 'true' });
      } else if (value && f.type !== 'ATTACHMENT')
        stamps.push({ ...box, kind: 'TEXT', text: value });
    }
    if (signedOnly || parts.fields.length > 0) return { stamps, signaturePages: [] };
    // No fields placed: a signature page per signer, in routing order.
    const signaturePages = parts.recipients
      .filter((r) => r.kind === 'SIGNER')
      .sort((x, y) => x.routingOrder - y.routingOrder)
      .map((r): SignaturePageSigner => {
        const mark = marks.get(r.id)?.signature;
        if (!r.signedAt) throw failure('SignaturePageNeedsSignature');
        const at = { name: r.name, signedAt: r.signedAt };
        if (mark?.png) return { ...at, signaturePng: mark.png };
        if (mark?.text) return { ...at, typed: mark.text };
        throw failure('SignaturePageNeedsSignature');
      });
    return { stamps, signaturePages };
  }

  /** Stores a file under tenant/<firm>/esign/<request>/<folder>/<sha256>.pdf (never overwritten). */
  private async put(b: string, q: EsignRequestRecord, folder: string, bytes: Uint8Array) {
    const sha256 = sha256Hex(bytes);
    const key = this.store.keyFor(b, q.id, `${folder}/${sha256}.pdf`);
    await this.store.put(b, key, bytes, 'application/pdf');
    const fileName = pdfName(q.title, folder === 'final' ? 'signed' : folder);
    return { key, fileName, sizeBytes: bytes.byteLength, sha256 };
  }

  /**
   * Who gets esign.completed: every signer and CC with an email. A client's portal login is sent
   * to the Signature center; anyone else gets a copy link (a fresh token, only its hash stored).
   */
  private notices(
    slug: string,
    recipients: EsignRecipientRecord[],
  ): (Notice & { hash: string | null })[] {
    const portal = `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${slug}`;
    return recipients
      .filter((r) => (r.kind === 'SIGNER' || r.kind === 'CC') && r.email)
      .map((r) => {
        if (r.link.type === 'CLIENT_LOGIN' || r.delivery === 'PORTAL') {
          return { r, hash: null, link: { portalLink: `${portal}/signatures` } };
        }
        const { token, hash } = this.tokens.issue();
        return { r, hash, link: { copyLink: `${portal}/sign#t=${token}` } };
      });
  }

  /** One email; a failure is recorded on the outbox row (FAILED, the error's name) and logged by id. */
  private async email(businessId: string, emailId: string, q: EsignRequestRecord, n: Notice) {
    let outcome: { sent: true } | { sent: false; error: string } = { sent: true };
    try {
      const data = { name: n.r.name, title: q.title, ...n.link };
      await this.notify.send({ template: 'esign.completed', to: n.r.email!, businessId, data });
    } catch (error) {
      outcome = { sent: false, error: errorName(error) };
      this.logger.warn(`esign.completed email ${emailId} not sent (${outcome.error})`);
    }
    await quietly(() => this.requests.emailOutcome(businessId, emailId, outcome));
  }
}
