import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { ESIGN_ERRORS, ESIGN_KIOSK_IDLE_MINUTES } from '@firmivra/types';
import { httpError } from '../../auth/auth-errors.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../../auth/identity/identity-provider.js';
import { SessionService } from '../../auth/session.service.js';
import { sitePlace } from '../../auth/site.js';
import {
  type EsignExtrasRepository,
  type EsignKioskLock,
  EXTRAS_REPOSITORY,
} from './extras.repository.js';

/** The staff member's own password check, and their sign-out (docs/AUTH-DESIGN.md, kiosk). */
export interface KioskAuth {
  /** True for the member's own password: the staff pool's sign-in check (Cognito or local). */
  passwordOk(cognitoSub: string, password: string): Promise<boolean>;
  /** Clears the firm site's session cookies and revokes the refresh token. */
  signOut(req: Request, res: Response): Promise<void>;
}
export const KIOSK_AUTH = Symbol('ESIGN_KIOSK_AUTH');

/**
 * KioskAuth on the sign-in module's identity provider and sessions, looked up when used (Firm
 * Sign does not import the sign-in module, whose providers its tests do not build).
 */
@Injectable()
export class IdentityKioskAuth implements KioskAuth {
  constructor(private readonly refs: ModuleRef) {}

  async passwordOk(cognitoSub: string, password: string): Promise<boolean> {
    const identity = this.refs.get<IdentityProvider>(IDENTITY_PROVIDER, { strict: false });
    try {
      const step = await identity.signIn('STAFF', cognitoSub, password);
      // A sign-in that completed (no MFA asked) made tokens nobody uses: revoke them.
      if (step.kind === 'tokens' && step.tokens.refreshToken) {
        await identity.revoke('STAFF', step.tokens.refreshToken);
      }
      return true;
    } catch (error) {
      if (!(error instanceof AuthFlowError)) throw error;
      if (error.code === 'INVALID_CREDENTIALS') return false;
      throw httpError(error.code);
    }
  }

  signOut(req: Request, res: Response): Promise<void> {
    const sessions = this.refs.get(SessionService, { strict: false });
    return sessions.end(req, res, sitePlace('firm'), false);
  }
}

const ALLOWED_KEY = 'firmivra:esign-kiosk-allowed';
/** A route a locked staff session may still call (the lock screen's state and exit). */
export const KioskAllowed = () => SetMetadata(ALLOWED_KEY, true);

/** True once the signer has been idle for ESIGN_KIOSK_IDLE_MINUTES. */
export const kioskIdle = (lock: EsignKioskLock, now: Date) =>
  +now - +lock.activeAt >= ESIGN_KIOSK_IDLE_MINUTES * 60_000;

/** Ends an idle kiosk: the signer's session and the staff member's (EsignInPersonService). */
export interface KioskEnder {
  timeOut(req: Request, res: Response, businessId: string, lock: EsignKioskLock): Promise<void>;
}
export const KIOSK_ENDER = Symbol('ESIGN_KIOSK_ENDER');

/**
 * Every staff request (a global interceptor, after the guards): while the member holds an
 * in-person lock in this firm, every firm route but the lock screen's answers 403 KIOSK_LOCKED,
 * on the server, whatever the browser does. Once the signer has been idle too long, the kiosk
 * ends and the staff member is signed out (401) instead.
 */
@Injectable()
export class EsignKioskInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(EXTRAS_REPOSITORY) private readonly extras: Pick<EsignExtrasRepository, 'kioskLock'>,
    @Inject(KIOSK_ENDER) private readonly ender: KioskEnder,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const tenant = req.tenant;
    if (ctx.getType() !== 'http' || tenant?.kind !== 'staff' || !req.auth) return next.handle();
    const lock = await this.extras.kioskLock(tenant.businessId, req.auth.userId);
    if (!lock) return next.handle();
    if (kioskIdle(lock, new Date())) {
      await this.ender.timeOut(req, http.getResponse<Response>(), tenant.businessId, lock);
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    }
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOWED_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!allowed) {
      throw new ForbiddenException({ code: 'KIOSK_LOCKED', message: ESIGN_ERRORS.KIOSK_LOCKED });
    }
    return next.handle();
  }
}
