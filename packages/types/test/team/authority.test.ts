import { describe, expect, it } from 'vitest';
import {
  mayActOn,
  mayChangeRole,
  ROLES_MANAGED_BY,
  STAFF_AUTHORITY_ACTIONS,
  staffAuthority,
  type StaffTier,
  tierOf,
} from '../../src/index.js';

// SM14 with Rasel's default (Nov 7): nobody else acts on the Original Owner; owner-level acts on
// everyone else; an Admin only below Admin and never Reset MFA; owner-level access is given and
// taken away by the Original Owner alone.
const TIERS: StaffTier[] = ['ORIGINAL_OWNER', 'OWNER', 'ADMIN', 'MEMBER'];

describe('account authority (SM14)', () => {
  it('places each role', () => {
    expect(tierOf('OWNER', true)).toBe('ORIGINAL_OWNER');
    expect(tierOf('OWNER', false)).toBe('OWNER');
    expect(tierOf('ADMIN', true)).toBe('ADMIN');
    expect(tierOf('MANAGER', false)).toBe('MEMBER');
    expect(tierOf('READ_ONLY', false)).toBe('MEMBER');
  });

  it('gives the approved answer for every pair and action', () => {
    const want = (actor: StaffTier, target: StaffTier, action: string) => {
      if (target === 'ORIGINAL_OWNER') return false;
      if (actor === 'ORIGINAL_OWNER' || actor === 'OWNER') return true;
      if (actor === 'ADMIN') return target === 'MEMBER' && action !== 'resetMfa';
      return false;
    };
    for (const actor of TIERS)
      for (const target of TIERS)
        for (const action of STAFF_AUTHORITY_ACTIONS)
          expect([actor, target, action, mayActOn(actor, target, action)]).toEqual([
            actor,
            target,
            action,
            want(actor, target, action),
          ]);
  });

  it('owner-level access is the Original Owner’s to give and take away', () => {
    expect(mayChangeRole('ORIGINAL_OWNER', 'ADMIN', 'OWNER')).toBe(true);
    expect(mayChangeRole('ORIGINAL_OWNER', 'OWNER', 'ADMIN')).toBe(true);
    expect(mayChangeRole('OWNER', 'ADMIN', 'OWNER')).toBe(false);
    expect(mayChangeRole('OWNER', 'OWNER', 'ADMIN')).toBe(false);
    expect(mayChangeRole('OWNER', 'STAFF', 'ADMIN')).toBe(true);
    expect(mayChangeRole('ADMIN', 'STAFF', 'ADMIN')).toBe(false);
    expect(mayChangeRole('ADMIN', 'STAFF', 'MANAGER')).toBe(true);
    expect(mayChangeRole('MEMBER', 'STAFF', 'READ_ONLY')).toBe(false);
    // No change is no grant.
    expect(mayChangeRole('OWNER', 'OWNER', 'OWNER')).toBe(true);
  });

  it('never on oneself, and the roles follow the rule', () => {
    const self = staffAuthority('ORIGINAL_OWNER', 'ORIGINAL_OWNER', true);
    expect(self).toMatchObject({ originalOwner: true, edit: false, changeRole: false, roles: [] });
    expect(staffAuthority('ORIGINAL_OWNER', 'OWNER', false).roles).toEqual([
      'OWNER',
      ...ROLES_MANAGED_BY.OWNER,
    ]);
    expect(staffAuthority('OWNER', 'OWNER', false)).toMatchObject({
      edit: true,
      changeRole: false,
      roles: [],
    });
    expect(staffAuthority('ADMIN', 'MEMBER', false)).toMatchObject({
      resetMfa: false,
      roles: [...ROLES_MANAGED_BY.ADMIN],
    });
  });
});
