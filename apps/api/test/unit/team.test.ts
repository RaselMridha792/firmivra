import { describe, expect, it } from 'vitest';
import {
  assertManageable,
  byRoleThenName,
  needsUserRow,
  shownPerson,
} from '../../src/team/team.service.js';

const status = (fn: () => void) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    const err = e as { getStatus: () => number; getResponse: () => { code: string } };
    return `${err.getStatus()} ${err.getResponse().code}`;
  }
};

describe('team rules', () => {
  it("reads a person's user row only once they joined, or when the invite lacks what was typed", () => {
    const at = new Date();
    const invite = (fields: { name: string | null; email: string | null; acceptedAt?: Date }) => [
      {
        createdAt: at,
        expiresAt: at,
        acceptedAt: null,
        revokedAt: null,
        ...fields,
      },
    ];
    const typed = invite({ name: 'Typed', email: 'typed@t03.test' });
    const invited = { userId: 'u', joinedAt: null, status: 'INVITED' as const, invites: typed };
    const user = { id: 'u', name: 'Own', email: 'own@t03.test' };
    expect(needsUserRow(invited)).toBe(false);
    expect(shownPerson(invited, undefined)).toEqual({
      id: 'u',
      name: 'Typed',
      email: 'typed@t03.test',
    });
    // Before #52 an invite has no typed name or email: the user row fills in, if it can be read.
    const old = { ...invited, invites: invite({ name: null, email: null }) };
    expect(needsUserRow(old)).toBe(true);
    expect(shownPerson(old, user)).toEqual(user);
    expect(shownPerson(old, undefined)).toEqual({ id: 'u', name: '', email: '' });
    // Joined (stamped, active, or the invite used): the user row.
    for (const joined of [
      { ...invited, joinedAt: at },
      { ...invited, status: 'ACTIVE' as const },
      { ...invited, invites: invite({ name: 'Typed', email: 'typed@t03.test', acceptedAt: at }) },
    ]) {
      expect(needsUserRow(joined)).toBe(true);
      expect(shownPerson(joined, user)).toEqual(user);
    }
  });

  it('orders Owners, then Admins, then Staff, each by name', () => {
    const people = [
      { role: 'STAFF', user: { name: 'Abe' } },
      { role: 'OWNER', user: { name: 'Zed' } },
      { role: 'ADMIN', user: { name: 'Bo' } },
      { role: 'OWNER', user: { name: 'Al' } },
    ] as const;
    expect([...people].sort(byRoleThenName).map((p) => p.user.name)).toEqual([
      'Al',
      'Zed',
      'Bo',
      'Abe',
    ]);
  });

  it('lets Admins manage Staff only, and nobody themselves', () => {
    const owner = { userId: 'o', role: 'OWNER' as const };
    const admin = { userId: 'a', role: 'ADMIN' as const };
    expect(status(() => assertManageable(owner, { role: 'OWNER', userId: 'x' }))).toBe('ok');
    expect(status(() => assertManageable(admin, { role: 'STAFF', userId: 'x' }))).toBe('ok');
    expect(status(() => assertManageable(admin, { role: 'ADMIN', userId: 'x' }))).toBe(
      '403 FORBIDDEN',
    );
    expect(status(() => assertManageable(admin, { role: 'OWNER', userId: 'x' }))).toBe(
      '403 FORBIDDEN',
    );
    expect(status(() => assertManageable(owner, { role: 'OWNER', userId: 'o' }))).toBe(
      '409 CANNOT_CHANGE_SELF',
    );
  });
});
