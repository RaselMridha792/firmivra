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
  DevTokenRequest,
  type DevTokenResponse,
  type OkResponse,
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
    const users = await this.db.forPlatform().user.findMany({
      where: { email: body.email, ...(body.pool ? { pool: body.pool } : {}) },
      select: { id: true, email: true, name: true, pool: true, cognitoSub: true },
      take: 2,
    });
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
    // Each site's own cookie: a Super Admin session only works on /api/v1/admin/* (auth/site.ts).
    const site = user.pool === 'ADMIN' ? 'admin' : 'firm';
    res.cookie(AUTH_COOKIES[site].access, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // plain http on localhost; Cognito cookies in AWS are Secure
      path: '/',
      maxAge: expiresIn * 1000,
    });
    await this.audit.log('auth.dev_token_issued', { type: 'user', id: user.id });
    return {
      token,
      expiresIn,
      user: { id: user.id, email: user.email, name: user.name, pool: user.pool },
    };
  }

  @Post('sign-out')
  @HttpCode(200)
  signOut(@Res({ passthrough: true }) res: Response): OkResponse {
    res.clearCookie(AUTH_COOKIES.firm.access, { path: '/' });
    res.clearCookie(AUTH_COOKIES.admin.access, { path: '/' });
    return { ok: true };
  }
}

@Module({ controllers: [DevController] })
export class DevModule {}
