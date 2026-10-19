import { describe, expect, it } from 'vitest';
import {
  ADMIN_TEAM_ERRORS,
  ADMIN_TEAM_SKIP_REASON_LABELS,
  ADMIN_TEAM_STATUS_LABELS,
  type AdminTeamActivityEntry,
  adminTeamAccessLevel,
  adminTeamActivityText,
  AdminTeamErrorCode,
  type AdminTeamFormPerson,
  adminTeamGrantable,
  type AdminTeamMember,
  AdminTeamMembersQuery,
  type AdminTeamModule,
  adminTeamNameParts,
  adminTeamSamePermissions,
  adminTeamScopeRank,
  AdminTeamSkipReason,
  AdminTeamStatus,
  AdminTeamSummary,
  adminTeamSupervisorsFor,
  ApiRequestError,
  createAdminTeamClient,
  type CreateAdminTeamMemberRequest,
  createRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = (n: number) => `0199d1a0-7e00-7000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-20T09:00:00.000Z';
const client = (fn: typeof fetch) =>
  createAdminTeamClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

const SALES = { id: id(20), code: 'REVENUE_SALES', name: 'Revenue / Sales' };
const MANAGER = { id: id(30), code: 'REVENUE_SALES_SALES_MANAGER', title: 'Sales Manager' };

/** A synthetic team member as the API answers it. */
const member = (patch: Partial<AdminTeamMember> = {}): AdminTeamMember => ({
  id: id(1),
  firstName: 'Avery',
  lastName: 'Example',
  name: 'Avery Example',
  email: 'avery@example.test',
  phone: '+15550100123',
  department: SALES,
  role: { ...MANAGER, level: 'MANAGER' },
  intendedRole: null,
  accessLevel: 'ADMIN',
  reportsTo: { id: id(2), name: 'Morgan Admin' },
  scope: 'TEAM',
  customScope: null,
  permissions: ['team.view', 'team.edit'],
  customPermissions: false,
  status: 'PENDING_INVITATION',
  invitedBy: { id: id(2), name: 'Morgan Admin' },
  approvedBy: null,
  invitation: { sentAt: at, expiresAt: '2026-10-27T09:00:00.000Z' },
  lastSignedInAt: null,
  createdAt: at,
  updatedAt: at,
  isYou: false,
  allowed: {
    edit: true,
    changeRole: true,
    changeDepartment: true,
    changeStatus: true,
    customizePermissions: true,
    approve: false,
    resendInvitation: true,
    message: true,
  },
  ...patch,
});

const byStatus = Object.fromEntries(AdminTeamStatus.options.map((status) => [status, 0])) as Record<
  AdminTeamStatus,
  number
>;

const base: CreateAdminTeamMemberRequest = {
  firstName: 'Avery',
  lastName: 'Example',
  email: 'avery@example.test',
  departmentId: SALES.id,
  roleId: MANAGER.id,
};

describe('admin team client', () => {
  it('reads the signed-in member, their rights, the catalog and the filters', async () => {
    const meta = {
      viewer: {
        id: id(2),
        name: 'Morgan Admin',
        role: { id: id(31), code: 'EXECUTIVE_CEO', title: 'CEO', level: 'CEO' },
        department: { id: id(21), code: 'EXECUTIVE', name: 'Executive' },
        scope: 'COMPANY',
        unrestricted: true,
        permissions: ['team.view', 'team.create'],
      },
      can: {
        add: true,
        edit: true,
        changeRole: true,
        changeDepartment: true,
        changeStatus: true,
        customizePermissions: true,
        approve: true,
      },
      modules: [
        {
          id: 'team',
          label: 'Team',
          description: 'View members, add users, edit users, change roles',
          permissions: [
            { key: 'team.view', label: 'View team directory', action: 'view', requires: [] },
            {
              key: 'team.create',
              label: 'Add team member',
              action: 'create',
              requires: ['team.view'],
            },
          ],
        },
      ],
      filters: {
        departments: [SALES],
        roles: [{ id: MANAGER.id, title: MANAGER.title, departmentId: SALES.id }],
        statuses: ['ACTIVE'],
        accessLevels: ['SUPER_ADMIN', 'ADMIN', 'STANDARD'],
        supervisors: [{ id: id(2), name: 'Morgan Admin' }],
      },
    };
    const { fn, calls } = fakeFetch(200, meta);
    const answer = await client(fn).meta();
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/admin/team/meta' });
    expect(answer.viewer.unrestricted).toBe(true);
    expect(answer.modules[0]?.permissions[1]?.requires).toEqual(['team.view']);
  });

  it('reads the KPI row with a count for every status', async () => {
    const summary = {
      total: 3,
      addedLast30Days: 1,
      admins: 2,
      standard: 1,
      active: 2,
      inactive: 0,
      pending: 1,
      byStatus: { ...byStatus, ACTIVE: 2, PENDING_INVITATION: 1 },
    };
    const { fn, calls } = fakeFetch(200, summary);
    expect((await client(fn).summary()).byStatus.ACTIVE).toBe(2);
    expect(calls[0]?.url).toBe('/api/v1/admin/team/summary');
    // z.record over an enum needs every key.
    const { DEACTIVATED: _gone, ...missing } = summary.byStatus;
    expect(AdminTeamSummary.safeParse({ ...summary, byStatus: missing }).success).toBe(false);
  });

  it('sends the directory filters, several statuses as one comma-separated parameter', async () => {
    const { fn, calls } = fakeFetch(200, { items: [member()], total: 1, page: 2, pageSize: 12 });
    const page = await client(fn).members({
      search: '  avery ',
      departmentId: SALES.id,
      statuses: ['SUSPENDED', 'INACTIVE'],
      accessLevel: 'ADMIN',
      sort: 'LAST_SIGNED_IN',
      dir: 'desc',
      page: 2,
    });
    expect(page.items[0]?.department.code).toBe('REVENUE_SALES');
    const url = new URL(calls[0]!.url, 'http://x');
    expect(url.pathname).toBe('/api/v1/admin/team/members');
    expect(url.searchParams.get('search')).toBe('avery');
    expect(url.searchParams.get('statuses')).toBe('SUSPENDED,INACTIVE');
    expect(url.searchParams.get('accessLevel')).toBe('ADMIN');
    expect(url.searchParams.get('sort')).toBe('LAST_SIGNED_IN');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('roleId')).toBe(false);
    expect(url.searchParams.has('reportsToId')).toBe(false);
  });

  it('reads the query string back (the API parses the same schema)', () => {
    const parsed = AdminTeamMembersQuery.parse({
      statuses: 'ACTIVE,PENDING_INVITATION',
      page: '3',
      pageSize: '100',
    });
    expect(parsed.statuses).toEqual(['ACTIVE', 'PENDING_INVITATION']);
    expect(parsed.page).toBe(3);
    expect(AdminTeamMembersQuery.safeParse({ statuses: 'ONLINE' }).success).toBe(false);
    expect(AdminTeamMembersQuery.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(AdminTeamMembersQuery.safeParse({ locationId: id(9) }).success).toBe(false);
    expect(AdminTeamMembersQuery.safeParse({ search: 'x'.repeat(101) }).success).toBe(false);
  });

  it('reads one person, their activity and the form choices', async () => {
    const { fn, calls } = fakeFetch(200, member());
    const api = client(fn);
    expect((await api.member(id(1))).email).toBe('avery@example.test');
    expect(calls[0]?.url).toBe(`/api/v1/admin/team/members/${id(1)}`);

    const entry: AdminTeamActivityEntry = {
      id: id(50),
      kind: 'ROLE_CHANGED',
      at,
      actor: { id: id(2), name: 'Morgan Admin' },
      previousValue: 'Account Executive',
      newValue: 'Sales Manager',
      granted: [],
      revoked: [],
      approver: null,
      reason: null,
    };
    const activity = fakeFetch(200, { items: [entry] });
    const items = await client(activity.fn).activity(id(1), { limit: 8 });
    expect(items).toHaveLength(1);
    expect(activity.calls[0]?.url).toBe(`/api/v1/admin/team/members/${id(1)}/activity?limit=8`);

    const options = {
      departments: [SALES],
      departmentLocked: true,
      roles: [],
      supervisors: [],
      executiveDepartmentId: id(21),
      scopes: ['TEAM', 'DIRECT_REPORTS', 'OWN_RECORDS'],
      ceiling: ['team.view'],
      unrestricted: false,
      canCustomize: false,
      statuses: [],
    };
    const form = fakeFetch(200, options);
    await client(form.fn).formOptions();
    await client(form.fn).formOptions(id(1));
    expect(form.calls.map((call) => call.url)).toEqual([
      '/api/v1/admin/team/form-options',
      `/api/v1/admin/team/members/${id(1)}/form-options`,
    ]);

    await expect(api.member('not-an-id')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(api.activity(id(1), { limit: 101 })).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('adds a member with the defaults filled in and the contact normalized', async () => {
    const { fn, calls } = fakeFetch(201, { member: member(), invitation: null });
    await client(fn).createMember({
      ...base,
      firstName: ' Avery ',
      email: ' Avery@Example.TEST ',
      phone: '(555) 010-0123',
      permissions: ['team.view', 'team.edit'],
    });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/team/members' });
    expect(calls[0]!.body).toEqual({
      firstName: 'Avery',
      lastName: 'Example',
      email: 'avery@example.test',
      phone: '+15550100123',
      departmentId: SALES.id,
      roleId: MANAGER.id,
      reportsToId: null,
      permissions: ['team.view', 'team.edit'],
      invite: { email: true, sms: false },
    });
  });

  it('refuses a bad new member before sending anything', async () => {
    const { fn, calls } = fakeFetch(201, { member: member(), invitation: null });
    const api = client(fn);
    await expect(api.createMember({ ...base, firstName: '   ' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Enter a first name',
    });
    await expect(api.createMember({ ...base, lastName: 'x'.repeat(51) })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(api.createMember({ ...base, email: 'not-an-email' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.createMember({ ...base, invite: { email: true, sms: true } }),
    ).rejects.toMatchObject({ message: 'Add a phone number to send a text invitation' });
    await expect(
      api.createMember({
        ...base,
        scope: 'TEAM',
        customScope: { departmentIds: [], memberIds: [] },
      }),
    ).rejects.toMatchObject({ message: 'Choose departments or people only for a custom scope' });
    await expect(
      api.createMember({ ...base, permissions: ['team.view', 'team.view'] }),
    ).rejects.toMatchObject({ message: 'A permission is chosen twice' });
    await expect(api.createMember({ ...base, permissions: ['Team View'] })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.createMember({ ...base, status: 'ACTIVE' } as CreateAdminTeamMemberRequest),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.createMember({ ...base, jobTitle: 'Lead' } as CreateAdminTeamMemberRequest),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
    // A custom scope with its departments and people is fine.
    await api.createMember({
      ...base,
      scope: 'CUSTOM',
      customScope: { departmentIds: [SALES.id], memberIds: [id(3)] },
    });
    expect(calls).toHaveLength(1);
  });

  it('changes only the fields given, and needs one', async () => {
    const { fn, calls } = fakeFetch(200, member());
    const api = client(fn);
    await api.updateMember(id(1), {
      phone: '',
      reportsToId: null,
      status: 'SUSPENDED',
      expectedUpdatedAt: at,
    });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: `/api/v1/admin/team/members/${id(1)}` });
    expect(calls[0]!.body).toEqual({
      phone: null,
      reportsToId: null,
      status: 'SUSPENDED',
      expectedUpdatedAt: at,
    });

    await expect(api.updateMember(id(1), {})).rejects.toMatchObject({
      message: 'Change at least one thing',
    });
    await expect(api.updateMember(id(1), { expectedUpdatedAt: at })).rejects.toMatchObject({
      message: 'Change at least one thing',
    });
    await expect(api.updateMember(id(1), { departmentId: SALES.id })).rejects.toMatchObject({
      message: 'Choose a role in the new department',
    });
    await expect(
      api.updateMember(id(1), {
        scope: 'COMPANY',
        customScope: { departmentIds: [SALES.id], memberIds: [] },
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.updateMember(id(1), { status: 'PENDING_INVITATION' as 'ACTIVE' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.updateMember(id(1), { email: 'new@example.test' } as never),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('sends a bulk change with the confirmed count', async () => {
    const result = {
      updated: 1,
      unchanged: 0,
      skipped: [{ id: id(2), name: 'Morgan Admin', reason: 'SELF' }],
    };
    const { fn, calls } = fakeFetch(200, result);
    const api = client(fn);
    const answer = await api.bulkUpdate({
      ids: [id(1), id(2)],
      confirmedCount: 2,
      action: { type: 'DEPARTMENT', departmentId: SALES.id, roleId: MANAGER.id },
    });
    expect(answer.skipped[0]?.reason).toBe('SELF');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/team/members/bulk' });
    expect(calls[0]!.body).toEqual({
      ids: [id(1), id(2)],
      confirmedCount: 2,
      action: { type: 'DEPARTMENT', departmentId: SALES.id, roleId: MANAGER.id },
    });

    await expect(
      api.bulkUpdate({ ids: [id(1)], confirmedCount: 2, action: { type: 'ROLE', roleId: id(5) } }),
    ).rejects.toMatchObject({ message: 'Confirm the number of team members again.' });
    await expect(
      api.bulkUpdate({
        ids: [id(1), id(1)],
        confirmedCount: 2,
        action: { type: 'STATUS', status: 'DEACTIVATED' },
      }),
    ).rejects.toMatchObject({ message: 'A team member is selected twice.' });
    await expect(
      api.bulkUpdate({
        ids: [],
        confirmedCount: 1,
        action: { type: 'STATUS', status: 'ACTIVE' },
      }),
    ).rejects.toMatchObject({ message: 'Select one or more team members first.' });
    await expect(
      api.bulkUpdate({
        ids: [id(1)],
        confirmedCount: 1,
        action: { type: 'STATUS', status: 'PENDING_APPROVAL' as 'ACTIVE' },
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.bulkUpdate({
        ids: [id(1)],
        confirmedCount: 1,
        action: { type: 'TAG', tagId: id(5) } as never,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('resends invitations, by email unless SMS is asked for', async () => {
    const { fn, calls } = fakeFetch(200, {
      sent: 1,
      skipped: [{ id: id(3), name: null, reason: 'NOT_FOUND' }],
    });
    const answer = await client(fn).resendInvitation({ ids: [id(1), id(3)] });
    expect(answer.sent).toBe(1);
    expect(answer.skipped[0]?.name).toBeNull();
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/admin/team/members/invitations',
      body: { ids: [id(1), id(3)], sms: false },
    });
  });

  it('approves with the invitation defaults, or rejects with a reason', async () => {
    const { fn, calls } = fakeFetch(200, {
      member: member(),
      invitation: { email: true, sms: false, expiresAt: '2026-10-27T09:00:00.000Z' },
    });
    const api = client(fn);
    const approved = await api.decideApproval(id(1), { decision: 'APPROVE' });
    expect(approved.invitation?.email).toBe(true);
    await api.decideApproval(id(1), { decision: 'REJECT', reason: ' Not budgeted ' });
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      [
        'POST',
        `/api/v1/admin/team/members/${id(1)}/decision`,
        { decision: 'APPROVE', invite: { email: true, sms: false } },
      ],
      [
        'POST',
        `/api/v1/admin/team/members/${id(1)}/decision`,
        { decision: 'REJECT', reason: 'Not budgeted' },
      ],
    ]);
    await expect(api.decideApproval(id(1), { decision: 'RETURN' } as never)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.decideApproval(id(1), { decision: 'REJECT', roleId: id(5) } as never),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(2);
  });

  it("passes the API's error code through, with a message for every code", async () => {
    const { fn } = fakeFetch(403, {
      error: { code: 'ROLE_CEILING', message: 'This role is above your authority' },
    });
    await expect(client(fn).createMember(base)).rejects.toMatchObject({
      status: 403,
      code: 'ROLE_CEILING',
    });
    for (const code of AdminTeamErrorCode.options) expect(ADMIN_TEAM_ERRORS[code]).toBeTruthy();
    for (const reason of AdminTeamSkipReason.options)
      expect(ADMIN_TEAM_SKIP_REASON_LABELS[reason]).toBeTruthy();
    for (const status of AdminTeamStatus.options)
      expect(ADMIN_TEAM_STATUS_LABELS[status]).toBeTruthy();
  });
});

describe('admin team helpers', () => {
  it('maps levels to the Permission Level column and ranks scopes', () => {
    expect(adminTeamAccessLevel('CEO')).toBe('SUPER_ADMIN');
    expect(adminTeamAccessLevel('CHIEF_OFFICER')).toBe('ADMIN');
    expect(adminTeamAccessLevel('MANAGER')).toBe('ADMIN');
    expect(adminTeamAccessLevel('LEAD_SUPERVISOR')).toBe('STANDARD');
    expect(adminTeamAccessLevel('INDIVIDUAL_CONTRIBUTOR')).toBe('STANDARD');
    expect(adminTeamScopeRank('COMPANY')).toBeLessThan(adminTeamScopeRank('DEPARTMENT'));
    expect(adminTeamScopeRank('DIRECT_REPORTS')).toBeLessThan(adminTeamScopeRank('OWN_RECORDS'));
  });

  it('offers supervisors above the role, in its department, Executive or the CEO', () => {
    const person = (
      n: number,
      level: AdminTeamFormPerson['level'],
      departmentId: string,
    ): AdminTeamFormPerson => ({
      id: id(n),
      name: `Person ${n}`,
      roleTitle: 'Role',
      departmentId,
      level,
    });
    const executive = id(21);
    const people = [
      person(1, 'CEO', executive),
      person(2, 'VP_DIRECTOR', executive),
      person(3, 'VP_DIRECTOR', SALES.id),
      person(4, 'MANAGER', SALES.id),
      person(5, 'CHIEF_OFFICER', id(22)),
    ];
    const found = adminTeamSupervisorsFor(
      people,
      { departmentId: SALES.id, level: 'MANAGER' },
      executive,
    );
    expect(found.map((entry) => entry.id)).toEqual([id(1), id(2), id(3)]);
  });

  it('works out what may be granted and whether permissions differ', () => {
    const modules: AdminTeamModule[] = [
      {
        id: 'team',
        label: 'Team',
        description: '',
        permissions: [
          { key: 'team.view', label: 'View', action: 'view', requires: [] },
          { key: 'team.edit', label: 'Edit', action: 'edit', requires: ['team.view'] },
        ],
      },
      {
        id: 'billing',
        label: 'Billing',
        description: '',
        permissions: [{ key: 'billing.view', label: 'View', action: 'view', requires: [] }],
      },
    ];
    expect(
      adminTeamGrantable(
        ['team.view'],
        { ceiling: ['billing.view'], unrestricted: false },
        modules,
      ),
    ).toEqual(['team.view', 'billing.view']);
    expect(adminTeamGrantable([], { ceiling: [], unrestricted: true }, modules)).toEqual([
      'team.view',
      'team.edit',
      'billing.view',
    ]);
    expect(adminTeamSamePermissions(['team.view', 'team.edit'], ['team.edit', 'team.view'])).toBe(
      true,
    );
    expect(adminTeamSamePermissions(['team.view'], ['team.view', 'team.edit'])).toBe(false);
  });

  it('writes the audit lines and splits the one name field', () => {
    const entry: AdminTeamActivityEntry = {
      id: id(50),
      kind: 'ROLE_CHANGED',
      at,
      actor: null,
      previousValue: 'Account Executive',
      newValue: 'Sales Manager',
      granted: [],
      revoked: [],
      approver: null,
      reason: null,
    };
    expect(adminTeamActivityText(entry)).toBe('Role changed: Account Executive → Sales Manager');
    expect(
      adminTeamActivityText({
        ...entry,
        kind: 'PERMISSIONS_CHANGED',
        previousValue: null,
        newValue: null,
        granted: ['team.create'],
        revoked: ['team.deactivate'],
      }),
    ).toBe('Permissions changed: granted team.create; revoked team.deactivate');
    expect(
      adminTeamActivityText({ ...entry, kind: 'INVITED', previousValue: null, newValue: null }),
    ).toBe('Invitation sent');
    expect(adminTeamNameParts('  Avery   Lee  Example ')).toEqual({
      firstName: 'Avery',
      lastName: 'Lee Example',
    });
    expect(adminTeamNameParts('Avery')).toEqual({ firstName: 'Avery', lastName: '' });
  });
});
