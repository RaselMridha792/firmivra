import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { z } from 'zod';
import type { Database } from '@firmivra/db';
import {
  AUTH_COOKIES,
  DevSignOutRequest,
  DevTokenRequest,
  type DevTokenResponse,
  type OkResponse,
  portalCookies,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { Public } from '../auth/decorators.js';
import { TokenService } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';

/**
 * Local sign-in as a seeded user. Only loaded when AUTH_MODE=local, which the config refuses
 * outside development and test (docs/AUTH-DESIGN.md). Runs the same guards as Cognito tokens.
 */
@Controller('dev')
@Public()
export class DevController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('token')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async token(
    @Body(new ZodValidationPipe(DevTokenRequest)) body: z.output<typeof DevTokenRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DevTokenResponse> {
    const found = await this.db.forPlatform().user.findMany({
      where: { email: body.email, ...(body.pool ? { pool: body.pool } : {}) },
      select: { id: true, email: true, name: true, pool: true, cognitoSub: true },
      // Newest first: a client's sign-ups leave a login each, and the one with the account is
      // usually the latest (#84 follow-up).
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    // Portal sign-up makes a login per attempt: of a client's logins, only one has the account.
    const users = found.some((u) => u.pool !== 'CLIENT') ? found : await this.withAccount(found);
    const user = users[0];
    if (!user)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No seeded user has that email' });
    if (users.length > 1) {
      throw new BadRequestException({
        code: 'AMBIGUOUS_USER',
        message: 'Several users have that email: send pool too',
      });
    }

    const { token, expiresIn } = await this.tokens.signLocal(user.cognitoSub, user.pool);
    const cookie = {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // plain http on localhost; Cognito cookies in AWS are Secure
      maxAge: expiresIn * 1000,
    } as const;
    if (user.pool === 'CLIENT') {
      // A client's session works only on their firm's portal (portalCookies in packages/types).
      const account = await this.db.forUser(user.id).clientAccount.findFirst({
        select: { business: { select: { slug: true } } },
      });
      if (account) {
        const names = portalCookies(account.business.slug);
        res.cookie(names.access, token, { ...cookie, path: names.accessPath });
      }
    } else {
      // Each site's own cookie: a Super Admin session only works on /api/v1/admin/* (auth/site.ts).
      const site = user.pool === 'ADMIN' ? 'admin' : 'firm';
      res.cookie(AUTH_COOKIES[site].access, token, { ...cookie, path: '/' });
    }
    await this.audit.log('auth.dev_token_issued', { type: 'user', id: user.id });
    return {
      token,
      expiresIn,
      user: { id: user.id, email: user.email, name: user.name, pool: user.pool },
    };
  }

  private async withAccount<T extends { id: string }>(users: T[]): Promise<T[]> {
    if (users.length < 2) return users;
    const owned = await Promise.all(
      users.map((u) =>
        this.db
          .forUser(u.id)
          .clientAccount.findFirst({ select: { id: true } })
          .then((a) => (a ? u : null)),
      ),
    );
    return owned.filter((u): u is Awaited<T> => u !== null);
  }

  /** Clears the dev access cookies: both sites', and with `firmSlug` that firm's portal one. */
  @Post('sign-out')
  @HttpCode(200)
  signOut(
    // No body at all is fine: most sign-outs send none.
    @Body(new ZodValidationPipe(DevSignOutRequest.optional()))
    body: z.output<typeof DevSignOutRequest> | undefined,
    @Res({ passthrough: true }) res: Response,
  ): OkResponse {
    res.clearCookie(AUTH_COOKIES.firm.access, { path: '/' });
    res.clearCookie(AUTH_COOKIES.admin.access, { path: '/' });
    if (body?.firmSlug) {
      const names = portalCookies(body.firmSlug);
      res.clearCookie(names.access, { path: names.accessPath });
    }
    return { ok: true };
  }
}

@Module({ controllers: [DevController] })
export class DevModule {}
