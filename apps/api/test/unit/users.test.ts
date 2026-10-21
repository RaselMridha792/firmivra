// Settings > Users & Roles (R55): role search and the export's rows.
import { describe, expect, it } from 'vitest';
import { EXPORT_HEADER, exportLine, rolesMatching } from '../../src/staff/users.service.js';

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
