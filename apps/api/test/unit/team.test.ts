import { describe, expect, it } from 'vitest';
import { assertManageable, byRoleThenName } from '../../src/team/team.service.js';

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
