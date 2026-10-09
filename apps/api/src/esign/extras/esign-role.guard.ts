import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { TenantContext } from '../../common/request-context.js';
import { ESIGN_REPOSITORY, type EsignRepository } from '../requests/esign.repository.js';
import type { EsignActor } from '../requests/requests.service.js';
import type { EsignStaffRole } from './extras.repository.js';

/** Each request's Firm Sign role beyond its firm role (a Staff member made MANAGER or VIEWER). */
const staffRoleOf = new WeakMap<TenantContext, EsignStaffRole>();
/** The caller's Firm Sign role: what EsignRoleGuard found, else the firm role. */
export const esignRoleOf = (tenant: TenantContext & { kind: 'staff' }): EsignActor['role'] =>
  staffRoleOf.get(tenant) ?? tenant.role;

/**
 * Runs after ModuleGuard on every Firm Sign route: a Staff caller's stored Firm Sign role
 * (MANAGER or VIEWER, esign_member_roles) becomes their actor role. Owner and Admin keep theirs
 * and cost no read.
 */
@Injectable()
export class EsignRoleGuard implements CanActivate {
  constructor(
    @Inject(ESIGN_REPOSITORY) private readonly repo: Pick<EsignRepository, 'esignRole'>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const tenant = req.tenant;
    if (tenant?.kind === 'staff' && tenant.role === 'STAFF' && req.auth) {
      const role = await this.repo.esignRole(tenant.businessId, req.auth.userId);
      if (role === 'MANAGER' || role === 'VIEWER') staffRoleOf.set(tenant, role);
    }
    return true;
  }
}

/** `@EsignRoute()` on a Firm Sign controller: the module switch, then the caller's role. */
export const EsignRoute = () => applyDecorators(RequiresModule('esign'), UseGuards(EsignRoleGuard));
