import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import { capabilityOfMethod, isGridFirmRole, roleCan } from '@firmivra/types';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { accessFor, isPublic, rolesFor } from './decorators.js';

const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' });

/** Global guard 3: default deny. A non-public route without @Roles() is refused. */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
    @Optional() private readonly grants?: PermissionGrantsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, ctx)) return true;

    const roles = rolesFor(this.reflector, ctx);
    if (!roles || roles.length === 0) {
      this.logger.warn(`Denied: ${ctx.getClass().name}.${ctx.getHandler().name} has no @Roles()`);
      throw forbidden();
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    if (roles.includes('AUTHENTICATED') && req.auth) return true;
    if (req.tenant && roles.includes(req.tenant.role)) return true;
    if (
      req.tenant?.kind === 'staff' &&
      isGridFirmRole(req.tenant.role) &&
      roles.includes('STAFF')
    ) {
      // Manager, Bookkeeper, Tax Preparer, Client Support, Read Only: the permission grid decides,
      // and only for routes Staff may use and that name their module (@Access).
      const access = accessFor(this.reflector, ctx);
      const capability = access?.capability ?? capabilityOfMethod(req.method);
      if (access && capability) {
        // The firm's own changes to the role's grid, over the default (Settings > Users & Roles).
        const allowed = this.grants
          ? await this.grants.can(req.tenant.businessId, req.tenant.role, access.module, capability)
          : roleCan(req.tenant.role, access.module, capability);
        if (allowed) return true;
      }
    }
    if (roles.includes('SUPER_ADMIN') && req.auth?.pool === 'ADMIN') {
      const admin = await this.db
        .forPlatform()
        .platformAdmin.findUnique({ where: { userId: req.auth.userId }, select: { role: true } });
      // The role itself, so a future platform role never gets Super Admin rights by accident.
      if (admin?.role === 'SUPER_ADMIN') {
        const platform = { role: admin.role };
        req.platform = platform;
        const store = requestContext.getStore();
        if (store) store.platform = platform;
        return true;
      }
    }
    throw forbidden();
  }
}
