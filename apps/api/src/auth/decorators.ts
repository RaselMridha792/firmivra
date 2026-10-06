import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { BusinessStatus } from '@firmivra/types';
import type { AuthContext, TenantContext, TenantRole } from '../common/request-context.js';

/**
 * - Firm roles (OWNER, ADMIN, STAFF, CLIENT): TenantGuard resolves the firm and the caller's role.
 * - SUPER_ADMIN: a Firmivra platform admin (admins pool + platform_admins row). Never firm data.
 * - AUTHENTICATED: any signed-in user, no firm (for example GET /me).
 */
export type Role = TenantRole | 'SUPER_ADMIN' | 'AUTHENTICATED';
export const TENANT_ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN', 'STAFF', 'CLIENT'];

/** Everyone who works at the firm: `@Roles(...FIRM_STAFF)`. */
export const FIRM_STAFF = ['OWNER', 'ADMIN', 'STAFF'] as const satisfies readonly Role[];
/** Those who manage the firm (team, settings): `@Roles(...FIRM_MANAGERS)`. */
export const FIRM_MANAGERS = ['OWNER', 'ADMIN'] as const satisfies readonly Role[];

const PUBLIC_KEY = 'firmivra:public';
const ROLES_KEY = 'firmivra:roles';
const BUSINESS_STATUSES_KEY = 'firmivra:business-statuses';

/** Firm routes work only while the firm is ACTIVE, unless the route allows other statuses. */
export const DEFAULT_BUSINESS_STATUSES: readonly BusinessStatus[] = ['ACTIVE'];

/** No sign-in needed (health, local dev sign-in, public forms). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Who may call the route. Required on every non-public route: routes without it are denied. */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(ROLES_KEY, roles);

/**
 * Firm statuses in which a firm route works, for example the setup wizard after Super Admin
 * approval: `@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')`. Replaces the ACTIVE default.
 */
export const AllowBusinessStatuses = (...statuses: [BusinessStatus, ...BusinessStatus[]]) =>
  SetMetadata(BUSINESS_STATUSES_KEY, statuses);

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- Nest metadata targets
type Target = Function;

export function isPublicRoute(reflector: Reflector, handler: Target, cls: Target): boolean {
  return reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [handler, cls]) === true;
}

export function rolesOfRoute(
  reflector: Reflector,
  handler: Target,
  cls: Target,
): Role[] | undefined {
  return reflector.getAllAndOverride<Role[]>(ROLES_KEY, [handler, cls]);
}

export function isPublic(reflector: Reflector, ctx: ExecutionContext): boolean {
  return isPublicRoute(reflector, ctx.getHandler(), ctx.getClass());
}

export function rolesFor(reflector: Reflector, ctx: ExecutionContext): Role[] | undefined {
  return rolesOfRoute(reflector, ctx.getHandler(), ctx.getClass());
}

export function businessStatusesFor(
  reflector: Reflector,
  ctx: ExecutionContext,
): readonly BusinessStatus[] {
  return (
    reflector.getAllAndOverride<BusinessStatus[]>(BUSINESS_STATUSES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]) ?? DEFAULT_BUSINESS_STATUSES
  );
}

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().auth,
);

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().tenant,
);
