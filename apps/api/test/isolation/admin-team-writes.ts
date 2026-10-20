// R60: the Super Admin Team writes for admin-scope.test.ts, each against a member of its own,
// in the state its change needs: an active member to edit, an active member for the bulk Change
// Status, and a VP / Director hire waiting for the department head. Made with the owner client
// (users and platform_admins are written only in platform scope; the API never writes them).
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { Fixtures } from '../global-setup.js';
import { records, type SupportWrite } from './admin-support-writes.js';

/** The department, roles and members the Team writes act on. */
export async function prepareTeam(fx: Fixtures): Promise<void> {
  const tag = randomUUID().slice(0, 8);
  const code = `SCOPE_${tag.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const department = await tx.platformDepartment.create({
        data: { code, name: `Fake scope department ${tag}` },
      });
      const role = (suffix: string, level: 'VP_DIRECTOR' | 'INDIVIDUAL_CONTRIBUTOR') =>
        tx.platformRoleDefinition.create({
          data: {
            code: `${code}_${suffix}`,
            title: `Fake scope ${suffix.toLowerCase()} ${tag}`,
            level,
            departmentId: department.id,
            defaultScopeType: level === 'VP_DIRECTOR' ? 'DIVISION' : 'OWN_RECORDS',
            permissions: { create: [{ permissionKey: 'team.view', state: 'ALLOW' }] },
          },
        });
      const ic = await role('IC', 'INDIVIDUAL_CONTRIBUTOR');
      const vp = await role('VP', 'VP_DIRECTOR');
      const person = async (key: string, pending: boolean) => {
        const id = randomUUID();
        await tx.user.create({
          data: {
            id,
            cognitoSub: id,
            pool: 'ADMIN',
            email: `scope-team-${key.toLowerCase()}-${tag}@example.test`,
            name: `Fake Scope ${key} ${tag}`,
          },
        });
        await tx.platformAdmin.create({ data: { userId: id, role: 'TEAM_MEMBER' } });
        await tx.platformMember.create({
          data: {
            userId: id,
            roleDefinitionId: pending ? vp.id : ic.id,
            departmentId: department.id,
            scopeType: pending ? 'DIVISION' : 'OWN_RECORDS',
            status: pending ? 'PENDING_DEPARTMENT_HEAD_APPROVAL' : 'ACTIVE',
            intendedRoleDefinitionId: pending ? vp.id : null,
            invitedByUserId: fx.users.admin.id,
          },
        });
        records[key] = id;
      };
      await person('teamPatch', false);
      await person('teamBulk', false);
      await person('teamDecision', true);
    });
  } finally {
    await owner.$disconnect();
  }
}

const T = '/api/v1/admin/team';

/** Each Team write with a body that passes validation, in the order the sweep runs them. */
export function teamWrites(): Record<string, SupportWrite> {
  return {
    [`POST ${T}/members/bulk`]: {
      body: () =>
        Promise.resolve({
          ids: [records.teamBulk],
          confirmedCount: 1,
          action: { type: 'STATUS', status: 'SUSPENDED' },
        }),
    },
    [`PATCH ${T}/members/:id`]: { record: 'teamPatch', body: { scope: 'DIRECT_REPORTS' } },
    [`POST ${T}/members/:id/decision`]: { record: 'teamDecision', body: { decision: 'APPROVE' } },
  };
}
