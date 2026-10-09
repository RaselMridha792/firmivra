import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { Body, Controller, HttpCode, Module, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  ForgotPasswordRequest,
  MfaRequest,
  MfaSetupRequest,
  type MfaSetupResponse,
  type OkResponse,
  ResetPasswordRequest,
  SignInRequest,
  type SignInResult,
  SignOutRequest,
} from '@firmivra/types';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { MeModule } from '../me/me.controller.js';
import { MeService } from '../me/me.service.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { ACTIVATION_MAILER, LogActivationMailer } from './activation-mailer.js';
import { ChallengeSessions } from './challenge-session.js';
import { Public } from './decorators.js';
import {
  CognitoIdentityProvider,
  cognitoPoolsFromEnv,
} from './identity/cognito-identity.provider.js';
import { IDENTITY_PROVIDER } from './identity/identity-provider.js';
import { LocalIdentityProvider } from './identity/local-identity.provider.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';
import { poolSecrets } from './sealed.js';
import { RefreshEnvelopes, SessionService } from './session.service.js';
import { type SignInOutcome, SignInService } from './sign-in.service.js';
import { type SignInPlace, sitePlace } from './site.js';
import { TokenService } from './token.service.js';

/** Per client IP (the viewer's, see configure-app.ts). Step 7 adds per-email limits. */
const ATTEMPTS = { default: { limit: 10, ttl: 60_000 } };
const REFRESHES = { default: { limit: 30, ttl: 60_000 } };

/**
 * The firm site, the Super Admin site and each firm's portal have the same routes
 * (docs/api/auth.yaml, client-auth.yaml); each subclass says where its sign-in happens. @Public()
 * sits on each handler, never on the class, so a route added later is not public by accident.
 */
export abstract class SignInRoutes {
  constructor(
    private readonly signIns: SignInService,
    private readonly sessions: SessionService,
    private readonly me: MeService,
  ) {}

  /** Where this request signs in: the site, or the firm's portal (404 if it has none). */
  protected abstract place(req: Request): Promise<SignInPlace>;

  /** Sign-out always succeeds, so it may need a place even where `place` would refuse. */
  protected signOutPlace(req: Request): Promise<SignInPlace> {
    return this.place(req);
  }

  @Post('sign-in')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async signIn(
    @Body(new ZodValidationPipe(SignInRequest)) body: z.output<typeof SignInRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    const place = await this.place(req);
    return this.finish(res, place, await this.signIns.signIn(place, body.email, body.password));
  }

  @Post('mfa')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async mfa(
    @Body(new ZodValidationPipe(MfaRequest)) body: z.output<typeof MfaRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    const place = await this.place(req);
    return this.finish(res, place, await this.signIns.mfa(place, body.session, body.code));
  }

  @Post('mfa/setup')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async mfaSetup(
    @Body(new ZodValidationPipe(MfaSetupRequest)) body: z.output<typeof MfaSetupRequest>,
    @Req() req: Request,
  ): Promise<MfaSetupResponse> {
    return this.signIns.startMfaSetup(await this.place(req), body.session);
  }

  /** Public: the access cookie may have expired. Reads only the refresh cookie. */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle(REFRESHES)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OkResponse> {
    await this.sessions.refresh(req, res, await this.place(req));
    return { ok: true };
  }

  @Post('sign-out')
  @Public()
  @HttpCode(200)
  async signOut(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OkResponse> {
    // Sign-out always succeeds; a body it cannot read only means "not everywhere".
    const parsed = SignOutRequest.optional().safeParse(body);
    const everywhere = parsed.success && parsed.data?.everywhere === true;
    await this.sessions.end(req, res, await this.signOutPlace(req), everywhere);
    return { ok: true };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordRequest))
    body: z.output<typeof ForgotPasswordRequest>,
    @Req() req: Request,
  ): Promise<OkResponse> {
    await this.signIns.forgotPassword(await this.place(req), body.email);
    return { ok: true };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordRequest)) body: z.output<typeof ResetPasswordRequest>,
    @Req() req: Request,
  ): Promise<OkResponse> {
    const place = await this.place(req);
    await this.signIns.resetPassword(place, body.email, body.code, body.password);
    return { ok: true };
  }

  private async finish(
    res: Response,
    place: SignInPlace,
    outcome: SignInOutcome,
  ): Promise<SignInResult> {
    if (outcome.kind === 'step') return outcome.result;
    await this.sessions.start(res, place, outcome);
    return { status: 'SIGNED_IN', me: await this.me.load(outcome.userId, place.businessId) };
  }
}

const FIRM = sitePlace('firm');
const ADMIN = sitePlace('admin');

/** Firm site: /api/v1/auth/* (staff pool). */
@Controller('auth')
export class StaffSignInController extends SignInRoutes {
  constructor(signIns: SignInService, sessions: SessionService, me: MeService) {
    super(signIns, sessions, me);
  }

  protected place(): Promise<SignInPlace> {
    return Promise.resolve(FIRM);
  }
}

/** Super Admin site: /api/v1/admin/auth/* (admins pool). */
@Controller('admin/auth')
export class AdminSignInController extends SignInRoutes {
  constructor(signIns: SignInService, sessions: SessionService, me: MeService) {
    super(signIns, sessions, me);
  }

  protected place(): Promise<SignInPlace> {
    return Promise.resolve(ADMIN);
  }
}

@Module({
  imports: [MeModule, NotificationsModule],
  controllers: [StaffSignInController, AdminSignInController, InvitesController],
  providers: [
    SignInService,
    SessionService,
    InvitesService,
    {
      provide: ACTIVATION_MAILER,
      inject: [ENV],
      useFactory: (env: Env) => new LogActivationMailer(env.AUTH_MODE === 'local'),
    },
    {
      provide: RefreshEnvelopes,
      inject: [ENV],
      useFactory: (env: Env) => new RefreshEnvelopes(poolSecrets(env)),
    },
    {
      provide: ChallengeSessions,
      inject: [ENV],
      useFactory: (env: Env) => ChallengeSessions.fromEnv(env),
    },
    {
      provide: IDENTITY_PROVIDER,
      inject: [ENV, TokenService],
      useFactory: (env: Env, tokens: TokenService) =>
        env.AUTH_MODE === 'local'
          ? new LocalIdentityProvider(tokens)
          : new CognitoIdentityProvider(
              new CognitoIdentityProviderClient({ region: env.COGNITO_REGION }),
              cognitoPoolsFromEnv(env),
            ),
    },
  ],
  // For R4 (a new firm's owner on approval) and the Team API (resend), and R3's client sign-up
  // and portal sign-in (identity provider, sign-in and sessions): import SignInModule.
  exports: [InvitesService, IDENTITY_PROVIDER, SignInService, SessionService],
})
export class SignInModule {}
