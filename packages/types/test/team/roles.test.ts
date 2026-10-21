import { describe, expect, it } from 'vitest';
import {
  ChangeTeamRoleRequest,
  FIRM_ROLE_LABELS,
  FIRM_ROLE_ORDER,
  FIRM_ROLES,
  InviteRole,
  MembershipRole,
  ROLES_MANAGED_BY,
} from '../../src/index.js';

describe('the firm roles', () => {
  it('lists the nine roles, highest authority first, matching the database enum', () => {
    expect(FIRM_ROLES).toEqual([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'STAFF',
      'BOOKKEEPER',
      'TAX_PREPARER',
      'CLIENT_SUPPORT',
      'BUSINESS_CONSULTANT',
      'READ_ONLY',
    ]);
    expect([...MembershipRole.options].sort()).toEqual([...FIRM_ROLES].sort());
  });

  it('labels and orders every role', () => {
    for (const role of FIRM_ROLES) expect(FIRM_ROLE_LABELS[role]).toMatch(/\S/);
    expect(FIRM_ROLES.map((role) => FIRM_ROLE_ORDER[role])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('lets an invite give any role but Owner, and a role change any role', () => {
    expect(InviteRole.options).toEqual(FIRM_ROLES.filter((role) => role !== 'OWNER'));
    expect(ChangeTeamRoleRequest.safeParse({ role: 'MANAGER' }).success).toBe(true);
    expect(InviteRole.safeParse('OWNER').success).toBe(false);
  });

  it('says who manages which role: nobody gives Owner, nobody manages their own level', () => {
    for (const managers of Object.values(ROLES_MANAGED_BY)) expect(managers).not.toContain('OWNER');
    expect(ROLES_MANAGED_BY.ADMIN).not.toContain('ADMIN');
    expect(ROLES_MANAGED_BY.OWNER).toEqual(FIRM_ROLES.filter((role) => role !== 'OWNER'));
    for (const role of [
      'MANAGER',
      'STAFF',
      'BOOKKEEPER',
      'TAX_PREPARER',
      'CLIENT_SUPPORT',
      'BUSINESS_CONSULTANT',
      'READ_ONLY',
    ] as const) {
      expect(ROLES_MANAGED_BY[role]).toEqual([]);
    }
  });
});
