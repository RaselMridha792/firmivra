// R12 step 4: the audit log viewer's pure helpers (range, action filter, cursor, actor, entry).
import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { AuditEntry, AuditLogQuery } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import {
  actionFilter,
  actorOf,
  type CursorScope,
  decodeCursor,
  encodeCursor,
  FIRMIVRA_SUPPORT,
  type KnownActors,
  likeEscape,
  metadataOf,
  resolveRange,
  toEntry,
  viewedMetadata,
} from '../../src/audit-viewer/audit-log.logic.js';

const STAFF_ID = '0199b6a1-0000-7000-8000-000000000001';
const CLIENT_ID = '0199b6a1-0000-7000-8000-000000000002';
const ADMIN_ID = '0199b6a1-0000-7000-8000-000000000003';
const ADMIN_LOGIN_ID = '0199b6a1-0000-7000-8000-000000000004';
const STRANGER_ID = '0199b6a1-0000-7000-8000-000000000005';

const known: KnownActors = {
  supportAdmins: new Set([ADMIN_ID]),
  people: new Map([
    [STAFF_ID, { pool: 'STAFF', name: 'Fake Staff' }],
    [CLIENT_ID, { pool: 'CLIENT', name: 'Fake Client' }],
    [ADMIN_LOGIN_ID, { pool: 'ADMIN', name: 'Fake Admin' }],
  ]),
};

