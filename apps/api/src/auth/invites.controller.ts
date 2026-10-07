import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  AcceptInviteRequest,
  ActivateRequest,
  ActivationCheckRequest,
  type ActivationCheckResponse,
  CreateInviteRequest,
  InviteResponse,
  type MeResponse,
  type SignInResult,
} from '@firmivra/types';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MeService } from '../me/me.service.js';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Public,
  Roles,
} from './decorators.js';
import { InvitesService } from './invites.service.js';
import { SessionService } from './session.service.js';
import { SignInService } from './sign-in.service.js';
import { sitePlace } from './site.js';

/** Per viewer IP (see configure-app.ts). */
const ATTEMPTS = { default: { limit: 10, ttl: 60_000 } };
const INVITES = { default: { limit: 30, ttl: 60_000 } };

/** Staff invites and activation on the firm site (docs/api/auth.yaml). */
@Controller('auth')
export class InvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly signIns: SignInService,
    private readonly sessions: SessionService,
    private readonly me: MeService,
  ) {}

  /** Also while the firm is in setup: the setup wizard's "Team and access" step (T03). */
  @Post('invites')
  @Roles(...FIRM_MANAGERS)
  @AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
  @Throttle(INVITES)
  async create(
    @Body(new ZodValidationPipe(CreateInviteRequest)) body: z.output<typeof CreateInviteRequest>,
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<InviteResponse> {
    if (tenant.role === 'CLIENT') throw new Error('unreachable: @Roles excludes clients');
    const invite = await this.invites.createInvite({
      businessId: tenant.businessId,
      email: body.email,
      name: body.name,
      role: body.role,
      invitedBy: { userId: auth.userId, role: tenant.role },
    });
    return InviteResponse.parse(invite);
  }

  @Post('activation/check')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  check(
    @Body(new ZodValidationPipe(ActivationCheckRequest))
    body: z.output<typeof ActivationCheckRequest>,
  ): Promise<ActivationCheckResponse> {
    return this.invites.check(body.token);
  }

  @Post('activate')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async activate(
    @Body(new ZodValidationPipe(ActivateRequest)) body: z.output<typeof ActivateRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    const { userId, sub } = await this.invites.activate(body.token, body.password, body.name);
    const outcome = await this.signIns.afterActivation(userId, sub, body.password);
    if (outcome.kind === 'step') return outcome.result;
    await this.sessions.start(res, sitePlace('firm'), outcome);
    return { status: 'SIGNED_IN', me: await this.me.load(outcome.userId) };
  }

  /** Signed in with an existing login (hasAccount): joins the invite's firm. */
  @Post('activation/accept')
  @Roles('AUTHENTICATED')
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async accept(
    @Body(new ZodValidationPipe(AcceptInviteRequest)) body: z.output<typeof AcceptInviteRequest>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<MeResponse> {
    await this.invites.accept(body.token, auth);
    return this.me.load(auth.userId);
  }
}
