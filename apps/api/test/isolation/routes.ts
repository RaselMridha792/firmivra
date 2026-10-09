// Every route the API serves, read from Nest's own metadata at test time, so a route added
// later shows up here with no list to update (R8 step 2).
import type { INestApplication, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
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
  /** The body fields that name a record (`clientId`, `staffUserId`, `ids`), from its zod pipe. */
  bodyIdFields: string[];
}

const ID_FIELD = /(Id|Ids)$|^ids$/;

/** The dotted paths of the fields of a zod schema that name a record. */
export function idFields(schema: unknown, path = ''): string[] {
  const def = (schema as { _zod?: { def?: Record<string, unknown> } } | undefined)?._zod?.def;
  const at = (key: string) => (path ? `${path}.${key}` : key);
  switch (def?.type) {
    case 'object':
      return Object.entries(def.shape as Record<string, unknown>).flatMap(([key, field]) =>
        ID_FIELD.test(key) ? [at(key)] : idFields(field, at(key)),
      );
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
      return idFields(def.innerType, path);
    case 'pipe':
      return [...new Set([...idFields(def.in, path), ...idFields(def.out, path)])];
    case 'array':
      return idFields(def.element, path);
    case 'union':
      return [...new Set((def.options as unknown[]).flatMap((o) => idFields(o, path)))];
    default:
      return [];
  }
}

/** The record-id fields of the route's `@Body` schema (a ZodValidationPipe's `schema`). */
function bodyIdFields(controller: Type, handlerName: string): string[] {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {}) as Record<
    string,
    { pipes?: unknown[] }
  >;
  return Object.entries(args)
    .filter(([key]) => key.split(':')[0] === String(RouteParamtypes.BODY))
    .flatMap(([, arg]) => arg.pipes ?? [])
    .flatMap((pipe) => idFields((pipe as { schema?: unknown }).schema));
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
            bodyIdFields: bodyIdFields(controller, handlerName),
          });
        }
      }
    }
  }
  return routes;
}

/** The route's `:param` names, in order. */
export const paramsOf = (path: string): string[] =>
  [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);

/**
 * The route's path with each `:param` filled from `values`. An unknown param throws, so a new
 * route can't pass with a random id in place of a record; sweeps that only check a refusal pass
 * `fallback`.
 */
export function fillPath(path: string, values: Record<string, string>, fallback?: () => string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = values[name] ?? fallback?.();
    if (value === undefined) throw new Error(`${path}: no value for :${name}`);
    return value;
  });
}
