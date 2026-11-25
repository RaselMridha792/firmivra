import { describe, expect, it } from 'vitest';
import {
  type MembershipRole,
  type PermissionCapability,
  type PermissionModule,
  roleCan,
} from '@firmivra/types';
import { rowActions } from './appointment-actions';

/** What the role's default grid allows (the dashboard uses the member's own grants: V5). */
const byRole =
  (role: MembershipRole | undefined) =>
  (module: PermissionModule, capability: PermissionCapability) =>
    role ? roleCan(role, module, capability) : false;

// Octavia's A3: the appointment row menu by permission (Dashboard Review Two).
const client = { client: { id: 'c' }, lead: null };
const lead = { client: null, lead: { id: 'l' } };

describe('the Upcoming Appointments row menu (A3)', () => {
  it('gives the Owner and Staff every action and Open Client', () => {
    for (const role of ['OWNER', 'STAFF'] as const)
      expect(rowActions(byRole(role), client)).toEqual([
        'view',
        'edit',
        'reschedule',
        'remind',
        'complete',
        'cancel',
        'client',
      ]);
  });

  it('gives a role that may not edit appointments only View Details (and the record it may view)', () => {
    expect(rowActions(byRole('READ_ONLY'), client)).toEqual(['view', 'client']);
    // Read Only does not view leads: a lead's appointment offers View Details alone.
    expect(rowActions(byRole('READ_ONLY'), lead)).toEqual(['view']);
    expect(rowActions(byRole(undefined), client)).toEqual(['view']);
    // V5: a member whose own grants differ from their role's: Edit taken away, Open Client kept.
    const custom = (module: PermissionModule, capability: PermissionCapability) =>
      module === 'CLIENTS' && capability === 'VIEW';
    expect(rowActions(custom, client)).toEqual(['view', 'client']);
  });
});
