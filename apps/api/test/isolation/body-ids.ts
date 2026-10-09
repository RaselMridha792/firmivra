// The record ids a route's body names, read from its zod schema, for the isolation suite's body
// swaps. It fails closed: a zod type it can't read throws, and a body it can't find a schema for
// is reported, so a new kind of body can't slip past the sweep with no ids found.
import type { Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';

export interface BodyIdField {
  /** Dotted for a nested field (`related.id`); `*` stands for any key of a record. */
  path: string;
  /** The field takes a list of ids. */
  list: boolean;
}

/**
 * Body uuids that name no record, each tied to the routes that send it, and why. Any other uuid,
 * and any field named `...Id`, `...Ids` or `ids`, is a record id and needs the case's `bodyIds`.
 */
export const NOT_RECORDS: { field: string; routes: RegExp; why: string }[] = [
  {
    field: 'idempotencyKey',
    routes: /./,
    why: 'a key the client makes up so a retry is not done twice; it names no record (#209, #222)',
  },
  {
    field: 'related.id',
    routes: /^POST \/api\/v1\/business\/clients\/:id\/message-threads$/,
    why: 'echoed back on the thread as a link; the service never reads the record it names',
  },
];

// A uuid field not named like an id is found by its zod format (`z.uuid()`, `.uuid()`); one checked
// only by a regex (`z.string().regex(...)`) is missed.
const ID_NAME = /(Id|Ids)$|^ids$/;
const UUID_FORMATS = new Set(['uuid', 'guid']);
/** Types with nothing inside: no field, so no id field. */
const LEAVES = new Set([
  'string',
  'number',
  'int',
  'bigint',
  'boolean',
  'date',
  'enum',
  'literal',
  'null',
  'undefined',
  'nan',
  'never',
  'void',
  'template_literal',
  'transform',
]);
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'catch',
  'nonoptional',
]);

type Def = Record<string, unknown> & { type?: string };
const defOf = (schema: unknown): Def | undefined =>
  (schema as { _zod?: { def?: Def } } | undefined)?._zod?.def;

/** Is the schema, under its wrappers, a uuid (`many`: a list of them)? */
function isUuid(schema: unknown, many = false): boolean {
  const def = defOf(schema);
  if (!def) return false;
  if (WRAPPERS.has(def.type ?? '')) return isUuid(def.innerType, many);
  if (def.type === 'pipe') return isUuid(def.in, many) || isUuid(def.out, many);
  if (def.type === 'array') return !many && isUuid(def.element, true);
  if (def.type !== 'string') return false;
  const formats = [def.format, ...((def.checks as unknown[]) ?? []).map((c) => defOf(c)?.format)];
  return formats.some((f) => UUID_FORMATS.has(String(f)));
}

/** Is it, under its wrappers, a list? */
function isList(schema: unknown): boolean {
  const def = defOf(schema);
  if (WRAPPERS.has(def?.type ?? '')) return isList(def?.innerType);
  if (def?.type === 'pipe') return isList(def.in) || isList(def.out);
  return def?.type === 'array';
}

/** The record-id fields of a zod schema. Throws on a type it can't look inside. */
export function idFields(schema: unknown, path = '', depth = 0): BodyIdField[] {
  const def = defOf(schema);
  const type = def?.type ?? String(schema);
  // A lazy schema that refers to itself ends here too: deeper than any body the API takes.
  if (!def) throw new Error(`${path || 'body'}: cannot read zod type ${type}`);
  if (depth > 20) throw new Error(`${path || 'body'}: deeper than 20 levels (a recursive schema?)`);
  const inner = (s: unknown, p = path) => idFields(s, p, depth + 1);
  const at = (key: string) => (path ? `${path}.${key}` : key);
  // A uuid anywhere (in a union, a record, a tuple, a list of lists) is a record id.
  if (isUuid(schema)) return [{ path: path || '*', list: isList(schema) }];
  if (LEAVES.has(type)) return [];
  if (WRAPPERS.has(type)) return inner(def.innerType);
  switch (type) {
    case 'object': {
      const shape = Object.entries(def.shape as Record<string, unknown>);
      const open = def.catchall !== undefined && defOf(def.catchall)?.type !== 'never';
      return dedupe([
        ...shape.flatMap(([key, field]) =>
          ID_NAME.test(key) || isUuid(field)
            ? [{ path: at(key), list: isList(field) }]
            : inner(field, at(key)),
        ),
        ...(open ? inner(def.catchall, at('*')) : []),
      ]);
    }
    case 'pipe':
      // A custom check in front of a readable shape (contract B's answers): the shape is the body.
      if (defOf(def.in)?.type === 'custom') return inner(def.out);
      return dedupe([...inner(def.in), ...inner(def.out)]);
    case 'array':
      return inner(def.element);
    case 'union':
      return dedupe((def.options as unknown[]).flatMap((o) => inner(o)));
    case 'intersection':
      return dedupe([...inner(def.left), ...inner(def.right)]);
    case 'lazy':
      return inner((def.getter as () => unknown)());
    case 'tuple':
      return dedupe(
        [...(def.items as unknown[]), ...(def.rest ? [def.rest] : [])].flatMap((s) => inner(s)),
      );
    case 'record':
      return inner(def.valueType, at('*'));
    default:
      throw new Error(`${path || 'body'}: cannot read zod type ${type}`);
  }
}

const dedupe = (fields: BodyIdField[]) => [...new Map(fields.map((f) => [f.path, f])).values()];

/**
 * The route's body id fields, less NOT_RECORDS, from its `@Body` args' zod pipes; or why the
 * suite can't read them. A bare `@Body()` next to one with a zod schema is fine (appointment
 * types read which keys were sent); a body with no readable schema, or one property read alone
 * (`@Body('clientId')`), is not.
 */
export function bodyIdFields(
  controller: Type,
  handlerName: string,
  key: string,
): { fields: BodyIdField[]; unreadable?: string } {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {}) as Record<
    string,
    { data?: unknown; pipes?: unknown[] }
  >;
  const bodies = Object.entries(args)
    .filter(([k]) => k.split(':')[0] === String(RouteParamtypes.BODY))
    .map(([, arg]) => arg);
  if (bodies.length === 0) return { fields: [] };
  const unreadable = 'the body has no zod schema the suite can read';
  if (bodies.some((b) => b.data !== undefined)) return { fields: [], unreadable };
  const schemas = bodies
    .flatMap((b) => b.pipes ?? [])
    .map((pipe) => (pipe as { schema?: unknown }).schema)
    .filter((s) => defOf(s));
  if (schemas.length === 0) return { fields: [], unreadable };
  try {
    const fields = dedupe(schemas.flatMap((s) => idFields(s)));
    const exempt = (f: BodyIdField) =>
      NOT_RECORDS.some((n) => n.field === f.path && n.routes.test(key));
    return { fields: fields.filter((f) => !exempt(f)) };
  } catch (error) {
    return { fields: [], unreadable: `${unreadable}: ${(error as Error).message}` };
  }
}
