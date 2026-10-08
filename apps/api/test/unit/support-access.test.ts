import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeOffset, encodeOffset, statusOf } from '../../src/support-access/grants.js';

const now = Date.parse('2026-10-13T14:00:00.000Z');
const at = (msFromNow: number) => new Date(now + msFromNow);
const owner = '0199b6e0-0000-7000-8000-000000000101';

describe('support access status', () => {
  it('is derived from the row: asked, approved, declined, revoked, expired', () => {
    const row = (fields: Partial<Parameters<typeof statusOf>[0]> = {}) => ({
      grantedByUserId: null,
      expiresAt: null,
      revokedAt: null,
      ...fields,
    });
    const approved = { grantedByUserId: owner, expiresAt: at(60_000) };
    expect(statusOf(row(), now)).toBe('PENDING');
    expect(statusOf(row({ revokedAt: at(-1) }), now)).toBe('DECLINED');
    expect(statusOf(row(approved), now)).toBe('ACTIVE');
    expect(statusOf(row({ ...approved, revokedAt: at(-1) }), now)).toBe('REVOKED');
    // The expiry moment itself is over, as `expires_at > now()` says in SQL.
    expect(statusOf(row({ ...approved, expiresAt: at(0) }), now)).toBe('EXPIRED');
    expect(statusOf(row({ ...approved, expiresAt: at(-1) }), now)).toBe('EXPIRED');
    // Revoked stays revoked after the expiry.
    expect(statusOf(row({ ...approved, expiresAt: at(-1), revokedAt: at(-2) }), now)).toBe(
      'REVOKED',
    );
  });
});

describe('support access paging', () => {
  it('round-trips an offset through an opaque cursor', () => {
    for (const offset of [0, 1, 25, 999_999]) {
      const cursor = encodeOffset(offset);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(cursor).not.toContain(String(offset));
      expect(decodeOffset(cursor)).toBe(offset);
    }
    expect(decodeOffset(undefined)).toBe(0);
  });

  it('refuses any other cursor with 400', () => {
    const encoded = (text: string) => Buffer.from(text).toString('base64url');
    for (const bad of [
      '',
      'nope',
      encoded('o:-1'),
      encoded('o:1234567'),
      encoded('x:1'),
      encoded('o:1 '),
      encoded('o:'),
    ]) {
      expect(() => decodeOffset(bad), bad).toThrow(BadRequestException);
    }
  });
});
