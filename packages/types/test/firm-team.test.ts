import { describe, it, expect } from 'vitest';
import { ChangeTeamRoleRequest, ListTeamMembersQuery } from '../src/firm-team.js';
describe('team request boundaries', () => {
  it('rejects untrusted tenant ids and unknown roles', () => {
    expect(ChangeTeamRoleRequest.safeParse({ role: 'SUPER_ADMIN' }).success).toBe(false);
    expect(ChangeTeamRoleRequest.safeParse({ role: 'STAFF', businessId: 'forged' }).success).toBe(
      false,
    );
    expect(ListTeamMembersQuery.safeParse({ userId: 'forged' }).success).toBe(false);
  });
  it('bounds page sizes and parses the HTTP query', () => {
    expect(ListTeamMembersQuery.parse({ limit: '2' }).limit).toBe(2);
    expect(ListTeamMembersQuery.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
