import { Global, Module, type OnApplicationBootstrap, type Type } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { routeSiteProblems } from './route-sites.js';
import { TenantGuard } from './tenant.guard.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [TokenService, AuthGuard, TenantGuard, RolesGuard],
  exports: [TokenService, AuthGuard, TenantGuard, RolesGuard],
})
export class AuthModule implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly scanner: MetadataScanner,
  ) {}

  /** Fails fast on a route that no caller could ever reach (see route-sites.ts). */
  onApplicationBootstrap(): void {
    const controllers = this.discovery
      .getControllers()
      .map((wrapper) => wrapper.metatype)
      .filter((c): c is Type => typeof c === 'function');
    const problems = routeSiteProblems(controllers, this.reflector, this.scanner);
    if (problems.length > 0) {
      throw new Error(`@Roles() does not fit the route's site:\n- ${problems.join('\n- ')}`);
    }
  }
}
