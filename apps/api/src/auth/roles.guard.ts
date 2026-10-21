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
    if (req.tenant && roles.includes(req.tenant.role)) {
      // The member's own change to this route's cell (Staff Management) can only take away here.
      const own = await this.memberCell(ctx, req);
      if (own === false) throw forbidden();
      if (own === undefined) {
        // A custom role's grid stands in for its role's: a cell it refuses closes the route where
        // the role's default gives it (where the default does not, the role's own members pass
        // by @Roles as before, and so do they).
        const custom = await this.customCell(ctx, req);
        if (custom === false && this.defaultGives(ctx, req)) throw forbidden();
        // An Admin also loses a cell the firm took away from the Admin role (Settings > Users &
        // Roles). The Admin default is every cell, so only a firm's explicit change closes one.
        if (custom === undefined && (await this.adminCellRemoved(ctx, req))) throw forbidden();
      }
      return true;
    }
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
        // The member's own change first, then the firm's changes to the role's grid, over the
        // default (Settings > Users & Roles).
        const own = await this.memberCell(ctx, req);
        const allowed =
          own ??
          (await this.customCell(ctx, req)) ??
          (this.grants
            ? await this.grants.can(
                req.tenant.businessId,
                req.tenant.role,
                access.module,
                capability,
              )
            : roleCan(req.tenant.role, access.module, capability));
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

  /** The route's cell (@Access, else the method's capability), or undefined if it names none. */
  private cellOf(ctx: ExecutionContext, req: Request) {
    const access = accessFor(this.reflector, ctx);
    const capability = access?.capability ?? capabilityOfMethod(req.method);
    return access && capability ? { module: access.module, capability } : undefined;
  }

  /** Whether the member's role gives the route's cell by default (code, not the firm's grid). */
  private defaultGives(ctx: ExecutionContext, req: Request): boolean {
    const cell = this.cellOf(ctx, req);
    if (!cell || req.tenant?.kind !== 'staff') return false;
    return roleCan(req.tenant.role, cell.module, cell.capability);
  }

  /**
   * The member's custom role's cell for this route (Settings > Users & Roles), or undefined: no
   * custom role, or a route that names no module.
   */
  private async customCell(ctx: ExecutionContext, req: Request): Promise<boolean | undefined> {
    if (!this.grants || req.tenant?.kind !== 'staff' || !req.tenant.customRoleId) return undefined;
    const cell = this.cellOf(ctx, req);
    if (!cell) return undefined;
    return this.grants.customCell(
      req.tenant.businessId,
      req.tenant.customRoleId,
      cell.module,
      cell.capability,
    );
  }

  /** Whether the firm took this route's cell away from the Admin role (a saved `false`). */
  private async adminCellRemoved(ctx: ExecutionContext, req: Request): Promise<boolean> {
    if (!this.grants || req.tenant?.kind !== 'staff' || req.tenant.role !== 'ADMIN') return false;
    const access = accessFor(this.reflector, ctx);
    const capability = access?.capability ?? capabilityOfMethod(req.method);
    if (!access || !capability) return false;
    const changed = await this.grants.changes(req.tenant.businessId, 'ADMIN');
    return changed.get(`${access.module}:${capability}`) === false;
  }

  /**
   * A staff member's own grant or refusal of the route's cell (`member_permissions`, set in
   * Staff Management), or undefined: none, an Owner (never changed), a client, or a route that
   * names no module. A member without rows is decided exactly as before.
   */
  private async memberCell(ctx: ExecutionContext, req: Request): Promise<boolean | undefined> {
    if (!this.grants || req.tenant?.kind !== 'staff' || req.tenant.role === 'OWNER' || !req.auth)
      return undefined;
    const access = accessFor(this.reflector, ctx);
    const capability = access?.capability ?? capabilityOfMethod(req.method);
    if (!access || !capability) return undefined;
    return this.grants.memberCell(
      req.tenant.businessId,
      req.auth.userId,
      access.module,
      capability,
    );
  }
}
