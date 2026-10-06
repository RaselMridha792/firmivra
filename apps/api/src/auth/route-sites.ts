import type { Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import type { MetadataScanner, Reflector } from '@nestjs/core';
import { isPublicRoute, rolesOfRoute, TENANT_ROLES } from './decorators.js';

const paths = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value ?? '']).map((p) => String(p).replace(/^\/+|\/+$/g, ''));

/**
 * Routes whose @Roles() can never work on their site (src/auth/site.ts): SUPER_ADMIN outside
 * /api/v1/admin/, or a firm role inside it. The API refuses to start with any of these.
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
      if (isPublicRoute(reflector, handler, controller)) continue;
      const roles = rolesOfRoute(reflector, handler, controller);
      if (!roles?.length) continue; // default deny handles it

      const hasFirmRole = roles.some((r) => (TENANT_ROLES as readonly string[]).includes(r));
      for (const base of paths(Reflect.getMetadata(PATH_METADATA, controller))) {
        for (const sub of paths(methodPath)) {
          const path = [base, sub].filter(Boolean).join('/');
          const admin = /^admin(\/|$)/i.test(path); // any case, like routing and siteOf()
          const route = `${controller.name}.${name} (/${path})`;
          if (admin && hasFirmRole) problems.push(`${route}: firm role on a Super Admin route`);
          if (!admin && roles.includes('SUPER_ADMIN')) {
            problems.push(`${route}: SUPER_ADMIN outside /admin/`);
          }
        }
      }
    }
  }
  return problems;
}
