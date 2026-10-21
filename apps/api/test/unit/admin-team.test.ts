// Unit: R60, Super Admin Team's hierarchy rules (who sees, reaches and changes whom, which role,
// scope and keys a member may give, the status and supervisor rules), the change planner (Add
// Team Member, edits with the name and phone, bulk changes, resends, the department head's
// decision) and the invitation (its sealed token, the daily caps, the messages), on a fake org
// chart.
import type { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_TEAM_ACTIVITY_ACTIONS,
  ADMIN_TEAM_KEYS,
  type AdminTeamLevel,
  type AdminTeamMember,
  type AdminTeamScope,
  type AdminTeamStatus,
  adminTeamActivityText,
  adminTeamCatalogKeys,
} from '@firmivra/types';
import {
  buildContext,
  type MemberRow,
  type RoleRow,
  type TeamContext,
  type TeamRows,
} from '../../src/admin-team/team-context.js';
import {
  invitationEmail,
  invitationExpiry,
  invitationLink,
  invitationSms,
  overLimit,
  TEAM_INVITE_LIMITS,
  TeamInvitationTokens,
} from '../../src/admin-team/team-invitation.js';
import {
  type CreateBody,
  planBulk,
  planChange,
  planCreate,
  planDecision,
  planProfile,
  planResend,
  type Plan,
  type Planned,
  withProfile,
} from '../../src/admin-team/team-plan.js';
import {
  activityEntry,
  formOptionsOf,
  matchesSearch,
  sortMembers,
  summaryOf,
} from '../../src/admin-team/team-read.service.js';
import {
  assignableScopes,
  below,
  effectiveKeys,
  keyDiff,
  overridesFor,
  reach,
  reactivatedStatus,
  roleGate,
  sees,
  statusProblem,
  statusTargets,
  supervisorValid,
  teamCatalog,
} from '../../src/admin-team/team-rules.js';
import {
  capabilities,
  memberActions,
  memberView,
  NO_EXTRAS,
} from '../../src/admin-team/team-views.js';

const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// R0's team.* template per level (seed-platform-team.ts, hierarchy doc §15).
const LEVELS: AdminTeamLevel[] = [
  'CEO',
  'CHIEF_OFFICER',
  'VP_DIRECTOR',
  'MANAGER',
  'LEAD_SUPERVISOR',
  'INDIVIDUAL_CONTRIBUTOR',
];
const TEMPLATE: [string, boolean[]][] = [
  ['team.view', [true, true, true, true, true, true]],
  ['team.view_profile', [true, true, true, true, true, true]],
  ['org.view', [true, true, true, true, true, true]],
  ['team.create', [true, true, false, false, false, false]],
  ['team.edit', [true, true, true, true, false, false]],
  ['team.deactivate', [true, false, false, false, false, false]],
  ['team.assign_department', [true, false, false, false, false, false]],
  ['team.assign_team', [true, true, true, false, false, false]],
  ['team.change_role', [true, true, false, false, false, false]],
  ['team.change_permissions', [true, false, false, false, false, false]],
  ['team.message_department', [true, true, false, false, false, false]],
  ['team.message_team', [true, true, true, true, true, false]],
];
const templateFor = (level: AdminTeamLevel) =>
  TEMPLATE.filter(([, at]) => at[LEVELS.indexOf(level)]).map(([key]) => key);

const D = { exec: uuid(1), ops: uuid(2), hr: uuid(3), sales: uuid(4), closed: uuid(5) };
const departments = [
  { id: D.exec, code: 'EXECUTIVE', name: 'Executive', isActive: true },
  { id: D.ops, code: 'OPERATIONS', name: 'Operations', isActive: true },
  { id: D.hr, code: 'HR_PEOPLE', name: 'Human Resources / People', isActive: true },
  { id: D.sales, code: 'REVENUE_SALES', name: 'Revenue / Sales', isActive: true },
  { id: D.closed, code: 'CLOSED', name: 'Closed', isActive: false },
];

let roleNumber = 100;
const roles: RoleRow[] = [];
function role(
  code: string,
  title: string,
  level: AdminTeamLevel,
  departmentId: string,
  scope?: AdminTeamScope,
) {
  const row: RoleRow = {
    id: uuid(++roleNumber),
    code,
    title,
    level,
    departmentId,
    defaultScope:
      scope ??
      (
        { CEO: 'COMPANY', CHIEF_OFFICER: 'DEPARTMENT', VP_DIRECTOR: 'DIVISION' } as Record<
          string,
          AdminTeamScope
        >
      )[level] ??
      (level === 'INDIVIDUAL_CONTRIBUTOR' ? 'OWN_RECORDS' : 'TEAM'),
    template: templateFor(level),
  };
  roles.push(row);
  return row;
}
const R = {
  ceo: role('EXECUTIVE_CEO', 'CEO', 'CEO', D.exec),
  chiefOfStaff: role('EXECUTIVE_CHIEF_OF_STAFF', 'Chief of Staff', 'VP_DIRECTOR', D.exec),
  coo: role('OPERATIONS_COO', 'COO', 'CHIEF_OFFICER', D.ops),
  opsVp: role('OPERATIONS_VP', 'VP / Director of Operations', 'VP_DIRECTOR', D.ops),
  opsVp2: role('OPERATIONS_VP2', 'Director of Programs', 'VP_DIRECTOR', D.ops),
  opsManager: role('OPERATIONS_MANAGER', 'Operations Manager', 'MANAGER', D.ops),
  opsLead: role('OPERATIONS_LEAD', 'Operations Coordinator', 'LEAD_SUPERVISOR', D.ops),
  opsIc: role('OPERATIONS_IC', 'Operations Specialist', 'INDIVIDUAL_CONTRIBUTOR', D.ops),
  chro: role('HR_PEOPLE_CHRO', 'CHRO', 'CHIEF_OFFICER', D.hr),
  hrVp: role('HR_PEOPLE_VP', 'VP / Director of Human Resources', 'VP_DIRECTOR', D.hr),
  hrAdmin: role(
    'HR_PEOPLE_AUTHORIZED_HR_PEOPLE_ADMINISTRATOR',
    'Authorized HR / People Administrator',
    'MANAGER',
    D.hr,
    'CUSTOM',
  ),
  cro: role('REVENUE_SALES_CRO', 'CRO', 'CHIEF_OFFICER', D.sales),
  salesVp: role('REVENUE_SALES_VP', 'VP / Director of Sales', 'VP_DIRECTOR', D.sales),
  salesManager: role('REVENUE_SALES_SALES_MANAGER', 'Sales Manager', 'MANAGER', D.sales),
  salesIc: role(
    'REVENUE_SALES_ACCOUNT_EXECUTIVE',
    'Account Executive',
    'INDIVIDUAL_CONTRIBUTOR',
    D.sales,
  ),
};

const P = {
  ceo: uuid(201),
  coo: uuid(202),
  opsVp: uuid(203),
  opsManager: uuid(204),
  opsIc: uuid(205),
  opsIc2: uuid(206),
  chro: uuid(207),
  hrAdmin: uuid(208),
  cro: uuid(209),
  salesIc: uuid(210),
  hire: uuid(211),
  invited: uuid(212),
  superNoRow: uuid(213),
  teamNoRow: uuid(214),
  chiefOfStaff: uuid(215),
};
const NAMES: Record<string, string> = {
  [P.ceo]: 'Fake Ceo',
  [P.coo]: 'Fake Coo',
  [P.opsVp]: 'Fake Ops Vp',
  [P.opsManager]: 'Fake Ops Manager',
  [P.opsIc]: 'Mary Ann Fake',
  [P.opsIc2]: 'Fake Ops Two',
  [P.chro]: 'Fake Chro',
  [P.hrAdmin]: 'Fake Hr Admin',
  [P.cro]: 'Fake Cro',
  [P.salesIc]: 'Fake Seller',
  [P.hire]: 'Fake Hire',
  [P.invited]: 'Fake Invitee',
  [P.superNoRow]: 'Fake Super',
  [P.teamNoRow]: 'Fake Newcomer',
  [P.chiefOfStaff]: 'Fake Staff Chief',
};

