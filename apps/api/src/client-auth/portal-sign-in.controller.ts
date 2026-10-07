import { Controller, Get, Inject, Module, NotFoundException, Param } from '@nestjs/common';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import { FirmSlug, type MeResponse, portalCookies } from '@firmivra/types';
import { httpError } from '../auth/auth-errors.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { portalClient } from '../auth/portal-clients.js';
import { SessionService } from '../auth/session.service.js';
import { SignInModule, SignInRoutes } from '../auth/sign-in.controller.js';
import { SignInService } from '../auth/sign-in.service.js';
import { portalPlace, type SignInPlace } from '../auth/site.js';
import type { AuthContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { MeModule } from '../me/me.controller.js';
import { MeService } from '../me/me.service.js';
import { PortalInfoModule, PortalInfoService } from './portal-info.controller.js';

const slugOf = (req: Request): string => String(req.params['firmSlug'] ?? '');

/**
 * Client sign-in on a firm's portal: /api/v1/portal/{firmSlug}/auth/* (client-auth.yaml). The
 * staff routes with the clients pool, the firm's own login (by firm and email) and the firm's
 * own cookies. Only ACTIVE firms have a portal (404 otherwise).
 */
@Controller('portal/:firmSlug/auth')
export class PortalSignInController extends SignInRoutes {
  constructor(
    signIns: SignInService,
    sessions: SessionService,
    me: MeService,
    private readonly portal: PortalInfoService,
  ) {
    super(signIns, sessions, me);
  }

  protected async place(req: Request): Promise<SignInPlace> {
    return portalPlace(await this.portal.activeFirm(slugOf(req)));
  }

  /**
   * Sign-out works on a firm whose portal is closed too (#62 follow-up): the firm is found by its
   * slug whatever its status, so the refresh token is revoked as well as the cookies cleared. A
   * slug that can't be a firm's address is 404 before any cookie name is built from it.
   */
  protected override async signOutPlace(req: Request): Promise<SignInPlace> {
    const slug = FirmSlug.safeParse(slugOf(req));
    if (!slug.success) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    const firm = await this.portal.firmBySlug(slug.data);
    if (firm) return portalPlace(firm);
    return { pool: 'CLIENT', cookies: portalCookies(slug.data), issuer: '' };
  }
}

/** GET /api/v1/portal/{firmSlug}/me: the signed-in client, with their account at this firm. */
@Controller('portal/:firmSlug/me')
export class PortalMeController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly portal: PortalInfoService,
    private readonly me: MeService,
  ) {}

  /**
   * AUTHENTICATED, not CLIENT: a client waiting for approval reads this too, to be sent to the
   * "waiting" page. Anyone who may not sign in to this firm's portal is signed out here (401).
   */
  @Get()
  @Roles('AUTHENTICATED')
  async get(
    @Param('firmSlug') firmSlug: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<MeResponse> {
    const firm = await this.portal.activeFirm(firmSlug);
    if (!(await portalClient(this.db, firm.id, { userId: auth.userId }))) {
      throw httpError('SESSION_EXPIRED');
    }
    return this.me.load(auth.userId, firm.id);
  }
}

@Module({
  imports: [SignInModule, PortalInfoModule, MeModule],
  controllers: [PortalSignInController, PortalMeController],
})
export class PortalSignInModule {}
