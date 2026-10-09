import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { AuditActor, AuditEntry, AuditLogQuery } from '@firmivra/types';
import type { z } from 'zod';

/** The parsed query (defaults applied). */
export type AuditLogFilters = z.output<typeof AuditLogQuery>;

const DAY_MS = 24 * 60 * 60_000;
/** Without from and to: the last 30 days. */
export const DEFAULT_RANGE_DAYS = 30;
/**
 * The range the database is asked for is kept inside these bounds: no audit row is older or
 * newer, and PostgreSQL refuses some dates JavaScript accepts (year 0, years before 4713 BC).
 */
const FLOOR = new Date('1970-01-01T00:00:00.000Z');
const CEILING = new Date('9999-12-31T23:59:59.999Z');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Exactly what `Date.toISOString()` writes for a four-digit year. */
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const badCursor = () =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The cursor is not valid' });

const clamp = (d: Date) => (d < FLOOR ? FLOOR : d > CEILING ? CEILING : d);

/** The dates to read: the query's (both or neither, checked by the contract) or the last 30 days. */
export function resolveRange(q: Pick<AuditLogFilters, 'from' | 'to'>, now: Date) {
  if (q.from !== undefined && q.to !== undefined) {
    return { from: clamp(new Date(q.from)), to: clamp(new Date(q.to)) };
  }
  return { from: new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS), to: now };
}

/** LIKE wildcards in the action prefix are plain characters (Prisma's `startsWith` does not escape). */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The action filter: an exact action, or every action under a prefix ending in ".". */
export function actionFilter(action: string | undefined) {
  if (action === undefined) return {};
  return action.endsWith('.')
    ? { action: { startsWith: likeEscape(action) } }
    : { action: { equals: action } };
}

/**
 * What a cursor is good for: one reader's read of one firm's log with these filters (not the page
 * size). Only a read whose first page wrote `audit_log.viewed` hands out a cursor, so a later
 * page is never a way to read without that row, and a cursor never moves to another firm, another
 * reader or other filters.
 */
export interface CursorScope {
  businessId: string;
  userId: string;
  filters: Pick<
    AuditLogFilters,
    'from' | 'to' | 'action' | 'actorUserId' | 'entityType' | 'entityId'
  >;
}

/** HMAC-SHA256 of the position and everything the cursor is bound to. */
function cursorMac(key: Uint8Array, scope: CursorScope, position: string): Buffer {
  const { from, to, action, actorUserId, entityType, entityId } = scope.filters;
  const filters = [from, to, action, actorUserId, entityType, entityId].map((v) => v ?? null);
  return createHmac('sha256', key)
    .update(JSON.stringify([scope.businessId, scope.userId, ...filters, position]))
    .digest();
}

/** Base64url position, ".", base64url MAC (32 bytes: 43 characters). */
const SIGNED_CURSOR = /^([A-Za-z0-9_-]{1,150})\.([A-Za-z0-9_-]{43})$/;

/**
 * The opaque paging cursor: the last row's time and id (rows are newest first, then by id),
 * signed with the server's key for `scope`.
 */
export function encodeCursor(
  row: { createdAt: Date; id: string },
  key: Uint8Array,
  scope: CursorScope,
): string {
  const position = `${row.createdAt.toISOString()}|${row.id}`;
  const mac = cursorMac(key, scope, position).toString('base64url');
  return `${Buffer.from(position).toString('base64url')}.${mac}`;
}

/**
 * Refuses (400) anything `encodeCursor` did not write for this firm, reader and filters, so a
 * crafted, changed or borrowed cursor never reaches SQL.
 */
export function decodeCursor(
  cursor: string,
  key: Uint8Array,
  scope: CursorScope,
): { createdAt: Date; id: string } {
  const [, encoded, mac] = SIGNED_CURSOR.exec(cursor) ?? [];
  if (encoded === undefined || mac === undefined) throw badCursor();
  const position = Buffer.from(encoded, 'base64url').toString('utf8');
  const given = Buffer.from(mac, 'base64url');
  const expected = cursorMac(key, scope, position);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw badCursor();
  const parts = position.split('|');
  const [at, id] = parts;
  if (parts.length !== 2 || !at || !id || !ISO_MS.test(at) || !UUID.test(id)) throw badCursor();
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== at) throw badCursor();
  if (createdAt < FLOOR || createdAt > CEILING) throw badCursor();
  return { createdAt, id: id.toLowerCase() };
}

/** What the database tells the firm about an actor id. */
export interface KnownActors {
  /** Super Admins with a support access request or grant for this firm. */
  supportAdmins: ReadonlySet<string>;
  /** The firm's own people (members and clients), as row-level security shows them. */
  people: ReadonlyMap<string, { pool: 'STAFF' | 'CLIENT' | 'ADMIN'; name: string }>;
}

export const FIRMIVRA_SUPPORT = {
  kind: 'PLATFORM',
  userId: null,
  name: 'Firmivra Support',
} as const satisfies AuditActor;

/**
 * Who did it, as the firm may see it:
 * - no actor: the system or a signed-out request (null);
 * - a Super Admin (support access for this firm, or an ADMIN login): Firmivra Support, never the
 *   person, and the IP is dropped;
 * - the firm's member or client: STAFF or CLIENT with their name;
 * - anyone else (not linked to this firm, for example the replaced login of an unfinished
 *   sign-up): null, and the IP is dropped too, since the firm cannot tell who it was.
 */
export function actorOf(
  actorUserId: string | null,
  known: KnownActors,
): { actor: AuditActor | null; hideIp: boolean } {
  if (actorUserId === null) return { actor: null, hideIp: false };
  if (known.supportAdmins.has(actorUserId)) return { actor: FIRMIVRA_SUPPORT, hideIp: true };
  const person = known.people.get(actorUserId);
  if (!person) return { actor: null, hideIp: true };
  if (person.pool === 'ADMIN') return { actor: FIRMIVRA_SUPPORT, hideIp: true };
  return { actor: { kind: person.pool, userId: actorUserId, name: person.name }, hideIp: false };
}

/** The stored row, without the user agent or the firm. */
export interface AuditRow {
  id: string;
  createdAt: Date;
  action: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  requestId: string | null;
}

/** Metadata is always an object: `{}` when the action recorded none. */
export function metadataOf(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

export function toEntry(row: AuditRow, known: KnownActors): AuditEntry {
  const { actor, hideIp } = actorOf(row.actorUserId, known);
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    action: row.action,
    actor,
    entity: { type: row.entityType, id: row.entityId },
    metadata: metadataOf(row.metadata),
    ip: hideIp ? null : row.ip,
    requestId: row.requestId,
  };
}

/**
 * What `audit_log.viewed` records: the filters as read, never the rows and never free text. The
 * record filter is the only free text (any line of up to 100 characters), so it is kept only when
 * it is an id (a UUID, as the log's records are); anything else is `entityIdText: true`, since a
 * reader may type anything there, an SSN or an email included (CLAUDE.md rule 4).
 */
export function viewedMetadata(q: AuditLogFilters, range: { from: Date; to: Date }) {
  const entity =
    q.entityId === undefined
      ? {}
      : UUID.test(q.entityId)
        ? { entityId: q.entityId }
        : { entityIdText: true };
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    defaultRange: q.from === undefined,
    ...(q.action !== undefined ? { action: q.action } : {}),
    ...(q.actorUserId !== undefined ? { actorUserId: q.actorUserId } : {}),
    ...(q.entityType !== undefined ? { entityType: q.entityType } : {}),
    ...entity,
    limit: q.limit,
  };
}
