import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type BusinessStatus,
  FIRM_ROLES,
  type PermissionCapability,
  type PermissionModule,
} from '@firmivra/types';
import type { AuthContext, TenantContext, TenantRole } from '../common/request-context.js';

/**
 * - Firm roles (OWNER, ADMIN, STAFF, CLIENT): TenantGuard resolves the firm and the caller's role.
 * - SUPER_ADMIN: a Firmivra platform admin (admins pool + platform_admins row). Never firm data.
 * - AUTHENTICATED: any signed-in user, no firm (for example GET /me).
 */
export type Role = TenantRole | 'SUPER_ADMIN' | 'AUTHENTICATED';
export const TENANT_ROLES: readonly TenantRole[] = [...FIRM_ROLES, 'CLIENT'];

/** Everyone who works at the firm: `@Roles(...FIRM_STAFF)`. */
export const FIRM_STAFF = ['OWNER', 'ADMIN', 'STAFF'] as const satisfies readonly Role[];
/** Those who manage the firm (team, settings): `@Roles(...FIRM_MANAGERS)`. */
export const FIRM_MANAGERS = ['OWNER', 'ADMIN'] as const satisfies readonly Role[];

/**
 * The permission grid entry a route belongs to (packages/types team/permissions.ts). Owner, Admin
 * and Staff are let in by `@Roles(...)` as always; Manager, Bookkeeper, Tax Preparer, Client
 * Support and Read Only get in only where this says their grid allows it. Put it on a controller
 * for its module (the capability then follows the HTTP method: GET views, POST creates, PUT and
 * PATCH edit, DELETE deletes) or on a route to name the capability. It opens only routes whose
 * `@Roles` include STAFF: a route for Owner and Admin alone stays closed to them. A route
 * without it is closed to the five roles.
 */
export interface RouteAccess {
  module: PermissionModule;
  capability?: PermissionCapability;
}
export const Access = (module: PermissionModule, capability?: PermissionCapability) =>
  SetMetadata(ACCESS_KEY, { module, capability } satisfies RouteAccess);

const PUBLIC_KEY = 'firmivra:public';
const ACCESS_KEY = 'firmivra:access';
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

export function accessFor(reflector: Reflector, ctx: ExecutionContext): RouteAccess | undefined {
  return reflector.getAllAndOverride<RouteAccess | undefined>(ACCESS_KEY, [
    ctx.getHandler(),
    ctx.getClass(),
  ]);
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
