import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthContext, TenantContext, TenantRole } from '../common/request-context.js';

/**
 * - Firm roles (OWNER, ADMIN, STAFF, CLIENT): TenantGuard resolves the firm and the caller's role.
 * - SUPER_ADMIN: a Firmivra platform admin (admins pool + platform_admins row). Never firm data.
 * - AUTHENTICATED: any signed-in user, no firm (for example GET /me).
 */
export type Role = TenantRole | 'SUPER_ADMIN' | 'AUTHENTICATED';
export const TENANT_ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN', 'STAFF', 'CLIENT'];

const PUBLIC_KEY = 'firmivra:public';
const ROLES_KEY = 'firmivra:roles';

/** No sign-in needed (health, local dev sign-in, public forms). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Who may call the route. Required on every non-public route: routes without it are denied. */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(ROLES_KEY, roles);

export function isPublic(reflector: Reflector, ctx: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]) === true
  );
}

export function rolesFor(reflector: Reflector, ctx: ExecutionContext): Role[] | undefined {
  return reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
}

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().auth,
);

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().tenant,
);