describe('resolveRange', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');

  it('is the last 30 days without from and to', () => {
    expect(resolveRange({}, now)).toEqual({ from: new Date('2026-09-08T12:00:00.000Z'), to: now });
  });

  it("takes the query's range, kept inside the dates PostgreSQL stores", () => {
    expect(
      resolveRange({ from: '2026-01-01T00:00:00+02:00', to: '2026-02-01T00:00:00Z' }, now),
    ).toEqual({
      from: new Date('2025-12-31T22:00:00.000Z'),
      to: new Date('2026-02-01T00:00:00.000Z'),
    });
    const old = resolveRange({ from: '0000-01-01T00:00:00Z', to: '0000-06-01T00:00:00Z' }, now);
    expect(old.from.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(old.to.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('actionFilter', () => {
  it('matches an action exactly, or every action under a prefix ending in "."', () => {
    expect(actionFilter(undefined)).toEqual({});
    expect(actionFilter('client.created')).toEqual({ action: { equals: 'client.created' } });
    expect(actionFilter('client_account.')).toEqual({
      action: { startsWith: 'client\\_account.' },
    });
  });

  it('makes LIKE wildcards plain', () => {
    expect(likeEscape('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
  });
});

describe('paging cursor', () => {
  const key = new Uint8Array(32).fill(7);
  const scope: CursorScope = {
    businessId: '0199b6a1-0000-7000-8000-0000000000b1',
    userId: STAFF_ID,
    filters: { action: 'client.' },
  };
  const row = { createdAt: new Date('2026-10-07T12:00:00.123Z'), id: STAFF_ID };
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  /** Any position signed as the server signs it for `scope` (only the server's key can). */
  const signed = (position: string) => {
    const bound = [scope.businessId, STAFF_ID, null, null, 'client.', null, null, null, position];
    const mac = createHmac('sha256', key).update(JSON.stringify(bound)).digest('base64url');
    return `${b64(position)}.${mac}`;
  };

  it('round-trips the last row for the same firm, reader and filters', () => {
    const cursor = encodeCursor(row, key, scope);
    expect(cursor).toBe(signed('2026-10-07T12:00:00.123Z|' + STAFF_ID));
    expect(cursor.length).toBeLessThanOrEqual(200);
    expect(decodeCursor(cursor, key, scope)).toEqual(row);
    // The page size is not bound: a later page may ask for more or fewer rows.
    const later = { ...scope.filters, limit: 10, cursor };
    expect(decodeCursor(cursor, key, { ...scope, filters: later })).toEqual(row);
  });

  it('refuses a cursor for another firm, reader, filter set or key (400)', () => {
    const cursor = encodeCursor(row, key, scope);
    for (const other of [
      { ...scope, businessId: '0199b6a1-0000-7000-8000-0000000000b2' },
      { ...scope, userId: CLIENT_ID },
      { ...scope, filters: {} },
      { ...scope, filters: { action: 'client.created' } },
      { ...scope, filters: { ...scope.filters, entityId: 'abc' } },
      {
        ...scope,
        filters: { ...scope.filters, from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' },
      },
    ]) {
      expect(() => decodeCursor(cursor, key, other), JSON.stringify(other)).toThrow(
        BadRequestException,
      );
    }
    expect(() => decodeCursor(cursor, new Uint8Array(32).fill(8), scope)).toThrow(
      BadRequestException,
    );
  });

  it('refuses a crafted or changed cursor with 400', () => {
    const real = encodeCursor(row, key, scope);
    const [position, mac] = real.split('.') as [string, string];
    const far = b64(`9999-12-31T23:59:59.999Z|ffffffff-ffff-4fff-bfff-ffffffffffff`);
    for (const bad of [
      '',
      'not a cursor',
      'abc\u0000',
      position,
      `${far}.${mac}`,
      `${position}.${mac.slice(0, -1)}`,
      `${position}.${mac}A`,
      `${position}.${mac}.${mac}`,
      `${b64('2026-10-07T12:00:00.124Z')}${position}.${mac}`,
      b64(`2026-10-07T12:00:00.000Z|${STAFF_ID}`),
    ]) {
      expect(() => decodeCursor(bad, key, scope), bad).toThrow(BadRequestException);
    }
  });

  it('refuses a signed position encodeCursor never writes (400)', () => {
    for (const position of [
      '2026-10-07|nope',
      `2026-10-07T12:00:00Z|${STAFF_ID}`,
      `-100000-01-01T00:00:00.000Z|${STAFF_ID}`,
      `0000-01-01T00:00:00.000Z|${STAFF_ID}`,
      `2026-02-30T00:00:00.000Z|${STAFF_ID}`,
      `2026-10-07T12:00:00.000Z|${STAFF_ID}|x`,
      `2026-10-07T12:00:00.000Z|${STAFF_ID}\u0000`,
      `2026-10-07T12:00:00.000Z|\ud800`,
    ]) {
      expect(() => decodeCursor(signed(position), key, scope), position).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('actorOf', () => {
  it('names the firm’s staff and clients', () => {
    expect(actorOf(STAFF_ID, known)).toEqual({
      actor: { kind: 'STAFF', userId: STAFF_ID, name: 'Fake Staff' },
      hideIp: false,
    });
    expect(actorOf(CLIENT_ID, known).actor).toEqual({
      kind: 'CLIENT',
      userId: CLIENT_ID,
      name: 'Fake Client',
    });
  });

  it('shows a Super Admin only as Firmivra Support, without the IP', () => {
    expect(actorOf(ADMIN_ID, known)).toEqual({ actor: FIRMIVRA_SUPPORT, hideIp: true });
    expect(actorOf(ADMIN_LOGIN_ID, known)).toEqual({ actor: FIRMIVRA_SUPPORT, hideIp: true });
  });

  it('null for the system; null without the IP for someone the firm cannot see', () => {
    expect(actorOf(null, known)).toEqual({ actor: null, hideIp: false });
    expect(actorOf(STRANGER_ID, known)).toEqual({ actor: null, hideIp: true });
  });
});

describe('toEntry', () => {
  const row = {
    id: '0199b6a1-0000-7000-8000-0000000000aa',
    createdAt: new Date('2026-10-07T12:00:00.000Z'),
    action: 'client.viewed',
    entityType: 'client',
    entityId: 'abc',
    metadata: null,
    ip: '203.0.113.9',
    requestId: 'req-1',
  };

  it('answers the contract’s shape; metadata {} when none', () => {
    const entry = toEntry({ ...row, actorUserId: STAFF_ID }, known);
    expect(AuditEntry.parse(entry)).toEqual(entry);
    expect(entry.metadata).toEqual({});
    expect(entry.ip).toBe('203.0.113.9');
  });

  it('a Firmivra Support row passes the contract (no IP)', () => {
    const entry = toEntry({ ...row, actorUserId: ADMIN_ID }, known);
    expect(AuditEntry.safeParse(entry).success).toBe(true);
    expect(entry.ip).toBeNull();
  });

  it('metadata is always an object', () => {
    expect(metadataOf(undefined)).toEqual({});
    expect(metadataOf({ a: 1 })).toEqual({ a: 1 });
    expect(metadataOf([1])).toEqual({ value: [1] });
    expect(metadataOf('x')).toEqual({ value: 'x' });
  });
});

describe('viewedMetadata', () => {
  it('records the filters as read', () => {
    const q = AuditLogQuery.parse({ action: 'client.', entityType: 'client', limit: '10' });
    const range = {
      from: new Date('2026-09-08T12:00:00.000Z'),
      to: new Date('2026-10-08T12:00:00.000Z'),
    };
    expect(viewedMetadata(q, range)).toEqual({
      from: '2026-09-08T12:00:00.000Z',
      to: '2026-10-08T12:00:00.000Z',
      defaultRange: true,
      action: 'client.',
      entityType: 'client',
      limit: 10,
    });
  });

  it('keeps the record filter only when it is an id, never free text', () => {
    const range = { from: new Date(0), to: new Date(1000) };
    const id = AuditLogQuery.parse({ entityId: CLIENT_ID });
    expect(viewedMetadata(id, range)).toMatchObject({ entityId: CLIENT_ID });
    for (const text of ['000-00-0000', 'someone@example.test', 'thing-1']) {
      const meta = viewedMetadata(AuditLogQuery.parse({ entityId: text }), range);
      expect(meta).toMatchObject({ entityIdText: true });
      expect(JSON.stringify(meta)).not.toContain(text);
    }
  });
});
