import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  ESIGN_CODE_MINUTES,
  ESIGN_CODE_TRIES,
  ESIGN_ERRORS,
  ESIGN_OPEN_STATUSES,
  type EsignAuthMethod,
  type EsignEventType,
  type SignerAdoptBody,
  type SignerEnvelope,
  type SignerField,
  type SignerState,
  type SignerStep,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { EsignCompletionService } from '../completion/completion.service.js';
import { PortalInfoService } from '../../client-auth/portal-info.controller.js';
import { BUSINESS_MODULES, type BusinessModules } from '../../common/modules/requires-module.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { NOTIFY_SERVICE, type NotifyService } from '../../notify/notify.types.js';
import * as engine from '../engine/engine.types.js';
import type {
  CodeHasher,
  EsignCodeKind,
  EsignRules,
  EsignStore,
  LinkTokens,
  SignatureImageCheck,
  SignerCookie,
  SignerSession,
} from '../engine/engine.types.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { ESIGN_REPOSITORY, type EsignRepository } from '../requests/esign.repository.js';
import type { EsignRecipientRecord, EsignRequestParts } from '../requests/esign.repository.js';
import { esignRefusal, invalid } from '../requests/requests.service.js';
import { EsignSendService } from '../requests/send.service.js';
import { SIGNER_REPOSITORY } from './signer.repository.js';
import type { AdoptedMark, EsignSignerRepository, SignerRecord } from './signer.repository.js';
import type { SignerAttachment } from './signer.repository.js';

