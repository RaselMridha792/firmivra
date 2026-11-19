// SM02 (Staff Management Review 2, decision 7a): the Staff Management mock refuses, as the API
// does, a permission the actor does not have themselves (403 CANNOT_GRANT); the Owner gives
// anything. An Admin cannot change the Admin role on screen, so this runs the mock directly.
import { PermissionCapability } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { createRolesMock, createStaffMock } from '../mocks/staff-management';

const give = {
  grants: [{ module: 'INTEGRATIONS' as const, capability: 'VIEW' as const, granted: true }],
  acknowledgeEscalation: true,
};
const refused = { status: 403, code: 'CANNOT_GRANT' };

describe('staff management mock: SM02', () => {
  it('an Admin gives no cell they lack themselves; one they have, they still give', async () => {
    const admin = createRolesMock({ role: 'ADMIN' });
    // Integrations taken from the Admin role: this Admin lacks it now.
    await admin.savePermissions('ADMIN', {
      grants: PermissionCapability.options.map((capability) => ({
        module: 'INTEGRATIONS' as const,
        capability,
        granted: false,
      })),
    });
    await expect(admin.savePermissions('TAX_PREPARER', give)).rejects.toMatchObject(refused);
    await expect(
      admin.createCustom({ name: 'Integrator', basedOn: 'STAFF', ...give }),
    ).rejects.toMatchObject(refused);
    const staff = createStaffMock({ role: 'ADMIN' });
    const hana = (await staff.list()).items.find((m) => m.name === 'Hana Kim');
    expect(hana).toBeDefined();
    await expect(staff.setPermissions(hana!.id, give)).rejects.toMatchObject(refused);
    await expect(
      staff.setOverrides(hana!.id, {
        overrides: [{ module: 'INTEGRATIONS', capability: 'VIEW', mode: 'ALLOW' }],
        acknowledgeEscalation: true,
      }),
    ).rejects.toMatchObject(refused);
    // Reports the Admin has: given.
    const reports = await admin.savePermissions('TAX_PREPARER', {
      grants: [{ module: 'REPORTS', capability: 'VIEW', granted: true }],
      acknowledgeEscalation: true,
    });
    expect(
      reports.cells.find((c) => c.module === 'REPORTS' && c.capability === 'VIEW')?.granted,
    ).toBe(true);
  });

  it('the Owner gives anything', async () => {
    const owner = createRolesMock({ role: 'OWNER' });
    const saved = await owner.savePermissions('TAX_PREPARER', give);
    expect(
      saved.cells.find((c) => c.module === 'INTEGRATIONS' && c.capability === 'VIEW')?.granted,
    ).toBe(true);
  });
});
