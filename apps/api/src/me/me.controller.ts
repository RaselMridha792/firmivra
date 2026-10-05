import { Controller, Get, Module } from '@nestjs/common';
import type { MeResponse } from '@firmivra/types';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { MeService } from './me.service.js';

/** GET /api/v1/me: the signed-in person and the firms they can open (firm picker). */
@Controller('me')
@Roles('AUTHENTICATED')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.me.load(auth.userId);
  }
}

/** GET /api/v1/admin/me: the same for the Super Admin site, which only has the admin cookie. */
@Controller('admin/me')
@Roles('SUPER_ADMIN')
export class AdminMeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.me.load(auth.userId);
  }
}

@Module({
  controllers: [MeController, AdminMeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
