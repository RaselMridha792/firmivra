// Every route the API serves, read from Nest's own metadata at test time, so a route added
// later shows up here with no list to update (R8 step 2).
import type { INestApplication, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { isPublicRoute, rolesOfRoute } from '../../src/auth/decorators.js';

export interface ApiRoute {
  /** "FirmSupportAccessController.approve" */
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Full path with the global prefix and Express params, e.g. /api/v1/business/clients/:id */
  path: string;
  roles: string[];
  isPublic: boolean;
  /** For reading the route's own metadata (a rate limit, for example). */
  handler: (...args: unknown[]) => unknown;
  controller: Type;
}

const parts = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value ?? '']).map((p) => String(p).replace(/^\/+|\/+$/g, ''));

export function apiRoutes(app: INestApplication): ApiRoute[] {
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const controllers = new Set<Type>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (wrapper.metatype) controllers.add(wrapper.metatype as Type);
    }
  }
  const routes: ApiRoute[] = [];
  for (const controller of controllers) {
    const proto = controller.prototype as Record<string, unknown>;
    for (const handlerName of scanner.getAllMethodNames(proto)) {
      const handler = proto[handlerName];
      if (typeof handler !== 'function') continue;
      const sub: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (sub === undefined) continue;
      const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(verb ?? '')) continue;
      for (const base of parts(Reflect.getMetadata(PATH_METADATA, controller))) {
        for (const tail of parts(sub)) {
          routes.push({
            name: `${controller.name}.${handlerName}`,
            method: verb as ApiRoute['method'],
            path: `/api/v1/${[base, tail].filter(Boolean).join('/')}`,
            roles: rolesOfRoute(reflector, handler, controller) ?? [],
            isPublic: isPublicRoute(reflector, handler, controller),
            handler: handler as ApiRoute['handler'],
            controller,
          });
        }
      }
    }
  }
  return routes;
}

/** The route's path with each `:param` filled from `values`, else a fresh random uuid. */
export function fillPath(path: string, values: Record<string, string>, random: () => string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => values[name] ?? random());
}
