import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../../database/database.module.js';

// The per-firm module switch (R13, shared with R14): Firm Sign ('esign') and calculators.

export type FirmModule = 'esign' | 'calculators';

/**
 * Whether a module is on for a firm: `business_settings.enabled_modules` (SYSTEM-DESIGN, "Module
 * switch"), read through `forBusiness(businessId)`. No settings row means every module is off.
 * Migration r0_esign adds the lock: only `app_set_business_module` will change that column.
 */
export interface BusinessModules {
  isEnabled(businessId: string, module: FirmModule): Promise<boolean>;
}
export const BUSINESS_MODULES = Symbol('BUSINESS_MODULES');

@Injectable()
export class PrismaBusinessModules implements BusinessModules {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async isEnabled(businessId: string, module: FirmModule): Promise<boolean> {
    const settings = await this.database.forBusiness(businessId).businessSettings.findUnique({
      where: { businessId },
      select: { enabledModules: true },
    });
    return settings?.enabledModules.includes(module) ?? false;
  }
}

/** Firm routes: 403 MODULE_OFF. Portal and public routes: 404, as if the route did not exist. */
export function moduleOff(module: FirmModule, side: 'firm' | 'public'): Error {
  if (side === 'public') return new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
  const name = module === 'esign' ? 'Firm Sign' : 'Calculators';
  return new ForbiddenException({
    code: 'MODULE_OFF',
    message: `${name} is not turned on for this firm.`,
  });
}

const MODULE_KEY = 'firmivra:module';

/**
 * Runs after the global guards (TenantGuard resolved the firm). A staff caller gets 403
 * MODULE_OFF, a client 404. A route with no firm in its context (a public signer route) is
 * refused with 404: such a route checks `BusinessModules` itself once it knows the firm.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(BUSINESS_MODULES) private readonly modules: BusinessModules,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<FirmModule | undefined>(MODULE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!module) return true;
    const tenant = ctx.switchToHttp().getRequest<Request>().tenant;
    const side = tenant?.kind === 'staff' ? 'firm' : 'public';
    if (tenant && (await this.modules.isEnabled(tenant.businessId, module))) return true;
    throw moduleOff(module, side);
  }
}

/** `@RequiresModule('esign')` on a controller or route. The module must import ModulesModule. */
export const RequiresModule = (module: FirmModule) =>
  applyDecorators(SetMetadata(MODULE_KEY, module), UseGuards(ModuleGuard));

@Module({
  providers: [{ provide: BUSINESS_MODULES, useClass: PrismaBusinessModules }, ModuleGuard],
  exports: [BUSINESS_MODULES, ModuleGuard],
})
export class ModulesModule {}
