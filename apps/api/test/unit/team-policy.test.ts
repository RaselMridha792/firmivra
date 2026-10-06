import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { checkTeamAuthority } from '../../src/team/team.service.js';
import { encodeCursor, decodeCursor } from '../../src/firm-common/context.js';
describe('team escalation and cursor boundaries', () => {
  it('blocks administrators from managing owners or peer administrators', () => {
    expect(() => checkTeamAuthority('ADMIN', 'OWNER')).toThrow();
    expect(() => checkTeamAuthority('ADMIN', 'ADMIN', 'STAFF')).toThrow();
    expect(() => checkTeamAuthority('ADMIN', 'STAFF', 'OWNER')).toThrow();
    expect(() => checkTeamAuthority('ADMIN', 'STAFF', 'ADMIN')).not.toThrow();
    expect(() => checkTeamAuthority('OWNER', 'ADMIN', 'OWNER')).not.toThrow();
  });
  it('binds cursors to firm, caller and filters while keeping long searches bounded', () => {
    const ctx = { businessId: randomUUID(), userId: randomUUID() };
    const filters = { kind: 'team', search: 'synthetic '.repeat(20) };
    const cursor = encodeCursor(ctx, filters, { id: randomUUID(), createdAt: new Date() });
    expect(cursor.length).toBeLessThan(500);
    expect(decodeCursor(cursor, ctx, filters)).toBeTruthy();
    expect(() => decodeCursor(cursor, { ...ctx, businessId: randomUUID() }, filters)).toThrow();
    expect(() => decodeCursor(cursor, { ...ctx, userId: randomUUID() }, filters)).toThrow();
    expect(() => decodeCursor(cursor, ctx, { kind: 'other' })).toThrow();
    expect(() => decodeCursor('garbage', ctx, filters)).toThrow();
  });
});
