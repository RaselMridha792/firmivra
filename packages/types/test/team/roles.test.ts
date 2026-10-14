import { describe, expect, it } from 'vitest';
import {
  ChangeTeamRoleRequest,
  FIRM_ROLE_LABELS,
  FIRM_ROLE_ORDER,
  FIRM_ROLES,
  InviteRole,
  MembershipRole,
} from '../../src/index.js';

describe('the firm roles', () => {
  it('lists the eight roles, highest authority first, matching the database enum', () => {
    expect(FIRM_ROLES).toEqual([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'STAFF',
      'BOOKKEEPER',
      'TAX_PREPARER',
      'CLIENT_SUPPORT',
      'READ_ONLY',
    ]);
    expect([...MembershipRole.options].sort()).toEqual([...FIRM_ROLES].sort());
  });

  it('labels and orders every role', () => {
    for (const role of FIRM_ROLES) expect(FIRM_ROLE_LABELS[role]).toMatch(/\S/);
    expect(FIRM_ROLES.map((role) => FIRM_ROLE_ORDER[role])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the invite and role-change requests at today's roles until the rules open more", () => {
    expect(InviteRole.options).toEqual(['ADMIN', 'STAFF']);
    expect(ChangeTeamRoleRequest.safeParse({ role: 'MANAGER' }).success).toBe(false);
    expect(ChangeTeamRoleRequest.safeParse({ role: 'ADMIN' }).success).toBe(true);
  });
});
