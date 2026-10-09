import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ESIGN_CODE_MINUTES,
  ESIGN_CODE_TRIES,
  ESIGN_ERRORS,
  ESIGN_OPEN_STATUSES,
  type EsignAuthMethod,
  type EsignErrorCode,
  type EsignEventType,
  type SignerCodeSent,
  type SignerConsent,
  type SignerState,
  type SignerStep,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { PortalInfoService } from '../../client-auth/portal-info.controller.js';
import { BUSINESS_MODULES, type BusinessModules } from '../../common/modules/requires-module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../../notify/notify.types.js';
import {
  CODE_HASHER,
  type CodeHasher,
  type EsignCodeKind,
  ESIGN_STORE,
  type EsignStore,
  LINK_TOKENS,
  type LinkTokens,
  SIGNER_COOKIE,
  type SignerCookie,
  type SignerSession,
} from '../engine/engine.types.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { ESIGN_REPOSITORY, type EsignRepository } from '../requests/esign.repository.js';
import { esignRefusal } from '../requests/requests.service.js';
import {
  type EsignSignerRepository,
  SIGNER_REPOSITORY,
  type SignerRecord,
} from './signer.repository.js';

/** The signer cookie lives an hour from the last step that moved the signer on. */
export const SIGNER_COOKIE_SECONDS = 60 * 60;
const MINUTE_MS = 60_000;

export const linkInvalid = () =>
  new NotFoundException({ code: 'LINK_INVALID', message: ESIGN_ERRORS.LINK_INVALID });
const tooMany = (code: EsignErrorCode) =>
  new HttpException({ code, message: ESIGN_ERRORS[code] }, HttpStatus.TOO_MANY_REQUESTS);
const refuse = (code: EsignErrorCode, status = HttpStatus.BAD_REQUEST) =>
  new HttpException({ code, message: ESIGN_ERRORS[code] }, status);

/** j***@example.test. */
export const maskEmail = (email: string) =>
  `${email.slice(0, 1)}***${email.slice(email.indexOf('@'))}`;

/** Where the signer is: from the request, the recipient and what the cookie says they passed. */
export function signerStep(s: SignerSession, r: SignerRecord, now: Date): SignerStep {
  const { request: q, recipient: me } = r;
  if (s.purpose === 'COPY') {
    if (q.status !== 'COMPLETED') return 'CLOSED';
    return s.emailCodePassed ? 'COPY' : 'VERIFY_EMAIL';
  }
  if (me.status === 'DECLINED') return 'DECLINED';
  if (me.status === 'SIGNED') return 'DONE';
  const open = (ESIGN_OPEN_STATUSES as readonly string[]).includes(q.status);
  if (!open || (q.expiresAt !== null && q.expiresAt <= now)) return 'CLOSED';
  if (me.status === 'WAITING') return 'WAITING';
  if (!s.emailCodePassed) return 'VERIFY_EMAIL';
  if (!s.accessCodePassed) return 'VERIFY_ACCESS_CODE';
  if (s.consentVersionId === null) return 'CONSENT';
  return 'SIGN';
}

/** A signer call: the firm from the slug, the recipient from the cookie, never from the body. */
export interface SignerCall {
  firm: { id: string; slug: string; name: string };
  session: SignerSession;
  signer: SignerRecord;
  step: SignerStep;
}

/**
 * The public signer routes, slice 1 (portal/{slug}/sign, docs/AUTH-DESIGN.md "Firm Sign
 * signers"): open the link, state, the email code, the access code, consent, the packet and
 * decline. Any unknown, expired, used or other firm's link, a missing or stale cookie, an
 * inactive firm or Firm Sign off answers the one 404 LINK_INVALID. Codes and tokens are never
 * logged, stored in the clear or returned; the audit holds ids only.
 */