function member(id: string, r: RoleRow, over: Partial<MemberRow> = {}): MemberRow {
  return {
    userId: id,
    roleId: r.id,
    departmentId: r.departmentId,
    reportsToId: null,
    scope: r.defaultScope,
    scopeIds: [],
    status: 'ACTIVE',
    intendedRoleId: null,
    invitedById: null,
    approvedById: null,
    createdAt: new Date(NOW - 60 * 86_400_000),
    updatedAt: new Date(NOW - 86_400_000),
    overrides: [],
    ...over,
  };
}

function rows(extra: Partial<Record<string, Partial<MemberRow>>> = {}): TeamRows {
  const members = [
    member(P.ceo, R.ceo),
    member(P.coo, R.coo, { reportsToId: P.ceo }),
    member(P.opsVp, R.opsVp, { reportsToId: P.coo }),
    member(P.opsManager, R.opsManager, { reportsToId: P.opsVp }),
    member(P.opsIc, R.opsIc, { reportsToId: P.opsManager }),
    member(P.opsIc2, R.opsIc, { reportsToId: P.opsManager, status: 'SUSPENDED' }),
    member(P.chro, R.chro, { reportsToId: P.ceo }),
    member(P.hrAdmin, R.hrAdmin, { reportsToId: P.chro }),
    member(P.cro, R.cro, { reportsToId: P.ceo }),
    member(P.salesIc, R.salesIc, { reportsToId: P.cro, createdAt: new Date(NOW - 86_400_000) }),
    member(P.hire, R.salesVp, {
      status: 'PENDING_DEPARTMENT_HEAD_APPROVAL',
      intendedRoleId: R.salesVp.id,
      invitedById: P.hrAdmin,
    }),
    member(P.invited, R.opsIc, { status: 'PENDING_INVITATION', reportsToId: P.opsManager }),
    member(P.chiefOfStaff, R.chiefOfStaff, { reportsToId: P.ceo }),
  ].map((m) => ({ ...m, ...extra[m.userId] }));
  const ids = [...members.map((m) => m.userId), P.superNoRow, P.teamNoRow];
  return {
    departments,
    roles,
    members,
    admins: ids.map((id) => ({
      userId: id,
      role:
        id === P.ceo || id === P.superNoRow ? ('SUPER_ADMIN' as const) : ('TEAM_MEMBER' as const),
    })),
    users: ids.map((id) => ({
      id,
      name: NAMES[id]!,
      email: `${id.slice(-4)}@example.test`,
      phone: id === P.opsIc ? '+15555550101' : null,
      cognitoSub: id,
    })),
  };
}

const as = (actorId: string, extra?: Parameters<typeof rows>[0]): TeamContext =>
  buildContext(rows(extra), actorId, NOW);
const personOf = (ctx: TeamContext, id: string) => ctx.chart.people.get(id)!;
const codeOf = (work: () => unknown): string | null => {
  try {
    work();
  } catch (e) {
    return ((e as HttpException).getResponse() as { code: string }).code;
  }
  return null;
};
const planned = (result: Planned): Plan => {
  if ('refused' in result) throw new Error(`refused ${result.refused}`);
  if (!result.plan) throw new Error('no change');
  return result.plan;
};
const refused = (result: Planned) => ('refused' in result ? result.refused : null);
const actions = (plan: Plan) => plan.events.map((e) => e.action);

describe('the signed-in member', () => {
  it('a Super Admin with no org-chart row is the CEO; a CEO-level row is unrestricted', () => {
    expect(as(P.superNoRow).actor).toMatchObject({ person: null, unrestricted: true });
    expect(as(P.ceo).actor.unrestricted).toBe(true);
    expect(as(P.coo).actor.unrestricted).toBe(false);
    expect(as(P.coo).actor.keys.has(ADMIN_TEAM_KEYS.CHANGE_ROLE)).toBe(true);
  });

  it('a team member without an ACTIVE row, or not a platform admin, is 403 FORBIDDEN', () => {
    expect(codeOf(() => as(P.teamNoRow))).toBe('FORBIDDEN');
    expect(codeOf(() => as(P.opsIc2))).toBe('FORBIDDEN');
    expect(codeOf(() => as(uuid(999)))).toBe('FORBIDDEN');
  });

  it('capabilities follow the keys: Add with team.create', () => {
    expect(capabilities(as(P.ceo))).toEqual({
      add: true,
      edit: true,
      changeRole: true,
      changeDepartment: true,
      changeStatus: true,
      customizePermissions: true,
      approve: true,
    });
    expect(capabilities(as(P.opsManager))).toEqual({
      add: false,
      edit: true,
      changeRole: false,
      changeDepartment: false,
      changeStatus: false,
      customizePermissions: false,
      approve: false,
    });
    expect(capabilities(as(P.cro))).toMatchObject({ approve: true, add: true });
  });
});