/** The signer cookie lives an hour from the last step that moved the signer on. */
export const SIGNER_COOKIE_SECONDS = 60 * 60;
const MINUTE_MS = 60_000;
const OPEN: readonly string[] = ESIGN_OPEN_STATUSES;
/** Fields the server fills or uploads: never in `finish`'s values. */
const STAMPED: readonly string[] = ['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'ATTACHMENT'];
const rule = (r: EsignRecipientRecord) => ({ ...r, hasAccessCode: r.accessCodeHash !== null });
type Value = { fieldId: string; value: string };

export const linkInvalid = () =>
  new NotFoundException({ code: 'LINK_INVALID', message: ESIGN_ERRORS.LINK_INVALID });
const refuse = (code: keyof typeof ESIGN_ERRORS, status = HttpStatus.TOO_MANY_REQUESTS) =>
  new HttpException({ code, message: ESIGN_ERRORS[code] }, status);

export const maskEmail = (email: string) => `${email[0]}***${email.slice(email.indexOf('@'))}`;

/** Where the signer is: from the request, the recipient and what the cookie says they passed. */
export function signerStep(s: SignerSession, r: SignerRecord, now: Date): SignerStep {
  const { request: q, recipient: me } = r;
  // A completed-copy session: the email code, then the files while the link lasts.
  if (s.purpose === 'COPY') {
    const open = q.status === 'COMPLETED' && r.copyExpiresAt !== null && r.copyExpiresAt > now;
    return !open ? 'CLOSED' : s.emailCodePassed ? 'COPY' : 'VERIFY_EMAIL';
  }
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
 * Signer routes (docs/AUTH-DESIGN.md "Firm Sign signers"): any bad link or cookie, an inactive
 * firm or Firm Sign off is the one 404 LINK_INVALID. Codes, tokens, field values and signatures
 * are never logged, audited or put on the timeline.
 */
@Injectable()
export class EsignSignerService {
  constructor(
    @Inject(PortalInfoService) private readonly firms: Pick<PortalInfoService, 'activeFirm'>,
    @Inject(BUSINESS_MODULES) private readonly modules: BusinessModules,
    @Inject(SIGNER_REPOSITORY) private readonly repo: EsignSignerRepository,
    @Inject(ESIGN_REPOSITORY) private readonly requests: Pick<EsignRepository, 'parts'>,
    @Inject(ESIGN_DIRECTORY) private readonly directory: Pick<EsignDirectory, 'member'>,
    @Inject(engine.LINK_TOKENS) private readonly tokens: Pick<LinkTokens, 'hash'>,
    @Inject(engine.CODE_HASHER) private readonly codes: CodeHasher,
    @Inject(engine.SIGNER_COOKIE) private readonly cookie: SignerCookie,
    @Inject(engine.ESIGN_STORE) private readonly store: Pick<EsignStore, 'keyFor' | 'read'>,
    @Inject(engine.SIGNATURE_IMAGE_CHECK) private readonly images: SignatureImageCheck,
    @Inject(engine.ESIGN_RULES)
    private readonly rules: Pick<EsignRules, 'currentTurn' | 'statusAfter'>,
    @Inject(EsignSendService)
    private readonly sender: Pick<EsignSendService, 'startTurn' | 'invite'>,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_BASE_URL'>,
    @Inject(EsignCompletionService)
    private readonly completion: Pick<EsignCompletionService, 'complete' | 'stampedPacket'>,
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
    const signer = link && (await this.read(firm.id, link));
    if (!link || !signer || signer.tokenVersion !== link.tokenVersion) throw linkInvalid();
    const { requestId, recipientId, tokenVersion, purpose } = link;
    const method = signer.recipient.authMethod;
    // A copy link always asks for the email code, never the access code or consent.
    const copy = purpose === 'COPY';
    const session: SignerSession = {
      ...{ slug: firm.slug, businessId: firm.id, requestId, recipientId, tokenVersion, purpose },
      emailCodePassed: !copy && method !== 'EMAIL_CODE',
      accessCodePassed: copy || method !== 'ACCESS_CODE',
      consentVersionId: copy ? null : signer.consentVersionId,
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
    const signer = await this.read(firm.id, session);
    if (!signer || signer.tokenVersion !== session.tokenVersion) throw linkInvalid();
    const step = signerStep(session, signer, new Date());
    if (steps.length > 0 && !steps.includes(step)) throw esignRefusal('WRONG_STEP');
    return { firm, session, signer, step };
  }

  /** A SIGN link's or session's SIGNER; a COPY one's SIGNER or CC. */
  private read(
    businessId: string,
    s: Pick<SignerSession, 'requestId' | 'recipientId' | 'purpose'>,
  ) {
    const read = s.purpose === 'COPY' ? this.repo.copyHolder : this.repo.signer;
    return read.call(this.repo, businessId, s.requestId, s.recipientId);
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
    const closed = c.step === 'CLOSED';
    const shown = closed || c.step === 'COPY';
    return {
      step: c.step,
      title: q.title,
      senderName: sender?.name ?? '',
      firmName: c.firm.name,
      signerName: me.name,
      codeSentTo: c.step === 'VERIFY_EMAIL' && me.email ? maskEmail(me.email) : null,
      // CLOSED while still open: it ran out before the expiry job marked it.
      requestStatus: !shown ? null : closed && OPEN.includes(q.status) ? 'EXPIRED' : q.status,
      expiresAt: over
        ? null
        : ((c.step === 'COPY' ? c.signer.copyExpiresAt : q.expiresAt)?.toISOString() ?? null),
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

  /** GET packet: as it stands (the sender's values, earlier signatures), CLEAN files only. */
  async packet(c: SignerCall): Promise<Uint8Array> {
    const q = c.signer.request;
    const { documents } = await this.requests.parts(c.firm.id, q.id);
    if (documents.some((d) => d.scanStatus === 'PENDING')) throw esignRefusal('SCAN_PENDING');
    if (documents.some((d) => d.scanStatus !== 'CLEAN')) throw esignRefusal('FILE_BLOCKED');
    const key = this.store.keyFor(c.firm.id, q.id, `packet-${q.originalSha256}.pdf`);
    const bytes = q.originalSha256 ? await this.store.read(c.firm.id, key) : null;
    if (!bytes) throw esignRefusal('INVALID_STATE');
    const stamped = await this.completion.stampedPacket(c.firm.id, q.id, bytes);
    await this.log(c, 'esign.signer_packet_read');
    return stamped;
  }

  /** GET envelope: their own fields and everyone's progress; the first read records VIEWED. */
  async envelope(c: SignerCall): Promise<SignerEnvelope> {
    const { request: q, recipient: me } = c.signer;
    const parts = await this.requests.parts(c.firm.id, q.id);
    if (me.viewedAt === null) {
      const at = new Date();
      const all = parts.recipients.map((r) =>
        r.id === me.id ? { ...r, status: 'VIEWED' as const, viewedAt: at } : r,
      );
      const status = this.rules.statusAfter(all.map(rule), q.status);
      const event = this.eventRecord(c, 'VIEWED', me.authMethod);
      if (await this.repo.markViewed(c.firm.id, q.id, me.id, { at, status, event })) {
        await this.log(c, 'esign.signer_viewed');
      }
    }
    const [sender, attached] = await Promise.all([
      this.directory.member(c.firm.id, q.senderUserId),
      this.repo.attachments(c.firm.id, q.id, me.id),
    ]);
    const pageSizes = parts.pagePlan.map((p) => {
      const size = parts.documents.find((d) => d.id === p.documentId)?.pageSizes[p.page];
      const { width = 0, height = 0 } = size ?? {};
      return p.rotation % 180 === 0 ? { width, height } : { width: height, height: width };
    });
    const { id: recipientId, name, kind, role, roleLabel } = me;
    return {
      title: q.title,
      message: q.emailMessage,
      senderName: sender?.name ?? '',
      firmName: c.firm.name,
      me: { recipientId, name, kind, role, roleLabel },
      packetUrl: `/api/v1/portal/${c.firm.slug}/sign/packet`,
      pageCount: Math.max(parts.pagePlan.length, 1),
      pageSizes,
      fields: this.myFields(parts, me, attached),
      autoSignaturePage: parts.fields.length === 0,
      adopted: c.signer.adopted,
      progress: parts.recipients
        .filter((r) => r.kind === 'SIGNER')
        .sort((x, y) => x.routingOrder - y.routingOrder)
        .map((r) => ({ name: r.name, role: r.role, signed: r.status === 'SIGNED' })),
      expiresAt: (q.expiresAt ?? new Date()).toISOString(),
    };
  }

  /** POST adopt: the signature (and initials); images must pass SIGNATURE_IMAGE_CHECK. */
  async adopt(c: SignerCall, body: z.output<typeof SignerAdoptBody>): Promise<SignerEnvelope> {
    const { request: q, recipient: me } = c.signer;
    const { signature: sig, initials: ini } = body;
    const mark = (m: { method: AdoptedMark['method']; imagePng?: string }, text?: string) => {
      if (m.imagePng === undefined) return { method: m.method, text: text ?? null, png: null };
      const png = new Uint8Array(Buffer.from(m.imagePng, 'base64'));
      if (!this.images.check(png).ok) throw refuse('IMAGE_INVALID', HttpStatus.BAD_REQUEST);
      return { method: m.method, text: null, png };
    };
    const adoption = {
      printedName: sig.printedName,
      signature: mark(sig, 'typedSignature' in sig ? sig.typedSignature : undefined),
      initials: ini ? mark(ini, 'text' in ini ? ini.text : undefined) : null,
    };
    if (!(await this.repo.adopt(c.firm.id, q.id, me.id, adoption))) {
      throw esignRefusal('REQUEST_CLOSED');
    }
    await this.log(c, 'esign.signer_adopted', { method: sig.method });
    c.signer.adopted = { method: sig.method, hasInitials: ini !== undefined };
    return this.envelope(c);
  }

  /**
   * POST finish: values and signature checked, then SIGNED; the turn passes on as send does; the
   * last signer marks the request for completion and completes it at once (EsignCompletionService;
   * the job retries a failure). A write that lost a race reads again (3 tries).
   */
  async finish(c: SignerCall, given: Value[]): Promise<SignerState> {
    const me = c.signer.recipient;
    let parts = await this.requests.parts(c.firm.id, c.signer.request.id);
    const attached = await this.repo.attachments(c.firm.id, c.signer.request.id, me.id);
    const values = this.checkValues(c.signer, parts, given, attached);
    let q = c.signer.request;
    for (let tries = 0; tries < 3; tries++) {
      const signedAt = new Date();
      const all = parts.recipients.map((r) =>
        r.id === me.id ? { ...r, status: 'SIGNED' as const, signedAt } : r,
      );
      let status = this.rules.statusAfter(all.map(rule), q.status);
      // COMPLETED only once the final PDF is filed (the completion slice).
      const allSigned = status === 'COMPLETED';
      if (allSigned) status = 'PARTIALLY_SIGNED';
      const turnIds = this.rules.currentTurn(q.routing, all.map(rule));
      const next = turnIds.filter((id) => all.find((r) => r.id === id)?.status === 'WAITING');
      const { turn, links, mailed } = this.sender.startTurn(c.firm.slug, all, next);
      const emails = mailed.map((r) => ({ recipientId: r.id, template: 'esign.request' as const }));
      const event = this.eventRecord(c, 'SIGNED', me.authMethod);
      const write = { signedAt, values, status, allSigned, turn, emails, event };
      const emailIds = await this.repo.finish(c.firm.id, q.id, me.id, write, q.lastActivityAt);
      if (emailIds) {
        await this.log(c, 'esign.signer_signed');
        const sender = await this.directory.member(c.firm.id, q.senderUserId);
        for (const [i, r] of mailed.entries()) {
          const id = emailIds[i];
          if (id) await this.sender.invite(c.firm.id, id, r, links.get(r.id)!, q, sender);
        }
        Object.assign(me, { status: 'SIGNED', signedAt });
        // The job retries it; complete() never throws, so finish answers DONE either way.
        if (allSigned) await this.completion.complete(c.firm.id, q.id);
        return this.state({ ...c, step: 'DONE' });
      }
      const fresh = await this.repo.signer(c.firm.id, q.id, me.id);
      if (!fresh || signerStep(c.session, fresh, new Date()) !== 'SIGN') {
        throw esignRefusal('REQUEST_CLOSED');
      }
      q = fresh.request;
      parts = await this.requests.parts(c.firm.id, q.id);
    }
    throw esignRefusal('INVALID_STATE');
  }

  /** POST decline: the recipient and the request are DECLINED; the sender gets an email. */
  async decline(c: SignerCall, reason: string | null): Promise<SignerState> {
    const { request: q, recipient: me } = c.signer;
    const at = new Date();
    const event = { ...this.eventRecord(c, 'DECLINED', me.authMethod), reason };
    if (!(await this.repo.decline(c.firm.id, q.id, me.id, { at, reason, event }))) {
      throw esignRefusal('REQUEST_CLOSED');
    }
    await this.log(c, 'esign.signer_declined');
    const sender = await this.directory.member(c.firm.id, q.senderUserId);
    if (sender?.email) {
      // Never the reason (it can hold client content). A failed send is NotifyService's to log.
      const link = new URL(`/firm-sign/requests/${q.id}`, this.env.APP_BASE_URL).toString();
      const data = { name: sender.name, title: q.title, signerName: me.name, link };
      await this.notify
        .send({ template: 'esign.declined', to: sender.email, businessId: c.firm.id, data })
        .catch(() => undefined);
    }
    Object.assign(me, { status: 'DECLINED', declinedAt: at, declineReason: reason });
    return this.state({ ...c, step: 'DECLINED' });
  }

  /** The signer's own fields; `value` suggests their name or email. */
  myFields(
    parts: EsignRequestParts,
    me: EsignRecipientRecord,
    attached: SignerAttachment[],
  ): SignerField[] {
    const names = new Map(attached.map((a) => [a.fieldId, a.fileName]));
    return parts.fields
      .filter((f) => f.recipientId === me.id)
      .map(({ id, type, pageIndex, x, y, w, h, required, label, options, groupKey }) => ({
        ...{ id, type, pageIndex, x, y, w, h, required, label, options, groupKey },
        value: type === 'PRINTED_NAME' ? me.name : type === 'EMAIL' ? me.email : null,
        attachmentName: names.get(id) ?? null,
      }));
  }

  /** Their values (suggestions fill the gaps): 400 for a field not theirs, 409 when short. */
  private checkValues(
    signer: SignerRecord,
    parts: EsignRequestParts,
    given: Value[],
    attached: SignerAttachment[],
  ): Value[] {
    const mine = this.myFields(parts, signer.recipient, attached);
    const byId = new Map(mine.map((f) => [f.id, f]));
    for (const [i, v] of given.entries()) {
      const f = byId.get(v.fieldId);
      if (!f || STAMPED.includes(f.type)) throw invalid(`values.${i}.fieldId`, 'Not your field');
      const flag = f.type === 'CHECKBOX' || f.type === 'RADIO';
      const choice = f.type === 'DROPDOWN' && v.value !== '' && !f.options.includes(v.value);
      if (choice || (flag && !['true', 'false'].includes(v.value))) {
        throw invalid(`values.${i}.value`, 'Not a choice of this field');
      }
    }
    const on = given.filter((v) => byId.get(v.fieldId)?.type === 'RADIO' && v.value === 'true');
    const groups = new Set(on.map((v) => byId.get(v.fieldId)?.groupKey ?? v.fieldId));
    if (groups.size < on.length) throw invalid('values', 'One choice per group');
    const adopted = signer.adopted;
    if (!adopted || (mine.some((f) => f.type === 'INITIALS') && !adopted.hasInitials)) {
      throw esignRefusal('SIGNATURE_REQUIRED');
    }
    const value = new Map(mine.map((f) => [f.id, f.value ?? '']));
    for (const v of given) value.set(v.fieldId, v.value.trim());
    const set = (f: SignerField) =>
      ['CHECKBOX', 'RADIO'].includes(f.type) ? value.get(f.id) === 'true' : value.get(f.id) !== '';
    const missing = mine.some((f) => {
      if (!f.required || ['SIGNATURE', 'INITIALS', 'DATE_SIGNED'].includes(f.type)) return false;
      if (f.type === 'ATTACHMENT') return f.attachmentName === null;
      if (f.groupKey) return !mine.some((g) => g.groupKey === f.groupKey && set(g));
      return !set(f);
    });
    if (missing) throw esignRefusal('REQUIRED_FIELDS_MISSING');
    return mine
      .filter((f) => !STAMPED.includes(f.type) && value.get(f.id) !== '')
      .map((f) => ({ fieldId: f.id, value: value.get(f.id) ?? '' }));
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

  /** The timeline's event; a copy session's codes are audited only (the request is closed). */
  private async event(c: SignerCall, ...args: [EsignEventType, EsignAuthMethod]) {
    if (c.session.purpose === 'COPY') return;
    await this.repo.addEvent(c.firm.id, c.signer.request.id, this.eventRecord(c, ...args));
  }

  /** Ids only: never a code, a token, a name or an address. */
  log(c: SignerCall, action: string, extra: Record<string, string> = {}) {
    const entity = { type: 'esign_recipient', id: c.signer.recipient.id };
    const metadata = { requestId: c.signer.request.id, ...extra };
    return this.audit.log(action, entity, metadata, { businessId: c.firm.id });
  }
}
