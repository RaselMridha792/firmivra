import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { isPublic, rolesFor } from './decorators.js';

const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' });

/** Global guard 3: default deny. A non-public route without @Roles() is refused. */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
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