describe('who sees whom (the directory)', () => {
  const sees_ = (actorId: string, targetId: string) => {
    const ctx = as(actorId);
    return sees(ctx.actor, ctx.chart, personOf(ctx, targetId));
  };

  it('the CEO and HR see everyone', () => {
    for (const id of Object.values(P).filter((id) => id !== P.superNoRow && id !== P.teamNoRow)) {
      expect(sees_(P.ceo, id)).toBe(true);
      expect(sees_(P.hrAdmin, id)).toBe(true);
    }
  });

  it('DEPARTMENT: their department, the CEO and the Chief Officers', () => {
    expect(sees_(P.coo, P.opsIc)).toBe(true);
    expect(sees_(P.coo, P.ceo)).toBe(true);
    expect(sees_(P.coo, P.cro)).toBe(true);
    expect(sees_(P.coo, P.salesIc)).toBe(false);
  });

  it('TEAM: their supervisor and everyone below them', () => {
    expect(sees_(P.opsManager, P.opsVp)).toBe(true);
    expect(sees_(P.opsManager, P.opsIc)).toBe(true);
    expect(sees_(P.opsManager, P.coo)).toBe(false);
    expect(sees_(P.opsManager, P.salesIc)).toBe(false);
  });

  it('OWN_RECORDS: their department; DIRECT_REPORTS: supervisor and direct reports', () => {
    expect(sees_(P.opsIc, P.opsIc2)).toBe(true);
    expect(sees_(P.opsIc, P.salesIc)).toBe(false);
    const ctx = as(P.opsVp, { [P.opsVp]: { scope: 'DIRECT_REPORTS' } });
    const see = (id: string) => sees(ctx.actor, ctx.chart, personOf(ctx, id));
    expect([see(P.coo), see(P.opsManager), see(P.opsIc), see(P.cro)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('CUSTOM: the departments and people listed; without team.view only themselves', () => {
    const custom = as(P.opsVp, { [P.opsVp]: { scope: 'CUSTOM', scopeIds: [D.sales, P.chro] } });
    const see = (id: string) => sees(custom.actor, custom.chart, personOf(custom, id));
    expect([see(P.salesIc), see(P.chro), see(P.opsIc), see(P.opsVp)]).toEqual([
      true,
      true,
      false,
      true,
    ]);
    const blind = as(P.opsVp, {
      [P.opsVp]: { overrides: [{ key: 'team.view', state: 'DENY' }] },
    });
    expect(sees(blind.actor, blind.chart, personOf(blind, P.opsIc))).toBe(false);
    expect(sees(blind.actor, blind.chart, personOf(blind, P.opsVp))).toBe(true);
  });
});

describe('who reaches whom', () => {
  const reach_ = (actorId: string, targetId: string) => {
    const ctx = as(actorId);
    return reach(ctx.actor, ctx.chart, personOf(ctx, targetId));
  };

  it('never yourself, never a CEO-level member, never a peer or anyone above', () => {
    expect(reach_(P.ceo, P.ceo)).toBe('SELF');
    expect(reach_(P.superNoRow, P.ceo)).toBe('PEER_PROTECTED');
    expect(reach_(P.ceo, P.coo)).toBe('OK');
    expect(reach_(P.coo, P.cro)).toBe('PEER_PROTECTED');
    expect(reach_(P.opsManager, P.opsVp)).toBe('PEER_PROTECTED');
    expect(reach_(P.opsIc, P.opsIc2)).toBe('PEER_PROTECTED');
  });

  it('others reach people below them in their own department and directory', () => {
    expect(reach_(P.coo, P.opsIc)).toBe('OK');
    expect(reach_(P.coo, P.salesIc)).toBe('DEPARTMENT_NOT_ALLOWED');
    expect(reach_(P.opsManager, P.opsIc)).toBe('OK');
  });

  it('HR reaches every level below Chief Officer in any department, but no peer or above', () => {
    expect(reach_(P.chro, P.salesIc)).toBe('OK');
    expect(reach_(P.chro, P.opsVp)).toBe('OK');
    expect(reach_(P.chro, P.cro)).toBe('PEER_PROTECTED');
    expect(reach_(P.hrAdmin, P.salesIc)).toBe('OK');
    expect(reach_(P.hrAdmin, P.opsManager)).toBe('PEER_PROTECTED');
    expect(reach_(P.hrAdmin, P.opsVp)).toBe('PEER_PROTECTED');
  });
});

describe('which role a member may give', () => {
  const gate = (actorId: string, r: RoleRow) => roleGate(as(actorId).actor, r);

  it('no route gives the CEO role; the CEO gives any other', () => {
    expect(gate(P.ceo, R.ceo)).toBe('no');
    expect(gate(P.superNoRow, R.ceo)).toBe('no');
    expect(gate(P.ceo, R.coo)).toBe('direct');
    expect(gate(P.ceo, R.salesVp)).toBe('direct');
  });

  it('down the line in their own department: Chief VP and below, VP Manager, Manager Lead', () => {
    expect([gate(P.coo, R.opsVp), gate(P.coo, R.salesVp), gate(P.coo, R.cro)]).toEqual([
      'direct',
      'no',
      'no',
    ]);
    expect([gate(P.opsVp, R.opsManager), gate(P.opsVp, R.opsVp2)]).toEqual(['direct', 'no']);
    expect([
      gate(P.opsManager, R.opsLead),
      gate(P.opsManager, R.opsIc),
      gate(P.opsManager, R.opsManager),
    ]).toEqual(['direct', 'direct', 'no']);
    expect(gate(P.opsIc, R.opsIc)).toBe('no');
  });

  it('HR: any department, Manager and below directly, VP / Director as a hire for approval', () => {
    expect(gate(P.hrAdmin, R.salesManager)).toBe('direct');
    expect(gate(P.hrAdmin, R.salesVp)).toBe('approval');
    expect(gate(P.hrAdmin, R.hrVp)).toBe('approval');
    expect(gate(P.hrAdmin, R.cro)).toBe('no');
    expect(gate(P.chro, R.hrVp)).toBe('direct');
    expect(gate(P.chro, R.salesVp)).toBe('approval');
  });
});

describe('scopes, statuses and supervisors', () => {
  it('no scope broader than their own; HR DEPARTMENT and narrower; CUSTOM only the CEO', () => {
    expect(assignableScopes(as(P.ceo).actor)).toHaveLength(7);
    expect(assignableScopes(as(P.coo).actor)).toEqual([
      'DEPARTMENT',
      'DIVISION',
      'TEAM',
      'DIRECT_REPORTS',
      'OWN_RECORDS',
    ]);
    expect(assignableScopes(as(P.hrAdmin).actor)).toEqual([
      'DEPARTMENT',
      'DIVISION',
      'TEAM',
      'DIRECT_REPORTS',
      'OWN_RECORDS',
    ]);
    expect(assignableScopes(as(P.opsManager).actor)).toEqual([
      'TEAM',
      'DIRECT_REPORTS',
      'OWN_RECORDS',
    ]);
  });

  it('the status moves an edit may make', () => {
    expect(statusTargets('ACTIVE')).toEqual(['SUSPENDED', 'INACTIVE', 'DEACTIVATED']);
    expect(statusTargets('SUSPENDED')).toEqual(['ACTIVE', 'INACTIVE', 'DEACTIVATED']);
    expect(statusTargets('PENDING_INVITATION')).toEqual(['INACTIVE', 'DEACTIVATED']);
    expect(statusTargets('PENDING_DEPARTMENT_HEAD_APPROVAL')).toEqual([]);
    expect(statusProblem('PENDING_INVITATION', 'SUSPENDED')).toBe('STATUS_NOT_ALLOWED');
    expect(statusProblem('PENDING_INVITATION', 'ACTIVE')).toBe('STATUS_NOT_ALLOWED');
    expect(statusProblem('PENDING_DEPARTMENT_HEAD_APPROVAL', 'INACTIVE')).toBe('PENDING_APPROVAL');
    expect(statusProblem('ACTIVE', 'ACTIVE')).toBeNull();
    expect(reactivatedStatus('ACTIVE', false)).toBe('PENDING_INVITATION');
    expect(reactivatedStatus('ACTIVE', true)).toBe('ACTIVE');
    expect(reactivatedStatus('SUSPENDED', false)).toBe('SUSPENDED');
  });

  it('a supervisor: active or invited, above the role, its department, Executive or the CEO', () => {
    const ctx = as(P.ceo);
    const valid = (supervisor: string, r: RoleRow, person: string | null = null) =>
      supervisorValid(ctx.chart, supervisor, r, person, ctx.executiveDepartmentId);
    expect(valid(P.opsManager, R.opsIc)).toBe(true);
    expect(valid(P.ceo, R.opsIc)).toBe(true);
    expect(valid(P.chiefOfStaff, R.opsIc)).toBe(true);
    expect(valid(P.cro, R.opsIc)).toBe(false);
    expect(valid(P.opsIc2, R.opsIc)).toBe(false);
    expect(valid(P.opsManager, R.opsManager)).toBe(false);
    expect(valid(P.opsIc, R.opsLead, P.opsManager)).toBe(false);
    expect(valid(P.opsVp, R.opsVp, P.opsVp)).toBe(false);
    expect(valid(P.invited, R.opsIc)).toBe(false);
    expect([...below(ctx.chart, P.opsVp)].sort()).toEqual(
      [P.opsManager, P.opsIc, P.opsIc2, P.invited].sort(),
    );
  });
});

describe('permission keys and the catalog', () => {
  it('overrides add and take keys away; what differs from the template is stored', () => {
    const template = ['team.view', 'team.edit'];
    const keys = effectiveKeys(template, [
      { key: 'sales.view', state: 'ALLOW' },
      { key: 'team.edit', state: 'DENY' },
      { key: 'team.view', state: 'INHERIT' },
    ]);
    expect([...keys].sort()).toEqual(['sales.view', 'team.view']);
    expect(overridesFor(template, keys)).toEqual([
      { key: 'sales.view', state: 'ALLOW' },
      { key: 'team.edit', state: 'DENY' },
    ]);
    expect(keyDiff(template, keys)).toEqual({ granted: ['sales.view'], revoked: ['team.edit'] });
  });

  it('twelve modules; Team with R0’s keys, Support with its own, the rest by action', () => {
    const modules = teamCatalog();
    expect(modules.map((m) => m.id)).toEqual([
      'dashboard',
      'sales',
      'crm',
      'pipeline',
      'team',
      'subscriptions',
      'billing',
      'support',
      'reports',
      'notifications',
      'audit',
      'settings',
    ]);
    const team = modules.find((m) => m.id === 'team')!;
    expect(team.permissions.map((p) => p.key).sort()).toEqual(
      Object.values(ADMIN_TEAM_KEYS).sort(),
    );
    const at = (key: string) => team.permissions.find((p) => p.key === key)!;
    expect(at('team.deactivate')).toMatchObject({ action: 'delete', requires: ['team.edit'] });
    expect(at('team.change_role').action).toBe('assign');
    expect(at('team.change_permissions').action).toBe('manage');
    expect(at('team.assign_department').action).toBeNull();
    expect(modules.find((m) => m.id === 'support')!.permissions.map((p) => p.key)).toContain(
      'support.view_all',
    );
    const notifications = modules.find((m) => m.id === 'notifications')!;
    expect(notifications.permissions).toEqual([
      { key: 'notifications.view', label: 'View', action: 'view', requires: [] },
      {
        key: 'notifications.manage',
        label: 'Manage',
        action: 'manage',
        requires: ['notifications.view'],
      },
    ]);
    const keys = adminTeamCatalogKeys(modules);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('an edit (planChange)', () => {
  it('a new role loads its template and default scope and drops a supervisor no longer valid', () => {
    const plan = planned(planChange(as(P.ceo), P.opsIc, { roleId: R.opsManager.id }, true));
    expect(plan.after).toMatchObject({
      roleId: R.opsManager.id,
      scope: 'TEAM',
      reportsToId: null,
      overrides: [],
    });
    expect(actions(plan)).toEqual([
      ADMIN_TEAM_ACTIVITY_ACTIONS.ROLE_CHANGED,
      ADMIN_TEAM_ACTIVITY_ACTIONS.REPORTS_TO_CHANGED,
      ADMIN_TEAM_ACTIVITY_ACTIONS.SCOPE_CHANGED,
      ADMIN_TEAM_ACTIVITY_ACTIONS.PERMISSIONS_CHANGED,
    ]);
    expect(plan.events[1]!.metadata).toEqual({
      from: P.opsManager,
      to: null,
      cause: 'ROLE_CHANGED',
    });
    expect(plan.events[3]!.metadata).toEqual({
      granted: ['team.edit', 'team.message_team'],
      revoked: [],
    });
  });

  it('the same values are no change; a department needs a role in it', () => {
    const ctx = as(P.ceo);
    expect(
      planChange(
        ctx,
        P.opsIc,
        {
          roleId: R.opsIc.id,
          departmentId: D.ops,
          reportsToId: P.opsManager,
          scope: 'OWN_RECORDS',
          permissions: templateFor('INDIVIDUAL_CONTRIBUTOR'),
          status: 'ACTIVE',
        },
        true,
      ),
    ).toEqual({ plan: null });
    expect(refused(planChange(ctx, P.opsIc, { roleId: R.salesIc.id }, true))).toBe(
      'ROLE_NOT_IN_DEPARTMENT',
    );
    expect(
      refused(planChange(ctx, P.opsIc, { departmentId: D.closed, roleId: R.opsIc.id }, true)),
    ).toBe('ROLE_NOT_IN_DEPARTMENT');
    const moved = planned(
      planChange(ctx, P.opsIc, { departmentId: D.sales, roleId: R.salesIc.id }, true),
    );
    expect(actions(moved)).toContain(ADMIN_TEAM_ACTIVITY_ACTIONS.DEPARTMENT_CHANGED);
    expect(moved.after.departmentId).toBe(D.sales);
  });

  it('yourself, a CEO-level member, a peer: refused', () => {
    expect(refused(planChange(as(P.ceo), P.ceo, { status: 'SUSPENDED' }, true))).toBe(
      'SELF_CHANGE',
    );
    expect(refused(planChange(as(P.superNoRow), P.ceo, { status: 'SUSPENDED' }, true))).toBe(
      'PEER_PROTECTED',
    );
    expect(refused(planChange(as(P.coo), P.cro, { reportsToId: null }, true))).toBe(
      'PEER_PROTECTED',
    );
    expect(refused(planChange(as(P.coo), P.salesIc, { reportsToId: P.ceo }, true))).toBe(
      'NOT_FOUND',
    );
  });

  it('each kind of change needs its key', () => {
    // A Chief Officer may change roles and edit, but not status, departments or permissions.
    const coo = as(P.coo);
    expect(refused(planChange(coo, P.opsIc, { status: 'SUSPENDED' }, true))).toBe('FORBIDDEN');
    expect(refused(planChange(coo, P.opsIc, { scope: 'TEAM' }, true))).toBe('FORBIDDEN');
    expect(refused(planChange(coo, P.opsIc, { roleId: R.opsLead.id }, true))).toBeNull();
    expect(refused(planChange(coo, P.opsIc, { reportsToId: P.opsVp }, true))).toBeNull();
    const vp = as(P.opsVp);
    expect(refused(planChange(vp, P.opsIc, { roleId: R.opsLead.id }, true))).toBe('FORBIDDEN');
  });

  it('roles above the member’s authority, and HR’s VP roles for existing members: ROLE_CEILING', () => {
    expect(
      refused(planChange(as(P.ceo), P.opsVp, { roleId: R.ceo.id, departmentId: D.exec }, true)),
    ).toBe('ROLE_CEILING');
    expect(refused(planChange(as(P.coo), P.opsManager, { roleId: R.opsVp2.id }, true))).toBeNull();
    const hr = as(P.hrAdmin, {
      [P.hrAdmin]: { overrides: [{ key: 'team.change_role', state: 'ALLOW' }] },
    });
    expect(refused(planChange(hr, P.salesIc, { roleId: R.salesManager.id }, true))).toBeNull();
    expect(refused(planChange(hr, P.salesIc, { roleId: R.salesVp.id }, true))).toBe('ROLE_CEILING');
  });

  it('scope and permission ceilings, unknown keys and custom scopes', () => {
    const coo = as(P.coo, {
      [P.coo]: { overrides: [{ key: 'team.change_permissions', state: 'ALLOW' }] },
    });
    expect(refused(planChange(coo, P.opsIc, { scope: 'COMPANY' }, true))).toBe('SCOPE_CEILING');
    expect(refused(planChange(coo, P.opsIc, { scope: 'DEPARTMENT' }, true))).toBeNull();
    expect(
      refused(
        planChange(
          coo,
          P.opsIc,
          { scope: 'CUSTOM', customScope: { departmentIds: [D.ops], memberIds: [] } },
          true,
        ),
      ),
    ).toBe('SCOPE_CEILING');
    const base = templateFor('INDIVIDUAL_CONTRIBUTOR');
    expect(refused(planChange(coo, P.opsIc, { permissions: [...base, 'sales.view'] }, true))).toBe(
      'PERMISSION_CEILING',
    );
    const granted = planned(
      planChange(coo, P.opsIc, { permissions: [...base, 'team.message_department'] }, true),
    );
    expect(granted.after.overrides).toEqual([{ key: 'team.message_department', state: 'ALLOW' }]);
    expect(
      refused(planChange(as(P.ceo), P.opsIc, { permissions: [...base, 'nope.key'] }, true)),
    ).toBe('UNKNOWN_PERMISSION');
    const ceo = as(P.ceo);
    expect(
      refused(
        planChange(
          ceo,
          P.opsIc,
          { scope: 'CUSTOM', customScope: { departmentIds: [uuid(77)], memberIds: [] } },
          true,
        ),
      ),
    ).toBe('CUSTOM_SCOPE_INVALID');
    expect(
      refused(
        planChange(ceo, P.opsIc, { customScope: { departmentIds: [D.ops], memberIds: [] } }, true),
      ),
    ).toBe('CUSTOM_SCOPE_INVALID');
    const custom = planned(
      planChange(
        ceo,
        P.opsIc,
        { scope: 'CUSTOM', customScope: { departmentIds: [D.sales], memberIds: [P.cro] } },
        true,
      ),
    );
    expect(custom.after).toMatchObject({ scope: 'CUSTOM', scopeIds: [D.sales, P.cro] });
  });

  it('supervisors: valid, invalid, never below the person', () => {
    const ceo = as(P.ceo);
    expect(refused(planChange(ceo, P.opsManager, { reportsToId: P.opsIc }, true))).toBe(
      'SUPERVISOR_INVALID',
    );
    expect(refused(planChange(ceo, P.opsIc, { reportsToId: P.cro }, true))).toBe(
      'SUPERVISOR_INVALID',
    );
    expect(
      planned(planChange(ceo, P.opsIc, { reportsToId: P.opsVp }, true)).after.reportsToId,
    ).toBe(P.opsVp);
    expect(
      planned(planChange(ceo, P.opsIc, { reportsToId: null }, true)).after.reportsToId,
    ).toBeNull();
  });

  it('statuses: Pending Invitation only to Inactive or Deactivated; reactivation needs a password', () => {
    const ceo = as(P.ceo);
    expect(refused(planChange(ceo, P.invited, { status: 'SUSPENDED' }, true))).toBe(
      'STATUS_NOT_ALLOWED',
    );
    expect(planned(planChange(ceo, P.invited, { status: 'INACTIVE' }, true)).after.status).toBe(
      'INACTIVE',
    );
    expect(planned(planChange(ceo, P.opsIc2, { status: 'ACTIVE' }, true)).after.status).toBe(
      'ACTIVE',
    );
    const back = planned(planChange(ceo, P.opsIc2, { status: 'ACTIVE' }, false));
    expect(back.after.status).toBe('PENDING_INVITATION');
    expect(back.events.at(-1)!.metadata).toEqual({
      from: 'SUSPENDED',
      to: 'PENDING_INVITATION',
      requested: 'ACTIVE',
    });
    expect(refused(planChange(ceo, P.hire, { status: 'INACTIVE' }, true))).toBe('PENDING_APPROVAL');
    expect(refused(planChange(ceo, P.hire, { roleId: R.salesManager.id }, true))).toBe(
      'PENDING_APPROVAL',
    );
  });
});

describe('name, phone and the version (planProfile)', () => {
  const ctx = as(P.ceo);
  it('the same name and phone are no change; a split that reads the same is no change', () => {
    expect(
      planProfile(ctx, P.opsIc, { firstName: 'Mary', lastName: 'Ann Fake', phone: '+15555550101' }),
    ).toBeNull();
    expect(planProfile(ctx, P.opsIc, { firstName: 'Mary Ann', lastName: 'Fake' })).toBeNull();
    expect(planProfile(ctx, P.opsIc, { roleId: R.opsLead.id })).toBeNull();
  });

  it('a new name or phone is a change: "First Last" and E.164 or none', () => {
    expect(planProfile(ctx, P.opsIc, { firstName: 'Marie' })).toEqual({ name: 'Marie Ann Fake' });
    expect(planProfile(ctx, P.opsIc, { lastName: '  Fakest  Person ' })).toEqual({
      name: 'Mary Fakest Person',
    });
    expect(planProfile(ctx, P.opsIc, { phone: null })).toEqual({ phone: null });
    expect(planProfile(ctx, P.opsIc, { firstName: 'Mary', phone: '+15555550199' })).toEqual({
      phone: '+15555550199',
    });
  });

  it('a stale version is 409; the version read passes', () => {
    expect(
      codeOf(() => planProfile(ctx, P.opsIc, { expectedUpdatedAt: new Date(NOW).toISOString() })),
    ).toBe('CONFLICT');
    const at = ctx.members.get(P.opsIc)!.updatedAt.toISOString();
    expect(codeOf(() => planProfile(ctx, P.opsIc, { expectedUpdatedAt: at }))).toBeNull();
  });

  it('yourself always; anyone else within reach and with team.edit', () => {
    expect(planProfile(as(P.opsIc), P.opsIc, { firstName: 'Marie' })).toEqual({
      name: 'Marie Ann Fake',
    });
    expect(planProfile(as(P.ceo), P.ceo, { phone: '+15555550123' })).toEqual({
      phone: '+15555550123',
    });
    expect(codeOf(() => planProfile(as(P.superNoRow), P.ceo, { firstName: 'Other' }))).toBe(
      'PEER_PROTECTED',
    );
    expect(codeOf(() => planProfile(as(P.coo), P.cro, { firstName: 'Other' }))).toBe(
      'PEER_PROTECTED',
    );
    // A manager without team.edit (taken away by an override).
    const lead = as(P.opsManager, {
      [P.opsManager]: { overrides: [{ key: 'team.edit', state: 'DENY' }] },
    });
    expect(codeOf(() => planProfile(lead, P.opsIc, { firstName: 'Other' }))).toBe('FORBIDDEN');
    expect(planProfile(as(P.opsManager), P.opsIc, { firstName: 'Other' })).toEqual({
      name: 'Other Ann Fake',
    });
  });

  it('the plan: the login’s columns, the row’s version moved, field names only in the audit', () => {
    const ctx = as(P.ceo);
    const alone = withProfile(ctx, P.opsIc, null, { name: 'Marie Fake', phone: null });
    expect(alone.profile).toEqual({ name: 'Marie Fake', phone: null });
    expect(alone.after.updatedAt.getTime()).toBe(NOW);
    expect(alone.events).toEqual([
      {
        action: ADMIN_TEAM_ACTIVITY_ACTIONS.PROFILE_UPDATED,
        metadata: { fields: ['name', 'phone'] },
      },
    ]);
    const role = planned(planChange(ctx, P.opsIc, { roleId: R.opsLead.id }, true));
    const both = withProfile(ctx, P.opsIc, role, { phone: '+15555550199' });
    expect(actions(both)[0]).toBe(ADMIN_TEAM_ACTIVITY_ACTIONS.PROFILE_UPDATED);
    expect(both.events[0]!.metadata).toEqual({ fields: ['phone'] });
    expect(both.after.roleId).toBe(R.opsLead.id);
    expect(JSON.stringify(both.events)).not.toContain('+15555550199');
    // Yourself: your name only; anything else on your own row is still SELF_CHANGE.
    expect(refused(planChange(as(P.opsIc), P.opsIc, { roleId: R.opsLead.id }, true))).toBe(
      'SELF_CHANGE',
    );
  });
});

describe('a bulk change (planBulk)', () => {
  it('skips with reasons, counts the unchanged, refuses the request’s own problems', () => {
    const ctx = as(P.ceo);
    const unknown = uuid(888);
    const result = planBulk(
      ctx,
      [P.opsIc, P.ceo, unknown, P.hire, P.opsIc2],
      { type: 'STATUS', status: 'SUSPENDED' },
      new Set(),
    );
    expect(result.plans.map((p) => p.id)).toEqual([P.opsIc]);
    expect(result.unchanged).toBe(1);
    expect(result.skipped).toEqual([
      { id: P.ceo, name: 'Fake Ceo', reason: 'SELF' },
      { id: unknown, name: null, reason: 'NOT_FOUND' },
      { id: P.hire, name: 'Fake Hire', reason: 'PENDING_APPROVAL' },
    ]);
    const roles = planBulk(
      ctx,
      [P.opsIc, P.salesIc],
      { type: 'ROLE', roleId: R.opsLead.id },
      new Set(),
    );
    expect(roles.plans.map((p) => p.id)).toEqual([P.opsIc]);
    expect(roles.skipped).toEqual([
      { id: P.salesIc, name: 'Fake Seller', reason: 'NOT_IN_DEPARTMENT' },
    ]);
    expect(
      codeOf(() => planBulk(ctx, [P.opsIc], { type: 'ROLE', roleId: uuid(555) }, new Set())),
    ).toBe('ROLE_NOT_IN_DEPARTMENT');
    expect(
      codeOf(() =>
        planBulk(
          ctx,
          [P.opsIc],
          { type: 'DEPARTMENT', departmentId: D.sales, roleId: R.opsIc.id },
          new Set(),
        ),
      ),
    ).toBe('ROLE_NOT_IN_DEPARTMENT');
    expect(
      codeOf(() =>
        planBulk(as(P.coo), [P.opsIc], { type: 'STATUS', status: 'INACTIVE' }, new Set()),
      ),
    ).toBe('FORBIDDEN');
  });

  it('highest level first: a supervisor changed in the same request is seen', () => {
    const result = planBulk(
      as(P.ceo),
      [P.opsIc, P.opsManager],
      { type: 'ROLE', roleId: R.opsLead.id },
      new Set(),
    );
    expect(result.plans.map((p) => p.id)).toEqual([P.opsManager, P.opsIc]);
    // The manager is a Lead now, the same level: the Lead line to them is dropped.
    expect(result.plans[1]!.after.reportsToId).toBeNull();
  });

  it('a role that would wait for the department head is skipped; the CEO role is above anyone', () => {
    const hr = as(P.hrAdmin, {
      [P.hrAdmin]: { overrides: [{ key: 'team.change_role', state: 'ALLOW' }] },
    });
    expect(
      planBulk(hr, [P.salesIc], { type: 'ROLE', roleId: R.salesVp.id }, new Set()).skipped,
    ).toEqual([{ id: P.salesIc, name: 'Fake Seller', reason: 'NEEDS_APPROVAL' }]);
    expect(
      planBulk(as(P.ceo), [P.chiefOfStaff], { type: 'ROLE', roleId: R.ceo.id }, new Set()).skipped,
    ).toEqual([{ id: P.chiefOfStaff, name: 'Fake Staff Chief', reason: 'ROLE_CEILING' }]);
  });
});

describe('the department head’s decision (planDecision)', () => {
  const approve = { decision: 'APPROVE' as const, invite: { email: true, sms: false } };

  it('the department’s Chief Officer or the CEO approves: Pending Invitation, a link made', () => {
    const plan = planDecision(as(P.cro), P.hire, approve);
    expect(plan.after).toMatchObject({
      status: 'PENDING_INVITATION',
      intendedRoleId: null,
      roleId: R.salesVp.id,
      approvedById: P.cro,
    });
    expect(plan.events[0]).toEqual({
      action: ADMIN_TEAM_ACTIVITY_ACTIONS.APPROVED,
      metadata: {
        intendedRoleId: R.salesVp.id,
        roleId: R.salesVp.id,
        from: 'PENDING_DEPARTMENT_HEAD_APPROVAL',
        to: 'PENDING_INVITATION',
        invite: { email: true, sms: false },
        invitationSent: true,
      },
    });
    expect(planDecision(as(P.ceo), P.hire, approve).after.approvedById).toBe(P.ceo);
    const silent = planDecision(as(P.ceo), P.hire, {
      ...approve,
      invite: { email: false, sms: false },
    });
    expect(silent.events[0]!.metadata.invitationSent).toBe(false);
  });

  it('refusals: another department’s head, a role that is not a VP there, no phone, not waiting', () => {
    expect(codeOf(() => planDecision(as(P.chro), P.hire, approve))).toBe('FORBIDDEN');
    expect(codeOf(() => planDecision(as(P.cro), P.hire, { ...approve, roleId: R.opsVp.id }))).toBe(
      'ROLE_NOT_ALLOWED',
    );
    expect(
      codeOf(() => planDecision(as(P.cro), P.hire, { ...approve, roleId: R.salesManager.id })),
    ).toBe('ROLE_NOT_ALLOWED');
    expect(
      codeOf(() =>
        planDecision(as(P.cro), P.hire, { ...approve, invite: { email: true, sms: true } }),
      ),
    ).toBe('PHONE_REQUIRED');
    expect(codeOf(() => planDecision(as(P.ceo), P.opsIc, approve))).toBe('NOT_PENDING_APPROVAL');
    expect(codeOf(() => planDecision(as(P.ceo), uuid(404), approve))).toBe('NOT_FOUND');
  });

  it('reject: Inactive, the intended role cleared', () => {
    const plan = planDecision(as(P.ceo), P.hire, { decision: 'REJECT', reason: 'Fake reason' });
    expect(plan.after).toMatchObject({ status: 'INACTIVE', intendedRoleId: null });
    expect(plan.events[0]!.metadata).toEqual({
      intendedRoleId: R.salesVp.id,
      from: 'PENDING_DEPARTMENT_HEAD_APPROVAL',
      to: 'INACTIVE',
      reasonGiven: true,
    });
  });
});

describe('the views', () => {
  it('a member: split name, references, keys and what the signed-in member may do', () => {
    const view = memberView(as(P.ceo), P.opsIc, NO_EXTRAS);
    expect(view).toMatchObject({
      firstName: 'Mary',
      lastName: 'Ann Fake',
      department: { id: D.ops, code: 'OPERATIONS' },
      role: { id: R.opsIc.id, level: 'INDIVIDUAL_CONTRIBUTOR' },
      accessLevel: 'STANDARD',
      reportsTo: { id: P.opsManager, name: 'Fake Ops Manager' },
      customPermissions: false,
      isYou: false,
      allowed: {
        edit: true,
        changeRole: true,
        changeStatus: true,
        approve: false,
        resendInvitation: false,
        message: true,
      },
    });
    const invited = memberActions(as(P.ceo), personOf(as(P.ceo), P.invited));
    expect(invited.resendInvitation).toBe(true);
    expect(memberActions(as(P.opsVp), personOf(as(P.opsVp), P.invited)).resendInvitation).toBe(
      false,
    );
    // Yourself: Edit (your name and phone), nothing else.
    expect(memberActions(as(P.opsIc), personOf(as(P.opsIc), P.opsIc))).toMatchObject({
      edit: true,
      changeRole: false,
      changeStatus: false,
      customizePermissions: false,
      resendInvitation: false,
    });
    const hire = memberView(as(P.cro), P.hire, NO_EXTRAS);
    expect(hire.intendedRole?.id).toBe(R.salesVp.id);
    expect(hire.allowed).toMatchObject({ approve: true, changeRole: false, changeStatus: false });
    expect(memberActions(as(P.ceo), personOf(as(P.ceo), P.ceo)).message).toBe(false);
  });

  it('form options: what the member may give, supervisors above, statuses for this person', () => {
    const manager = formOptionsOf(as(P.opsManager));
    expect(manager.roles.map((r) => r.id).sort()).toEqual([R.opsLead.id, R.opsIc.id].sort());
    expect(manager).toMatchObject({
      departmentLocked: true,
      unrestricted: false,
      canCustomize: false,
    });
    expect(manager.scopes).toEqual(['TEAM', 'DIRECT_REPORTS', 'OWN_RECORDS']);
    const hr = formOptionsOf(as(P.hrAdmin));
    expect(hr.roles.find((r) => r.id === R.salesVp.id)?.needsApproval).toBe(true);
    expect(hr.roles.some((r) => r.id === R.cro.id || r.id === R.ceo.id)).toBe(false);
    const edit = formOptionsOf(as(P.ceo), P.opsManager);
    expect(edit.supervisors.map((s) => s.id)).not.toContain(P.opsIc);
    expect(edit.supervisors.map((s) => s.id)).not.toContain(P.opsManager);
    expect(edit.supervisors[0]!.level).toBe('CEO');
    expect(edit.statuses).toEqual(['ACTIVE', 'SUSPENDED', 'INACTIVE', 'DEACTIVATED']);
    expect(formOptionsOf(as(P.ceo), P.invited).statuses).toEqual([
      'PENDING_INVITATION',
      'INACTIVE',
      'DEACTIVATED',
    ]);
    expect(formOptionsOf(as(P.ceo)).statuses).toEqual([]);
    expect(codeOf(() => formOptionsOf(as(P.coo), P.salesIc))).toBe('NOT_FOUND');
  });

  it('summary, search and sort', () => {
    const ctx = as(P.ceo);
    const people = [...ctx.chart.people.values()];
    const summary = summaryOf(
      people.map((p) => ({
        status: p.status,
        level: p.level,
        createdAt: ctx.members.get(p.id)!.createdAt,
      })),
      NOW,
    );
    expect(summary).toMatchObject({
      total: 13,
      addedLast30Days: 1,
      active: 10,
      inactive: 1,
      pending: 2,
    });
    expect(Object.values(summary.byStatus).reduce((a, b) => a + b, 0)).toBe(13);
    expect(summary.admins + summary.standard).toBe(13);
    const views: AdminTeamMember[] = people.map((p) => memberView(ctx, p.id, NO_EXTRAS));
    expect(views.filter((v) => matchesSearch(v, '555-0101')).map((v) => v.id)).toEqual([]);
    expect(views.filter((v) => matchesSearch(v, '5555550101')).map((v) => v.id)).toEqual([P.opsIc]);
    expect(views.filter((v) => matchesSearch(v, 'pending department')).map((v) => v.id)).toEqual([
      P.hire,
    ]);
    const byLevel = sortMembers(views, 'ACCESS_LEVEL');
    expect(byLevel[0]!.accessLevel).toBe('SUPER_ADMIN');
    expect(sortMembers(views, 'NAME', 'desc')[0]!.name).toBe('Mary Ann Fake');
    const statuses = sortMembers(views, 'STATUS').map((v) => v.status as AdminTeamStatus);
    expect(statuses[0]).toBe('PENDING_INVITATION');
  });

  it('an audit row as an activity entry, with today’s titles and names', () => {
    const ctx = as(P.ceo);
    const entry = activityEntry(ctx, {
      id: uuid(901),
      action: ADMIN_TEAM_ACTIVITY_ACTIONS.ROLE_CHANGED,
      createdAt: new Date(NOW),
      actorUserId: P.ceo,
      metadata: { from: R.opsIc.id, to: R.opsManager.id },
    })!;
    expect(adminTeamActivityText(entry)).toBe(
      'Role changed: Operations Specialist → Operations Manager',
    );
    const keys = activityEntry(ctx, {
      id: uuid(902),
      action: ADMIN_TEAM_ACTIVITY_ACTIONS.PERMISSIONS_CHANGED,
      createdAt: new Date(NOW),
      actorUserId: null,
      metadata: { granted: ['sales.view', 'Not A Key'], revoked: [] },
    })!;
    expect(keys).toMatchObject({ actor: null, granted: ['sales.view'], revoked: [] });
    expect(
      activityEntry(ctx, {
        id: uuid(903),
        action: 'platform_member.something_else',
        createdAt: new Date(NOW),
        actorUserId: null,
        metadata: null,
      }),
    ).toBeNull();
  });
});

describe('Add Team Member (planCreate)', () => {
  const body = (over: Partial<CreateBody> = {}): CreateBody => ({
    firstName: 'Fake',
    lastName: 'Newcomer Person',
    email: 'fake-new@example.test',
    departmentId: D.ops,
    roleId: R.opsIc.id,
    reportsToId: null,
    invite: { email: true, sms: false },
    ...over,
  });

  it('the CEO adds anyone below the CEO: Pending Invitation, the role’s template and scope', () => {
    const plan = planCreate(as(P.ceo), body({ reportsToId: P.opsManager, phone: '+15555550111' }));
    expect(plan).toMatchObject({
      email: 'fake-new@example.test',
      name: 'Fake Newcomer Person',
      phone: '+15555550111',
      row: {
        roleId: R.opsIc.id,
        departmentId: D.ops,
        reportsToId: P.opsManager,
        scope: 'OWN_RECORDS',
        scopeIds: [],
        status: 'PENDING_INVITATION',
        intendedRoleId: null,
      },
      overrides: [],
      invite: { email: true, sms: false },
    });
    expect(plan.created).toEqual({
      action: ADMIN_TEAM_ACTIVITY_ACTIONS.CREATED,
      metadata: {
        roleId: R.opsIc.id,
        departmentId: D.ops,
        reportsToId: P.opsManager,
        scope: 'OWN_RECORDS',
        status: 'PENDING_INVITATION',
      },
    });
    const text = JSON.stringify(plan.created);
    for (const value of ['Fake', 'fake-new@example.test', '+15555550111'])
      expect(text).not.toContain(value);
    expect(planCreate(as(P.ceo), body({ invite: { email: false, sms: false } })).invite).toBeNull();
  });

  it('keys and scope beyond the role are stored as overrides, in the audit entry as keys', () => {
    const plan = planCreate(
      as(P.ceo),
      body({
        permissions: [...templateFor('INDIVIDUAL_CONTRIBUTOR'), 'sales.view'],
        scope: 'CUSTOM',
        customScope: { departmentIds: [D.sales], memberIds: [P.cro] },
      }),
    );
    expect(plan.overrides).toEqual([{ key: 'sales.view', state: 'ALLOW' }]);
    expect(plan.row).toMatchObject({ scope: 'CUSTOM', scopeIds: [D.sales, P.cro] });
    expect(plan.created.metadata).toMatchObject({
      granted: ['sales.view'],
      revoked: [],
      scopeIds: [D.sales, P.cro],
    });
  });

  it('HR’s VP / Director hire waits for the department head: no invitation yet', () => {
    const hr = as(P.hrAdmin, {
      [P.hrAdmin]: { overrides: [{ key: 'team.create', state: 'ALLOW' }] },
    });
    const plan = planCreate(hr, body({ departmentId: D.sales, roleId: R.salesVp.id }));
    expect(plan.row).toMatchObject({
      roleId: R.salesVp.id,
      status: 'PENDING_DEPARTMENT_HEAD_APPROVAL',
      intendedRoleId: R.salesVp.id,
    });
    expect(plan.invite).toBeNull();
    expect(planCreate(hr, body({ departmentId: D.sales, roleId: R.salesIc.id })).row.status).toBe(
      'PENDING_INVITATION',
    );
  });

  it('the refusals, in order', () => {
    const ceo = as(P.ceo);
    const coo = as(P.coo);
    const icKeys = templateFor('INDIVIDUAL_CONTRIBUTOR');
    // A manager's template has no team.create.
    expect(codeOf(() => planCreate(as(P.opsManager), body({ roleId: R.opsLead.id })))).toBe(
      'FORBIDDEN',
    );
    expect(codeOf(() => planCreate(ceo, body({ roleId: R.salesIc.id })))).toBe(
      'ROLE_NOT_IN_DEPARTMENT',
    );
    expect(codeOf(() => planCreate(ceo, body({ departmentId: D.closed })))).toBe(
      'ROLE_NOT_IN_DEPARTMENT',
    );
    expect(codeOf(() => planCreate(ceo, body({ roleId: uuid(998) })))).toBe(
      'ROLE_NOT_IN_DEPARTMENT',
    );
    const unknownScope = { departmentIds: [uuid(997)], memberIds: [] };
    expect(
      codeOf(() => planCreate(ceo, body({ scope: 'CUSTOM', customScope: unknownScope }))),
    ).toBe('CUSTOM_SCOPE_INVALID');
    expect(codeOf(() => planCreate(coo, body({ scope: 'TEAM' })))).toBe('FORBIDDEN');
    expect(codeOf(() => planCreate(coo, body({ permissions: [...icKeys, 'sales.view'] })))).toBe(
      'FORBIDDEN',
    );
    expect(
      codeOf(() => planCreate(coo, body({ departmentId: D.sales, roleId: R.salesIc.id }))),
    ).toBe('DEPARTMENT_NOT_ALLOWED');
    expect(codeOf(() => planCreate(ceo, body({ departmentId: D.exec, roleId: R.ceo.id })))).toBe(
      'ROLE_CEILING',
    );
    expect(codeOf(() => planCreate(coo, body({ roleId: R.coo.id })))).toBe('ROLE_CEILING');
    const customizer = as(P.coo, {
      [P.coo]: { overrides: [{ key: 'team.change_permissions', state: 'ALLOW' }] },
    });
    expect(codeOf(() => planCreate(customizer, body({ scope: 'COMPANY' })))).toBe('SCOPE_CEILING');
    expect(
      codeOf(() => planCreate(customizer, body({ permissions: ['team.view', 'not.a_key'] }))),
    ).toBe('UNKNOWN_PERMISSION');
    expect(
      codeOf(() => planCreate(customizer, body({ permissions: ['team.view', 'sales.view'] }))),
    ).toBe('PERMISSION_CEILING');
    expect(codeOf(() => planCreate(ceo, body({ reportsToId: P.salesIc })))).toBe(
      'SUPERVISOR_INVALID',
    );
    expect(codeOf(() => planCreate(coo, body({ reportsToId: uuid(996) })))).toBe(
      'SUPERVISOR_INVALID',
    );
  });

  it('409 EMAIL_TAKEN for someone on the team only; a half-made login is reused', () => {
    const ceo = as(P.ceo);
    // An org-chart member, and a Super Admin with no org-chart row yet.
    expect(codeOf(() => planCreate(ceo, body({ email: '0205@example.test' })))).toBe('EMAIL_TAKEN');
    expect(codeOf(() => planCreate(ceo, body({ email: '0213@example.test' })))).toBe('EMAIL_TAKEN');
    // A TEAM_MEMBER admin row with no org-chart row: a create that failed half-way.
    expect(planCreate(ceo, body({ email: '0214@example.test' })).email).toBe('0214@example.test');
    // A refusal before the email says nothing about who is on the team.
    expect(codeOf(() => planCreate(as(P.opsManager), body({ email: '0205@example.test' })))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('Resend Invitation (planResend)', () => {
  it('those still Pending Invitation; the rest skipped with reasons, in order', () => {
    const stranger = uuid(995);
    expect(planResend(as(P.ceo), [P.opsIc, P.invited, stranger, P.ceo])).toEqual({
      targets: [P.invited],
      skipped: [
        { id: P.opsIc, name: 'Mary Ann Fake', reason: 'NOT_PENDING_INVITATION' },
        { id: stranger, name: null, reason: 'NOT_FOUND' },
        { id: P.ceo, name: 'Fake Ceo', reason: 'SELF' },
      ],
    });
    expect(planResend(as(P.coo), [P.invited, P.cro]).skipped).toEqual([
      { id: P.cro, name: 'Fake Cro', reason: 'OUT_OF_REACH' },
    ]);
    expect(codeOf(() => planResend(as(P.opsManager), [P.invited]))).toBe('FORBIDDEN');
  });
});

describe('the invitation (token, caps, messages)', () => {
  const secrets = {
    ADMIN: 'fake-admin-pool-secret-for-unit-tests-only',
    STAFF: 'fake-staff-pool-secret-for-unit-tests-only',
  };
  const tokens = new TeamInvitationTokens(secrets);
  const updatedAt = new Date('2026-10-20T12:00:00.123Z');
  const member = { userId: P.invited, status: 'PENDING_INVITATION', updatedAt };
  const later = invitationExpiry();

  it('seals and opens the user id and the member row’s version', async () => {
    const token = await tokens.seal(P.invited, updatedAt, later);
    expect(token).not.toContain(P.invited);
    const opened = (await tokens.open(token))!;
    expect(opened).toEqual({ userId: P.invited, memberUpdatedAt: updatedAt, expiresAt: later });
    expect(TeamInvitationTokens.stillValid(opened, member)).toBe(true);
  });

  it('a changed member row (a resend, any change), another status or person: refused', async () => {
    const opened = (await tokens.open(await tokens.seal(P.invited, updatedAt, later)))!;
    const touched = new Date(updatedAt.getTime() + 1);
    expect(TeamInvitationTokens.stillValid(opened, { ...member, updatedAt: touched })).toBe(false);
    expect(TeamInvitationTokens.stillValid(opened, { ...member, status: 'ACTIVE' })).toBe(false);
    expect(TeamInvitationTokens.stillValid(opened, { ...member, userId: P.opsIc })).toBe(false);
  });

  it('expired, tampered with, another key or another pool’s secret: does not open', async () => {
    const token = await tokens.seal(P.invited, updatedAt, later);
    const expired = await tokens.seal(P.invited, updatedAt, new Date(Date.now() - 1000));
    expect(await tokens.open(expired)).toBeUndefined();
    expect(await tokens.open(`${token.slice(0, -2)}xx`)).toBeUndefined();
    const other = new TeamInvitationTokens({ ADMIN: 'another-admin-pool-secret-for-unit-tests' });
    expect(await other.open(token)).toBeUndefined();
    const staffSecret = new TeamInvitationTokens({ ADMIN: secrets.STAFF });
    expect(await staffSecret.open(token)).toBeUndefined();
  });

  it('7 days, in whole seconds; the daily caps', () => {
    const at = Date.parse('2026-10-20T12:00:00.789Z');
    expect(invitationExpiry(at).toISOString()).toBe('2026-10-27T12:00:00.000Z');
    const { perPlatform, perPerson } = TEAM_INVITE_LIMITS;
    expect(overLimit({ platform: 0, person: 0 })).toBe(false);
    expect(overLimit({ platform: perPlatform - 1, person: perPerson - 1 })).toBe(false);
    expect(overLimit({ platform: perPlatform, person: 0 })).toBe(true);
    expect(overLimit({ platform: 0, person: perPerson })).toBe(true);
  });

  it('the link carries the token in its fragment; the messages carry the link and the expiry', () => {
    const link = invitationLink('https://admin.dev.firmivra.test', 'abc.def');
    expect(link).toBe('https://admin.dev.firmivra.test/activate#token=abc.def');
    const email = invitationEmail('Fake Person', link, new Date('2026-10-27T16:30:00.000Z'));
    expect(email).toMatchObject({
      name: 'Fake Person',
      subject: "You're invited to join the Firmivra team",
    });
    expect(email.body).toContain(link);
    expect(email.body).toContain('Tuesday, October 27, 2026 at 12:30 PM EDT');
    expect(invitationSms(link).body).toContain(link);
  });
});
