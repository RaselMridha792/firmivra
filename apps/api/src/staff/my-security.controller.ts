import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { MySecurityResult, MySessionList } from '@firmivra/types';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MySecurityService } from './my-security.service.js';
import { ChangeMyPasswordBody, SignOutOthersBody } from './staff-input.js';

/**
 * SM14 part B: the signed-in member's own sessions and password in the selected firm (My
 * Profile's Security card). Every staff role, without a Staff Management right: it is always
 * one's own account. Never a client portal route.
 */
@Controller('business/me')
@Roles(...FIRM_STAFF)
export class MySecurityController {
  constructor(private readonly mine: MySecurityService) {}

  @Get('sessions')
  async sessions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MySessionList> {
    return { items: await this.mine.sessions(tenant.businessId, auth) };
  }

  @Post('sessions/sign-out-others')
  @HttpCode(200)
  signOutOthers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SignOutOthersBody)) _body: z.output<typeof SignOutOthersBody>,
  ): Promise<MySecurityResult> {
    return this.mine.signOutOthers(tenant.businessId, auth);
  }

  /** A wrong current password counts: 5 tries in 15 minutes from one address. */
  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  changePassword(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ChangeMyPasswordBody)) body: z.output<typeof ChangeMyPasswordBody>,
  ): Promise<MySecurityResult> {
    return this.mine.changePassword(tenant.businessId, auth, body);
  }
}
