import type { Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import type { MetadataScanner, Reflector } from '@nestjs/core';
import { isPublicRoute, rolesOfRoute, TENANT_ROLES } from './decorators.js';

const paths = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value ?? '']).map((p) => String(p).replace(/^\/+|\/+$/g, ''));

/**
 * Routes whose access rules cannot work as written. The API refuses to start with any of these:
 * - SUPER_ADMIN outside /api/v1/admin/, or a firm role inside it (src/auth/site.ts);
 * - AUTHENTICATED inside /api/v1/admin/: it passes before platform_admins is checked, so a
 *   removed Super Admin would keep access until their token expires. Use SUPER_ADMIN;
 * - @Public() and @Roles() on the same route: @Public() wins (also from the class), so the
 *   roles would silently never be checked.
 */
export function routeSiteProblems(
  controllers: Type[],
  reflector: Reflector,
  scanner: MetadataScanner,
): string[] {
  const problems: string[] = [];
  for (const controller of controllers) {
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (methodPath === undefined) continue; // not a route
      const routePaths = paths(Reflect.getMetadata(PATH_METADATA, controller)).flatMap((base) =>
        paths(methodPath).map((sub) => [base, sub].filter(Boolean).join('/')),
      );
      const label = (path: string) => `${controller.name}.${name} (/${path})`;
      const roles = rolesOfRoute(reflector, handler, controller);
      if (isPublicRoute(reflector, handler, controller)) {
        if (roles?.length) {
          problems.push(`${label(routePaths[0] ?? '')}: both @Public() and @Roles()`);
        }
        continue;
      }
      if (!roles?.length) continue; // default deny handles it

      const hasFirmRole = roles.some((r) => (TENANT_ROLES as readonly string[]).includes(r));
      for (const path of routePaths) {
        const admin = /^admin(\/|$)/i.test(path); // any case, like routing and siteOf()
        if (admin && hasFirmRole) problems.push(`${label(path)}: firm role on a Super Admin route`);
        if (admin && roles.includes('AUTHENTICATED')) {
          problems.push(`${label(path)}: AUTHENTICATED on a Super Admin route (use SUPER_ADMIN)`);
        }
        if (!admin && roles.includes('SUPER_ADMIN')) {
          problems.push(`${label(path)}: SUPER_ADMIN outside /admin/`);
        }
      }
    }
  }
  return problems;
}
