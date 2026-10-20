// R60: the Super Admin Team writes for admin-scope.test.ts, each against a member of its own,
// in the state its change needs: an active member to edit, an active member for the bulk Change
// Status, a VP / Director hire waiting for the department head, a member still Pending
// Invitation for Resend Invitation, and for Add Team Member an email of this run whose login was
// left half-made. Made with the owner client (users and platform_admins are written only in
// platform scope, which the API uses for Add Team Member's login alone).
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { Fixtures } from '../global-setup.js';
import { records, type SupportWrite } from './admin-support-writes.js';

const tag = randomUUID().slice(0, 8);

/** The department, roles and members the Team writes act on. */
export async function prepareTeam(fx: Fixtures): Promise<void> {
  const code = `SCOPE_${tag.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const department = await tx.platformDepartment.create({
        data: { code, name: `Fake scope department ${tag}` },
      });
      records.teamDepartment = department.id;
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
      records.teamRole = ic.id;
      const person = async (
        key: string,
        status: 'ACTIVE' | 'PENDING_INVITATION' | 'PENDING_DEPARTMENT_HEAD_APPROVAL',
      ) => {
        const id = randomUUID();
        const hire = status === 'PENDING_DEPARTMENT_HEAD_APPROVAL';
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
            roleDefinitionId: hire ? vp.id : ic.id,
            departmentId: department.id,
            scopeType: hire ? 'DIVISION' : 'OWN_RECORDS',
            status,
            intendedRoleDefinitionId: hire ? vp.id : null,
            invitedByUserId: fx.users.admin.id,
          },
        });
        records[key] = id;
      };
      await person('teamPatch', 'ACTIVE');
      await person('teamBulk', 'ACTIVE');
      await person('teamDecision', 'PENDING_DEPARTMENT_HEAD_APPROVAL');
      await person('teamResend', 'PENDING_INVITATION');
      // Add Team Member's person: a login left half-made (an admin row, no org-chart row), which
      // the route reuses. A brand-new login also needs INSERT on platform_admins for the app,
      // which R0's r0_platform_tightening revoked (docs/work/R60-team.md, note 80).
      const added = randomUUID();
      await tx.user.create({
        data: {
          id: added,
          cognitoSub: added,
          pool: 'ADMIN',
          email: `scope-team-new-${tag}@example.test`,
          name: `Fake Scope New ${tag}`,
        },
      });
      await tx.platformAdmin.create({ data: { userId: added, role: 'TEAM_MEMBER' } });
    });
  } finally {
    await owner.$disconnect();
  }
}

const T = '/api/v1/admin/team';

/** Each Team write with a body that passes validation, in the order the sweep runs them. */
export function teamWrites(): Record<string, SupportWrite> {
  return {
    [`POST ${T}/members`]: {
      body: () =>
        Promise.resolve({
          firstName: 'Fake',
          lastName: `Scope New ${tag}`,
          email: `scope-team-new-${tag}@example.test`,
          departmentId: records.teamDepartment,
          roleId: records.teamRole,
        }),
    },
    [`POST ${T}/members/bulk`]: {
      body: () =>
        Promise.resolve({
          ids: [records.teamBulk],
          confirmedCount: 1,
          action: { type: 'STATUS', status: 'SUSPENDED' },
        }),
    },
    [`POST ${T}/members/invitations`]: {
      body: () => Promise.resolve({ ids: [records.teamResend] }),
    },
    [`PATCH ${T}/members/:id`]: { record: 'teamPatch', body: { scope: 'DIRECT_REPORTS' } },
    [`POST ${T}/members/:id/decision`]: { record: 'teamDecision', body: { decision: 'APPROVE' } },
  };
}
