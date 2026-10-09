import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ESIGN_CODE_MINUTES,
  ESIGN_CODE_TRIES,
  ESIGN_ERRORS,
  ESIGN_OPEN_STATUSES,
  type EsignAuthMethod,
  type EsignEventType,
  type SignerState,
  type SignerStep,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { PortalInfoService } from '../../client-auth/portal-info.controller.js';
import { BUSINESS_MODULES, type BusinessModules } from '../../common/modules/requires-module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../../notify/notify.types.js';
import { CODE_HASHER, LINK_TOKENS, SIGNER_COOKIE } from '../engine/engine.types.js';
import type {
  CodeHasher,
  EsignCodeKind,
  LinkTokens,
  SignerCookie,
  SignerSession,
} from '../engine/engine.types.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { esignRefusal } from '../requests/requests.service.js';
import { SIGNER_REPOSITORY } from './signer.repository.js';
import type { EsignSignerRepository, SignerRecord } from './signer.repository.js';

/** The signer cookie lives an hour from the last step that moved the signer on. */
export const SIGNER_COOKIE_SECONDS = 60 * 60;
const MINUTE_MS = 60_000;
const OPEN: readonly string[] = ESIGN_OPEN_STATUSES;

export const linkInvalid = () =>
  new NotFoundException({ code: 'LINK_INVALID', message: ESIGN_ERRORS.LINK_INVALID });
const refuse = (code: keyof typeof ESIGN_ERRORS, status = HttpStatus.TOO_MANY_REQUESTS) =>
  new HttpException({ code, message: ESIGN_ERRORS[code] }, status);

export const maskEmail = (email: string) => `${email[0]}***${email.slice(email.indexOf('@'))}`;

/** Where the signer is: from the request, the recipient and what the cookie says they passed. */
export function signerStep(s: SignerSession, r: SignerRecord, now: Date): SignerStep {
  const { request: q, recipient: me } = r;
  if (me.status === 'DECLINED') return 'DECLINED';
  if (me.status === 'SIGNED') return 'DONE';
  if (!OPEN.includes(q.status) || (q.expiresAt !== null && q.expiresAt <= now)) return 'CLOSED';
  if (me.status === 'WAITING') return 'WAITING';
  if (!s.emailCodePassed) return 'VERIFY_EMAIL';
  if (!s.accessCodePassed) return 'VERIFY_ACCESS_CODE';
  return s.consentVersionId === null ? 'CONSENT' : 'SIGN';
}

/** A signer call: the firm from the slug, the recipient from the cookie, never from the body. */
export interface SignerCall {
  firm: { id: string; slug: string; name: string };
  session: SignerSession;
  signer: SignerRecord;
  step: SignerStep;
}

/**
 * Signer routes, slice 1 (docs/AUTH-DESIGN.md "Firm Sign signers"): any bad link or cookie, an
 * inactive firm or Firm Sign off is the one 404 LINK_INVALID. Codes and tokens are never logged.
 */
@Injectable()
export class EsignSignerService {
  constructor(
    @Inject(PortalInfoService) private readonly firms: Pick<PortalInfoService, 'activeFirm'>,
    @Inject(BUSINESS_MODULES) private readonly modules: BusinessModules,
    @Inject(SIGNER_REPOSITORY) private readonly repo: EsignSignerRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: Pick<EsignDirectory, 'member'>,
    @Inject(LINK_TOKENS) private readonly tokens: Pick<LinkTokens, 'hash'>,
    @Inject(CODE_HASHER) private readonly codes: CodeHasher,
    @Inject(SIGNER_COOKIE) private readonly cookie: SignerCookie,
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
    const link = await this.repo.findLink(firm.id, this.tokens.hash(token));
    // The completed-copy link (purpose COPY) comes with slice 2.
    if (link?.purpose !== 'SIGN') throw linkInvalid();
    const signer = await this.repo.signer(firm.id, link.requestId, link.recipientId);
    if (!signer || signer.tokenVersion !== link.tokenVersion) throw linkInvalid();
    const { requestId, recipientId, tokenVersion, purpose } = link;
    const method = signer.recipient.authMethod;
    const session: SignerSession = {
      ...{ slug: firm.slug, businessId: firm.id, requestId, recipientId, tokenVersion, purpose },
      emailCodePassed: method !== 'EMAIL_CODE',
      accessCodePassed: method !== 'ACCESS_CODE',
      consentVersionId: signer.consentVersionId,
    };
    const call: SignerCall = {
      firm,
      session,
      signer,
      step: signerStep(session, signer, new Date()),
    };
    // Used (signed or declined), closed or expired: the same answer as an unknown link.
    if (['DONE', 'DECLINED', 'CLOSED'].includes(call.step)) throw linkInvalid();
    if (method === 'LINK') await this.event(call, 'AUTH_PASSED', 'LINK');
    await this.log(call, 'esign.signer_link_opened');
    return this.moveOn(call, res);
  }

  /** The signer of this cookie under this slug, else LINK_INVALID; WRONG_STEP off `steps`. */
  async call(slug: string, req: Request, ...steps: SignerStep[]): Promise<SignerCall> {
    const firm = await this.firm(slug);
    const raw = (req.cookies as Record<string, unknown>)[this.cookie.name(firm.slug)];
    const session = typeof raw === 'string' ? await this.cookie.open(firm.slug, raw) : undefined;
    if (!session || session.businessId !== firm.id) throw linkInvalid();
    const signer = await this.repo.signer(firm.id, session.requestId, session.recipientId);
    if (!signer || signer.tokenVersion !== session.tokenVersion) throw linkInvalid();
    const step = signerStep(session, signer, new Date());
    if (steps.length > 0 && !steps.includes(step)) throw esignRefusal('WRONG_STEP');
    return { firm, session, signer, step };
  }

