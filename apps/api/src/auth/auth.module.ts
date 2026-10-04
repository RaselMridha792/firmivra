import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { TenantGuard } from './tenant.guard.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  providers: [TokenService, AuthGuard, TenantGuard, RolesGuard],
  exports: [TokenService, AuthGuard, TenantGuard, RolesGuard],
})
export class AuthModule {}
