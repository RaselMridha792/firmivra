import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ESIGN_ERRORS,
  ESIGN_KIOSK_IDLE_MINUTES,
  ESIGN_KIOSK_PASSWORD_TRIES,
  type EsignInPersonSession,
  type EsignInPersonState,
  type OkResponse,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { LINK_TOKENS, type LinkTokens } from '../engine/engine.types.js';
import { EsignLifecycleService, event } from '../lifecycle/lifecycle.service.js';
import { isOpen, TURN } from '../requests/actions.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { ESIGN_REPOSITORY, type EsignRepository } from '../requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
  esignRefusal,
} from '../requests/requests.service.js';
import {
  type EsignExtrasRepository,
  type EsignKioskLock,
  EXTRAS_REPOSITORY,
} from './extras.repository.js';
import { KIOSK_AUTH, type KioskAuth, type KioskEnder } from './kiosk.js';

const entity = (id: string) => ({ type: 'esign_request', id });
type EndReason = 'EXIT' | 'PASSWORD_TRIES' | 'IDLE';

/**
 * In-person signing (R13, contract 3; docs/AUTH-DESIGN.md, kiosk). `start` (a write, the request
 * open and the IN_PERSON signer's turn) issues a fresh one-time link (only its hash is stored)
 * and locks the caller's Firm Sign session in this firm (EsignKioskInterceptor). `exit` unlocks it
 * with the staff member's own password; after ESIGN_KIOSK_PASSWORD_TRIES wrong ones, or when the
 * signer is idle, the kiosk ends and the staff member is signed out. The password, the link and
 * the token never reach a log, the audit or the timeline.
 */
@Injectable()
export class EsignInPersonService implements KioskEnder {
  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(EsignLifecycleService) private readonly lifecycle: Pick<EsignLifecycleService, 'staff'>,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(EXTRAS_REPOSITORY) private readonly extras: EsignExtrasRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(LINK_TOKENS) private readonly tokens: Pick<LinkTokens, 'issue'>,
    @Inject(KIOSK_AUTH) private readonly auth: KioskAuth,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
    @Inject(ENV) private readonly env: Pick<Env, 'PORTAL_BASE_URL'>,
  ) {}

  async start(
    businessId: string,
    actor: EsignActor,
    id: string,
    recipientId: string,
  ): Promise<EsignInPersonSession> {
    const { record } = await this.requests.reach(businessId, actor, id, 'write');
    if (!isOpen(record.status)) {
      const unsent = record.status === 'DRAFT' || record.status === 'NEEDS_APPROVAL';
      throw esignRefusal(unsent ? 'INVALID_STATE' : 'REQUEST_CLOSED');
    }
    const { recipients } = await this.repo.parts(businessId, id);
    const r = recipients.find((x) => x.id === recipientId && x.kind === 'SIGNER');
    if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    if (r.delivery !== 'IN_PERSON') throw esignRefusal('NOT_IN_PERSON');
    if (r.status === 'SIGNED' || r.status === 'DECLINED') throw esignRefusal('RECIPIENT_DONE');
    if (!TURN.includes(r.status)) throw esignRefusal('NOT_YOUR_TURN');
    const now = new Date();
    const { token, hash } = this.tokens.issue();
    const lock: EsignKioskLock = {
      userId: actor.userId,
      requestId: id,
      recipientId: r.id,
      signerName: r.name,
      startedAt: now,
      linkExpiresAt: new Date(+now + ESIGN_KIOSK_IDLE_MINUTES * 60_000),
      activeAt: now,
    };
    const by = await this.lifecycle.staff(businessId, actor);
    const write = {
      at: now,
      lock,
      tokenHash: hash,
      events: [event('IN_PERSON_STARTED', now, by, r)],
    };
    const written = await this.extras.startInPerson(businessId, id, write, record.lastActivityAt);
    if (!written) throw esignRefusal('INVALID_STATE');
    await this.audit.log('esign.in_person_started', entity(id), {
      clientId: record.clientId,
      recipientId: r.id,
    });
    return this.session(written, `${await this.portal(businessId)}/sign#t=${token}`);
  }

  /** The caller's open kiosk. Its link is not stored, so `signingUrl` is the sign page alone. */
  async state(businessId: string, actor: EsignActor): Promise<EsignInPersonState> {
    const lock = await this.extras.kioskLock(businessId, actor.userId);
    if (!lock) return { session: null };
    return { session: this.session(lock, `${await this.portal(businessId)}/sign`) };
  }

  async exit(
    req: Request,
    res: Response,
    businessId: string,
    actor: EsignActor & { cognitoSub: string },
    password: string,
  ): Promise<OkResponse> {
    const lock = await this.extras.kioskLock(businessId, actor.userId);
    if (!lock) return { ok: true };
    if (await this.auth.passwordOk(actor.cognitoSub, password)) {
      await this.end(businessId, lock, 'EXIT');
      return { ok: true };
    }
    const tries = await this.extras.kioskWrongPassword(businessId, actor.userId);
    if (tries < ESIGN_KIOSK_PASSWORD_TRIES) {
      throw new BadRequestException({
        code: 'PASSWORD_WRONG',
        message: ESIGN_ERRORS.PASSWORD_WRONG,
      });
    }
    await this.end(businessId, lock, 'PASSWORD_TRIES');
    await this.auth.signOut(req, res);
    throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
  }

  /** The interceptor's idle timeout: the kiosk ends and the staff member is signed out. */
  async timeOut(req: Request, res: Response, businessId: string, lock: EsignKioskLock) {
    await this.end(businessId, lock, 'IDLE');
    await this.auth.signOut(req, res);
  }

  private async end(businessId: string, lock: EsignKioskLock, reason: EndReason) {
    const now = new Date();
    const member = await this.directory.member(businessId, lock.userId);
    const by = { kind: 'STAFF' as const, name: member?.name ?? '' };
    const signer = { id: lock.recipientId, name: lock.signerName };
    const write = { at: now, events: [event('IN_PERSON_ENDED', now, by, signer)] };
    const ended = await this.extras.endKiosk(businessId, lock.userId, write);
    if (!ended) return;
    await this.audit.log('esign.in_person_ended', entity(lock.requestId), {
      recipientId: lock.recipientId,
      reason,
    });
  }

  private session(lock: EsignKioskLock, signingUrl: string): EsignInPersonSession {
    return {
      requestId: lock.requestId,
      recipientId: lock.recipientId,
      signerName: lock.signerName,
      signingUrl,
      startedAt: lock.startedAt.toISOString(),
      expiresAt: lock.linkExpiresAt.toISOString(),
    };
  }

  private async portal(businessId: string) {
    const firm = await this.directory.firm(businessId);
    return `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}`;
  }
}
