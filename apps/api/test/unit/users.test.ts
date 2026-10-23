// Settings > Users & Roles (R55): role search, the export rows, and the export following every page.
import { describe, expect, it } from 'vitest';
import {
  EXPORT_HEADER,
  exportLine,
  rolesMatching,
  UsersService,
} from '../../src/staff/users.service.js';

describe('rolesMatching', () => {
  it('finds roles by any part of their name, and none for an empty search', () => {
    expect(rolesMatching('manag')).toEqual(['MANAGER']);
    expect(rolesMatching('  TAX ')).toEqual(['TAX_PREPARER']);
    expect(rolesMatching('o')).toEqual(
      expect.arrayContaining(['OWNER', 'BOOKKEEPER', 'READ_ONLY']),
    );
    expect(rolesMatching(undefined)).toEqual([]);
    expect(rolesMatching(' ')).toEqual([]);
  });
});

describe('exportLine', () => {
  const user = {
    id: '0199c1a0-0000-7000-8000-000000000001',
    userId: '0199c1a0-0000-7000-8000-000000000002',
    name: '=HYPERLINK("x")',
    email: 'pat@example.test',
    avatarUrl: null,
    jobTitle: null,
    departments: [],
    role: 'READ_ONLY' as const,
    accessLevel: 'STANDARD_USER' as const,
    status: 'INVITED' as const,
    lastLoginAt: null,
    mfa: 'PENDING' as const,
    invite: { sentAt: '2026-10-20T10:00:00.000Z', expiresAt: '2026-10-21T10:00:00.000Z' },
    isYou: false,
    company: 'Firm, Inc.',
  };
  it('writes the basic fields, quoted and safe from spreadsheet formulas', () => {
    expect(EXPORT_HEADER).toBe('Name,Email,Role,Company,Status,MFA,Last login,Invited');
    expect(exportLine(user)).toBe(
      `"'=HYPERLINK(""x"")",pat@example.test,Read Only,"Firm, Inc.",Pending,Pending,,2026-10-20T10:00:00.000Z`,
    );
  });
});

describe('the export', () => {
  // Octavia's review, section 2: one Export holds every matching page, whatever page is shown.
  const row = (n: number) => ({
    id: `0199c1a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    userId: `0199c1a0-0001-7000-8000-${String(n).padStart(12, '0')}`,
    name: `Person ${n}`,
    email: `p${n}@example.test`,
    avatarUrl: null,
    jobTitle: null,
    departments: [],
    role: 'STAFF' as const,
    accessLevel: 'STANDARD_USER' as const,
    status: (['ACTIVE', 'INVITED', 'LOCKED', 'DEACTIVATED'] as const)[n % 4],
    lastLoginAt: null,
    mfa: 'DISABLED' as const,
    invite: null,
    isYou: false,
  });
  const people = Array.from({ length: 250 }, (_, i) => row(i + 1));

  it('follows every page of 100 to the end, all statuses included, and logs the count', async () => {
    const pages: number[] = [];
    const staff = {
      list: async (_t: unknown, _u: unknown, q: { page: number; pageSize: number }) => {
        pages.push(q.page);
        const start = (q.page - 1) * q.pageSize;
        return {
          items: people.slice(start, start + q.pageSize),
          total: people.length,
          page: q.page,
          pageSize: q.pageSize,
        };
      },
    };
    const logged: unknown[] = [];
    const audit = { log: async (...args: unknown[]) => void logged.push(args) };
    const database = {
      withScope: async (_s: unknown, fn: (tx: unknown) => unknown) =>
        fn({ business: { findUniqueOrThrow: async () => ({ name: 'Firm, Inc.' }) } }),
    };
    const users = new UsersService(database as never, staff as never, audit as never);
    const csv = await users.export({ businessId: 'f', role: 'OWNER', kind: 'staff' }, 'u', {
      status: 'all',
      page: 3,
      pageSize: 10,
    } as never);
    const lines = csv.trim().split(String.fromCharCode(13, 10));
    expect(pages).toEqual([1, 2, 3]);
    expect(lines).toHaveLength(251);
    expect(lines.at(-1)).toContain('Person 250');
    for (const s of ['Active', 'Pending', 'Locked', 'Inactive'])
      expect(lines.some((l) => l.includes(`,${s},`))).toBe(true);
    expect(logged).toEqual([
      ['users.exported', { type: 'membership' }, { count: 250, filters: [] }],
    ]);
  });
});