@Injectable()
export class EsignSignerService {
  constructor(
    @Inject(PortalInfoService) private readonly firms: Pick<PortalInfoService, 'activeFirm'>,
    @Inject(BUSINESS_MODULES) private readonly modules: BusinessModules,
    @Inject(SIGNER_REPOSITORY) private readonly repo: EsignSignerRepository,
    @Inject(ESIGN_REPOSITORY) private readonly requests: Pick<EsignRepository, 'parts'>,
    @Inject(ESIGN_DIRECTORY) private readonly directory: Pick<EsignDirectory, 'member'>,
    @Inject(LINK_TOKENS) private readonly tokens: Pick<LinkTokens, 'hash'>,
    @Inject(CODE_HASHER) private readonly codes: CodeHasher,
    @Inject(SIGNER_COOKIE) private readonly cookie: SignerCookie,
    @Inject(ESIGN_STORE) private readonly store: Pick<EsignStore, 'keyFor' | 'read'>,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  /** An ACTIVE firm with Firm Sign on, else LINK_INVALID. */
  private async firm(slug: string): Promise<SignerCall['firm']> {
    const firm = await this.firms.activeFirm(slug).catch(() => null);
    if (!firm || !(await this.modules.isEnabled(firm.id, 'esign'))) throw linkInvalid();
    return { id: firm.id, slug: firm.slug, name: firm.name };
  }

  /** POST session: the link token for a fresh cookie, at the first step this recipient needs. */
  async open(slug: string, token: string, res: Response): Promise<SignerState> {
    const firm = await this.firm(slug);
    const now = new Date();
    const link = await this.repo.findLink(firm.id, this.tokens.hash(token));
    if (!link || (link.expiresAt !== null && link.expiresAt <= now)) throw linkInvalid();
    const signer = await this.repo.signer(firm.id, link.requestId, link.recipientId);
    if (!signer || signer.tokenVersion !== link.tokenVersion) throw linkInvalid();
    const method = signer.recipient.authMethod;
    const copy = link.purpose === 'COPY';
    const session: SignerSession = {
      slug: firm.slug,
      businessId: firm.id,
      requestId: link.requestId,
      recipientId: link.recipientId,
      tokenVersion: link.tokenVersion,
      purpose: link.purpose,
      emailCodePassed: !copy && method !== 'EMAIL_CODE',
      accessCodePassed: copy || method !== 'ACCESS_CODE',
      consentVersionId: signer.consentVersionId,
    };
    const call: SignerCall = { firm, session, signer, step: signerStep(session, signer, now) };
    // Used (signed or declined), closed or expired: the same answer as an unknown link.
    if (['DONE', 'DECLINED', 'CLOSED'].includes(call.step)) throw linkInvalid();
    if (!copy && method === 'LINK') await this.event(call, 'AUTH_PASSED', 'LINK');
    await this.log(call, 'esign.signer_link_opened');
    return this.moveOn(call, res);
  }

  /** The signer of this cookie under this slug, else LINK_INVALID. */
  async call(slug: string, req: Request, ...steps: SignerStep[]): Promise<SignerCall> {
    const firm = await this.firm(slug);
    const raw: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
      this.cookie.name(firm.slug)
    ];
    const session = typeof raw === 'string' ? await this.cookie.open(firm.slug, raw) : undefined;
    if (!session || session.businessId !== firm.id) throw linkInvalid();
    const signer = await this.repo.signer(firm.id, session.requestId, session.recipientId);
    if (!signer || signer.tokenVersion !== session.tokenVersion) throw linkInvalid();
    const step = signerStep(session, signer, new Date());
    if (steps.length > 0 && !steps.includes(step)) throw esignRefusal('WRONG_STEP');
    return { firm, session, signer, step };
  }

  /** POST session/end: forgets the cookie. */
  async end(slug: string, res: Response): Promise<{ ok: true }> {
    const { slug: s } = await this.firm(slug);
    const { maxAge: _maxAge, ...options } = this.cookie.options(s, 0);
    res.clearCookie(this.cookie.name(s), options);
    return { ok: true };
  }

  async state(c: SignerCall): Promise<SignerState> {
    const { request: q, recipient: me } = c.signer;
    const sender = await this.directory.member(c.firm.id, q.senderUserId);
    const over = ['DONE', 'DECLINED', 'CLOSED'].includes(c.step);
    const open = (ESIGN_OPEN_STATUSES as readonly string[]).includes(q.status);
    return {
      step: c.step,
      title: q.title,
      senderName: sender?.name ?? '',
      firmName: c.firm.name,
      signerName: me.name,
      codeSentTo: c.step === 'VERIFY_EMAIL' && me.email ? maskEmail(me.email) : null,
      // CLOSED while still open: it ran out before the expiry job marked it.
      requestStatus:
        c.step === 'COPY' ? q.status : c.step === 'CLOSED' ? (open ? 'EXPIRED' : q.status) : null,
      expiresAt: over || c.step === 'COPY' ? null : (q.expiresAt?.toISOString() ?? null),
    };
  }