  async state(c: SignerCall): Promise<SignerState> {
    const { request: q, recipient: me } = c.signer;
    const sender = await this.directory.member(c.firm.id, q.senderUserId);
    const over = ['DONE', 'DECLINED', 'CLOSED'].includes(c.step);
    return {
      step: c.step,
      title: q.title,
      senderName: sender?.name ?? '',
      firmName: c.firm.name,
      signerName: me.name,
      codeSentTo: c.step === 'VERIFY_EMAIL' && me.email ? maskEmail(me.email) : null,
      // CLOSED while still open: it ran out before the expiry job marked it.
      requestStatus: c.step !== 'CLOSED' ? null : OPEN.includes(q.status) ? 'EXPIRED' : q.status,
      expiresAt: over ? null : (q.expiresAt?.toISOString() ?? null),
    };
  }

  /** POST code/send: a new 6-digit code by email; only its HMAC is kept. */
  async sendCode(c: SignerCall) {
    const { recipient: me, request: q } = c.signer;
    if (!me.email) throw linkInvalid();
    const code = this.codes.generate();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ESIGN_CODE_MINUTES * MINUTE_MS);
    const hash = this.codes.hash(me.id, 'EMAIL', code);
    const issued = await this.repo.issueCode(c.firm.id, me.id, { hash, sentAt: now, expiresAt });
    if (issued === 'TOO_SOON') throw refuse('CODE_TOO_SOON');
    const data = { code, title: q.title };
    await this.notify.send({ template: 'esign.code', to: me.email, businessId: c.firm.id, data });
    await this.log(c, 'esign.signer_code_sent');
    const resendAfter = new Date(now.getTime() + MINUTE_MS).toISOString();
    return { sentTo: maskEmail(me.email), expiresAt: expiresAt.toISOString(), resendAfter };
  }

  /** POST code/verify and access-code: one counted try; 5 wrong tries lock the code. */
  async verify(c: SignerCall, kind: EsignCodeKind, code: string, res: Response) {
    const me = c.signer.recipient;
    const method = kind === 'EMAIL' ? 'EMAIL_CODE' : 'ACCESS_CODE';
    const taken = await this.repo.takeCodeTry(c.firm.id, me.id, kind);
    const locked = (tries: number) => tries >= ESIGN_CODE_TRIES;
    if (taken && locked(taken.triesBefore)) throw refuse('CODE_LOCKED');
    const hash = kind === 'EMAIL' ? taken?.hash : me.accessCodeHash;
    const fresh = !taken?.expiresAt || taken.expiresAt > new Date();
    if (!taken || !hash || !fresh || !this.codes.verify(me.id, kind, code, hash)) {
      await this.event(c, 'AUTH_FAILED', method);
      await this.log(c, 'esign.signer_auth_failed', { authMethod: method });
      const last = taken && locked(taken.triesBefore + 1);
      throw last ? refuse('CODE_LOCKED') : refuse('CODE_INVALID', HttpStatus.BAD_REQUEST);
    }
    await this.repo.clearCode(c.firm.id, me.id, kind);
    await this.event(c, 'AUTH_PASSED', method);
    await this.log(c, 'esign.signer_auth_passed', { authMethod: method });
    if (kind === 'EMAIL') c.session.emailCodePassed = true;
    else c.session.accessCodePassed = true;
    return this.moveOn(c, res);
  }

  /** GET consent: the firm's newest published consent text. */
  async consent(c: SignerCall) {
    const current = await this.repo.currentConsent(c.firm.id);
    if (!current) throw linkInvalid();
    return { versionId: current.id, version: current.version, bodyMarkdown: current.bodyMarkdown };
  }

  /** POST consent: pins the version on the recipient. */
  async acceptConsent(c: SignerCall, versionId: string, res: Response): Promise<SignerState> {
    const { request: q, recipient: me } = c.signer;
    const event = this.eventRecord(c, 'CONSENTED', me.authMethod);
    const pinned = await this.repo.acceptConsent(c.firm.id, q.id, me.id, versionId, event);
    if (!pinned) throw esignRefusal('CONSENT_OUTDATED');
    await this.log(c, 'esign.signer_consented', { consentVersionId: versionId });
    c.session.consentVersionId = versionId;
    return this.moveOn(c, res);
  }

  /** Seals the session again (another hour) and answers the new state. */
  private async moveOn(c: SignerCall, res: Response): Promise<SignerState> {
    const sealed = await this.cookie.seal(c.session, SIGNER_COOKIE_SECONDS);
    const options = this.cookie.options(c.firm.slug, SIGNER_COOKIE_SECONDS);
    res.cookie(this.cookie.name(c.firm.slug), sealed, options);
    return this.state({ ...c, step: signerStep(c.session, c.signer, new Date()) });
  }

  private eventRecord(c: SignerCall, type: EsignEventType, authMethod: EsignAuthMethod) {
    const { id, name } = c.signer.recipient;
    const at = { id: randomUUID(), type, createdAt: new Date(), reason: null, authMethod };
    return { ...at, actorKind: 'SIGNER' as const, actorName: name, recipient: { id, name } };
  }

  private event(c: SignerCall, ...args: [EsignEventType, EsignAuthMethod]) {
    return this.repo.addEvent(c.firm.id, c.signer.request.id, this.eventRecord(c, ...args));
  }

  /** Ids only: never a code, a token, a name or an address. */
  private log(c: SignerCall, action: string, extra: Record<string, string> = {}) {
    const entity = { type: 'esign_recipient', id: c.signer.recipient.id };
    const metadata = { requestId: c.signer.request.id, ...extra };
    return this.audit.log(action, entity, metadata, { businessId: c.firm.id });
  }
}
