import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import { type AuthContext, requestContext, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { businessStatusesFor, isPublic, rolesFor, TENANT_ROLES } from './decorators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Client portal routes: /api/v1/portal/:firmSlug/... (any case, like routing). */
const PORTAL_PATH = /^\/api\/v1\/portal\//i;

// 404, never 403, when the caller has no place in the firm: the firm's existence must not leak.
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

/**
 * Global guard 2: for routes with a firm role, resolves the firm and the caller's role in it.
 * Firm: on portal routes the `:firmSlug` route param, and nothing else; on other routes the
 * `x-business-id` header (selected firm), else the caller's only firm. A `:slug` param of some
 * other route never picks the firm. Role: the Membership (staff) or ClientAccount (client) row;
 * for clients the ClientAccount id goes into the tenant context too.
 * The firm must be in a status the route allows: ACTIVE unless @AllowBusinessStatuses() says more.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, ctx)) return true;
    const roles = rolesFor(this.reflector, ctx);
    if (!roles?.some((r) => (TENANT_ROLES as readonly string[]).includes(r))) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth) throw notFound();

    const businessId = await this.resolveBusinessId(req, auth);
    if (!businessId) throw notFound();
    const business = await this.db
      .forPlatform()
      .business.findUnique({ where: { id: businessId }, select: { id: true, status: true } });
    if (!business) throw notFound();

    const tenant = await this.membership(auth, business.id);
    if (!tenant) throw notFound();
    // Only after the membership check, so the status of someone else's firm never shows.
    if (!businessStatusesFor(this.reflector, ctx).includes(business.status)) {
      throw business.status === 'PENDING_SETUP'
        ? new ForbiddenException({
            code: 'BUSINESS_SETUP_REQUIRED',
            message: 'This firm has not finished setting up',
          })
        : new ForbiddenException({ code: 'BUSINESS_INACTIVE', message: 'This firm is not active' });
    }

    req.tenant = tenant;
    const store = requestContext.getStore();
    if (store) store.tenant = tenant;
    return true;
  }

  private async resolveBusinessId(req: Request, auth: AuthContext): Promise<string | undefined> {
    if (typeof req.path === 'string' && PORTAL_PATH.test(req.path)) {
      const slug = req.params['firmSlug'];
      if (typeof slug !== 'string' || slug.length === 0) return undefined;
      const b = await this.db
        .forPlatform()
        .business.findUnique({ where: { slug: slug.toLowerCase() }, select: { id: true } });
      return b?.id;
    }

    const header = req.get('x-business-id');
    if (header) return UUID.test(header) ? header : undefined;

    const own = this.db.forUser(auth.userId);
    const firms =
      auth.pool === 'STAFF'
        ? await own.membership.findMany({
            where: { status: 'ACTIVE' },
            select: { businessId: true },
          })
        : auth.pool === 'CLIENT'
          ? await own.clientAccount.findMany({
              where: { status: 'ACTIVE' },
              select: { businessId: true },
            })
          : [];
    if (firms.length === 1) return firms[0]?.businessId;
    if (firms.length === 0) return undefined;
    throw new BadRequestException({
      code: 'BUSINESS_REQUIRED',
      message: 'Choose a firm: send the x-business-id header',
    });
  }

  private async membership(
    auth: AuthContext,
    businessId: string,
  ): Promise<TenantContext | undefined> {
    const firm = this.db.forBusiness(businessId);
    if (auth.pool === 'STAFF') {
      const m = await firm.membership.findFirst({
        where: { userId: auth.userId, status: 'ACTIVE' },
        select: { role: true },
      });
      return m ? { businessId, role: m.role, kind: 'staff' } : undefined;
    }
    if (auth.pool === 'CLIENT') {
      const c = await firm.clientAccount.findFirst({
        where: { userId: auth.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      return c ? { businessId, role: 'CLIENT', kind: 'client', clientAccountId: c.id } : undefined;
    }
    // ADMIN: firm data only through an owner-approved support grant (Tumit, Sprint 3).
    return undefined;
  }
}