  /** POST code/send: a new 6-digit code by email; only its HMAC is kept. */
  async sendCode(c: SignerCall): Promise<SignerCodeSent> {
    const { recipient: me, request: q } = c.signer;
    if (!me.email) throw linkInvalid();
    const code = this.codes.generate();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ESIGN_CODE_MINUTES * MINUTE_MS);
    const hash = this.codes.hash(me.id, 'EMAIL', code);
    const issued = await this.repo.issueCode(c.firm.id, me.id, { hash, sentAt: now, expiresAt });
    if (issued === 'TOO_SOON') throw tooMany('CODE_TOO_SOON');
    await this.notify.send({
      template: 'esign.code',
      to: me.email,
      businessId: c.firm.id,
      data: { code, title: q.title },
    });
    await this.log(c, 'esign.signer_code_sent');
    return {
      sentTo: maskEmail(me.email),
      expiresAt: expiresAt.toISOString(),
      resendAfter: new Date(now.getTime() + MINUTE_MS).toISOString(),
    };
  }

  /** POST code/verify and access-code: one counted try; 5 wrong tries lock the code. */
  async verify(c: SignerCall, kind: EsignCodeKind, code: string, res: Response) {
    const me = c.signer.recipient;
    const method = kind === 'EMAIL' ? 'EMAIL_CODE' : 'ACCESS_CODE';
    const taken = await this.repo.takeCodeTry(c.firm.id, me.id, kind);
    if (taken && taken.triesBefore >= ESIGN_CODE_TRIES) throw tooMany('CODE_LOCKED');
    const hash = kind === 'EMAIL' ? taken?.hash : me.accessCodeHash;
    const fresh = !taken?.expiresAt || taken.expiresAt > new Date();
    if (!taken || !hash || !fresh || !this.codes.verify(me.id, kind, code, hash)) {
      await this.event(c, 'AUTH_FAILED', method);
      await this.log(c, 'esign.signer_auth_failed', { authMethod: method });
      const locked = taken !== null && taken.triesBefore + 1 >= ESIGN_CODE_TRIES;
      throw locked ? tooMany('CODE_LOCKED') : refuse('CODE_INVALID');
    }
    await this.repo.clearCode(c.firm.id, me.id, kind);
    await this.event(c, 'AUTH_PASSED', method);
    await this.log(c, 'esign.signer_auth_passed', { authMethod: method });
    if (kind === 'EMAIL') c.session.emailCodePassed = true;
    else c.session.accessCodePassed = true;
    return this.moveOn(c, res);
  }

  /** GET consent: the firm's newest published consent text. */
  async consent(c: SignerCall): Promise<SignerConsent> {
    const current = await this.repo.currentConsent(c.firm.id);
    if (!current) throw linkInvalid();
    return { versionId: current.id, version: current.version, bodyMarkdown: current.bodyMarkdown };
  }

  /** POST consent: pins the version on the recipient. */
  async acceptConsent(c: SignerCall, versionId: string, res: Response): Promise<SignerState> {
    const { request: q, recipient: me } = c.signer;
    const event = this.eventRecord(c, 'CONSENTED', me.authMethod);
    if (!(await this.repo.acceptConsent(c.firm.id, q.id, me.id, versionId, event))) {
      throw esignRefusal('CONSENT_OUTDATED');
    }
    await this.log(c, 'esign.signer_consented', { consentVersionId: versionId });
    c.session.consentVersionId = versionId;
    return this.moveOn(c, res);
  }

  /** POST decline: the recipient and the request are DECLINED. */
  async decline(c: SignerCall, reason: string | null): Promise<SignerState> {
    const { request: q, recipient: me } = c.signer;
    const at = new Date();
    const event = { ...this.eventRecord(c, 'DECLINED', me.authMethod), reason };
    if (!(await this.repo.decline(c.firm.id, q.id, me.id, { at, reason, event }))) {
      throw esignRefusal('REQUEST_CLOSED');
    }
    await this.log(c, 'esign.signer_declined');
    Object.assign(me, { status: 'DECLINED', declinedAt: at, declineReason: reason });
    return this.state({ ...c, step: 'DECLINED' });
  }

  /** GET packet: the packet as sent (stamping earlier signers comes with slice 2). CLEAN only. */
  async packet(c: SignerCall): Promise<Uint8Array> {
    const q = c.signer.request;
    const { documents } = await this.requests.parts(c.firm.id, q.id);
    const pending = documents.some((d) => d.scanStatus === 'PENDING');
    if (pending) throw esignRefusal('SCAN_PENDING');
    if (documents.some((d) => d.scanStatus !== 'CLEAN')) throw esignRefusal('FILE_BLOCKED');
    const key = this.store.keyFor(c.firm.id, q.id, `packet-${q.originalSha256}.pdf`);
    const bytes = q.originalSha256 ? await this.store.read(c.firm.id, key) : null;
    if (!bytes) throw new ConflictException({ code: 'INVALID_STATE', message: 'No packet' });
    await this.log(c, 'esign.signer_packet_read');
    return bytes;
  }

  /** Seals the session again (another hour) and answers the new state. */
  private async moveOn(c: SignerCall, res: Response): Promise<SignerState> {
    const sealed = await this.cookie.seal(c.session, SIGNER_COOKIE_SECONDS);
    res.cookie(
      this.cookie.name(c.firm.slug),
      sealed,
      this.cookie.options(c.firm.slug, SIGNER_COOKIE_SECONDS),
    );
    return this.state({ ...c, step: signerStep(c.session, c.signer, new Date()) });
  }

  private eventRecord(c: SignerCall, type: EsignEventType, authMethod: EsignAuthMethod) {
    const me = c.signer.recipient;
    return {
      id: randomUUID(),
      type,
      createdAt: new Date(),
      actorKind: 'SIGNER' as const,
      actorName: me.name,
      recipient: { id: me.id, name: me.name },
      reason: null,
      authMethod,
    };
  }

  private event(c: SignerCall, type: EsignEventType, authMethod: EsignAuthMethod) {
    return this.repo.addEvent(
      c.firm.id,
      c.signer.request.id,
      this.eventRecord(c, type, authMethod),
    );
  }

  /** Ids only: never a code, a token, a name or an address. */
  private log(c: SignerCall, action: string, extra: Record<string, string> = {}) {
    const entity = { type: 'esign_recipient', id: c.signer.recipient.id };
    const metadata = { requestId: c.signer.request.id, ...extra };
    return this.audit.log(action, entity, metadata, { businessId: c.firm.id });
  }
}
