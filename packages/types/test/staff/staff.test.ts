import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  CreateStaffRequest,
  createDepartmentsClient,
  createRequest,
  createRolesClient,
  createStaffClient,
  CreateCustomRoleRequest,
  SetStaffOverridesRequest,
  SetStaffTeamMembersRequest,
  StaffAccessInput,
  StaffDraftData,
  UpdateCustomRoleRequest,
  UpdateStaffRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const bodyOf = (init: RequestInit | undefined): unknown =>
  init?.body === undefined ? undefined : JSON.parse(init.body as string);

const id = '0199c0a0-0a00-7000-8000-000000000001';
const other = '0199c0a0-0a00-7000-8000-000000000002';
const dept = '0199c0a0-0d00-7000-8000-000000000001';
const at = '2026-10-14T09:00:00.000Z';
const ref = { id, userId: other, name: 'Morgan Avery', jobTitle: 'Owner / CEO' };
const detail = {
  id,
  userId: other,
  name: 'Morgan Avery',
  firstName: 'Morgan',
  lastName: 'Avery',
  email: 'morgan.avery@lvp.test',
  phone: null,
  role: 'OWNER',
  status: 'ACTIVE',
  jobTitle: 'Owner / CEO',
  departments: [{ id: dept, name: 'Administration' }],
  serviceAreas: [],
  accessLevel: 'ADMINISTRATOR',
  accessStartsOn: null,
  memberSince: at,
  profile: {
    employmentType: 'W2',
    workSchedule: null,
    office: null,
    hireDate: '2024-03-15',
    endDate: null,
    supervisor: null,
    timeZone: 'America/New_York',
    employeeId: null,
    primaryTeam: null,
    backupTeam: null,
    primarySpecialty: null,
    maxWorkload: null,
    acceptsNewClients: true,
  },
  mfa: 'ENABLED',
  lastLogin: { at, device: 'Chrome on macOS', place: null },
  invite: null,
  notes: null,
  isYou: true,
  version: 'v1',
};
const account = {
  firstName: 'Nora',
  lastName: 'Ellison',
  email: ' Nora.Ellison@LVP.test ',
  departmentIds: [dept],
  jobTitle: 'Tax Preparer',
  role: 'TAX_PREPARER' as const,
};
const staff = (fn: typeof fetch) =>
  createStaffClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), '/api/v1');

describe('api.staff', () => {
  it('lists with the filters in the query and pages by number', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 2, pageSize: 25 });
    await staff(fn).list({
      search: 'nora',
      status: 'active',
      departmentId: dept,
      page: 2,
      pageSize: 25,
    });
    expect(calls[0]?.url).toBe(
      `/api/v1/business/staff?search=nora&departmentId=${dept}&status=active&page=2&pageSize=25`,
    );
  });

  it('refuses a page size the design does not offer', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(staff(fn).list({ pageSize: 7 })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(calls).toHaveLength(0);
  });

  it('creates with an idempotency key and a normalised email', async () => {
    const { fn, calls } = fakeFetch(200, {
      staff: { ...detail, status: 'INVITED' },
      invitation: { status: 'SENT', sentAt: at, expiresAt: at },
    });
    const key = '0199c0a0-1111-7000-8000-000000000001';
    const result = await staff(fn).create({ idempotencyKey: key, account });
    expect(calls[0]?.url).toBe('/api/v1/business/staff');
    expect(calls[0]?.init.method).toBe('POST');
    expect(bodyOf(calls[0]?.init)).toMatchObject({
      idempotencyKey: key,
      account: { email: 'nora.ellison@lvp.test' },
      sendWelcomeEmail: true,
    });
    expect(result.invitation.status).toBe('SENT');
  });

  it('never accepts a business id, a password or a department-less member', () => {
    const key = '0199c0a0-1111-7000-8000-000000000001';
    expect(
      CreateStaffRequest.safeParse({ idempotencyKey: key, account, businessId: dept }).success,
    ).toBe(false);
    expect(
      CreateStaffRequest.safeParse({ idempotencyKey: key, account: { ...account, password: 'x' } })
        .success,
    ).toBe(false);
    expect(
      CreateStaffRequest.safeParse({
        idempotencyKey: key,
        account: { ...account, departmentIds: [] },
      }).success,
    ).toBe(false);
    expect(StaffDraftData.safeParse({ compensation: { rateCents: 1 } }).success).toBe(false);
  });

  it('needs a version and a change to update', () => {
    expect(UpdateStaffRequest.safeParse({ version: 'v1' }).success).toBe(false);
    expect(UpdateStaffRequest.safeParse({ account: { jobTitle: 'CPA' } }).success).toBe(false);
    expect(
      UpdateStaffRequest.safeParse({ version: 'v1', account: { jobTitle: 'CPA' } }).success,
    ).toBe(true);
  });

  it('bounds the sign-in rules', () => {
    expect(StaffAccessInput.safeParse({ autoLogoutMinutes: 2 }).success).toBe(false);
    expect(StaffAccessInput.safeParse({ allowedIps: ['203.0.113.0/24'] }).success).toBe(true);
    expect(StaffAccessInput.safeParse({ allowedIps: ['not an ip'] }).success).toBe(false);
  });

  it('asks for a confirm on high-risk actions', async () => {
    const { fn, calls } = fakeFetch(200, {
      ok: true,
      status: 'ACTIVE',
      sessionsRevoked: 2,
      invitation: null,
    });
    await expect(staff(fn).resetMfa(id, { confirm: false as never })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    const result = await staff(fn).resetMfa(id, { confirm: true, reason: 'Lost phone' });
    expect(calls[0]?.url).toBe(`/api/v1/business/staff/${id}/reset-mfa`);
    expect(result.sessionsRevoked).toBe(2);
  });

  it('refuses a bad id before sending', async () => {
    const { fn, calls } = fakeFetch(200, detail);
    await expect(staff(fn).get('../settings')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });

  it('reads the note as null when there is none, and builds the template link', async () => {
    const { fn } = fakeFetch(200, { note: null });
    expect(await staff(fn).note(id)).toBeNull();
    expect(staff(fn).importTemplateUrl()).toBe('/api/v1/business/staff/import/template');
  });

  it('copies permissions from another member', async () => {
    const { fn, calls } = fakeFetch(200, { role: 'STAFF', cells: [], updatedAt: null });
    await staff(fn).copyPermissions(id, other);
    expect(calls[0]?.url).toBe(`/api/v1/business/staff/${id}/permissions/copy-from/${other}`);
  });

  it('sets individual permissions: Inherit, Allow or Deny per cell, each cell once', async () => {
    const { fn, calls } = fakeFetch(200, { role: 'STAFF', cells: [], updatedAt: null });
    await staff(fn).setOverrides(id, {
      overrides: [
        { module: 'REPORTS', capability: 'EXPORT', mode: 'ALLOW' },
        { module: 'CLIENTS', capability: 'DELETE', mode: 'INHERIT' },
      ],
    });
    expect(calls[0]?.url).toBe(`/api/v1/business/staff/${id}/permissions`);
    expect(calls[0]?.init.method).toBe('PATCH');
    expect(bodyOf(calls[0]?.init)).toEqual({
      overrides: [
        { module: 'REPORTS', capability: 'EXPORT', mode: 'ALLOW' },
        { module: 'CLIENTS', capability: 'DELETE', mode: 'INHERIT' },
      ],
    });
    const twice = { module: 'REPORTS', capability: 'EXPORT', mode: 'DENY' } as const;
    expect(SetStaffOverridesRequest.safeParse({ overrides: [twice, twice] }).success).toBe(false);
    expect(SetStaffOverridesRequest.safeParse({ overrides: [] }).success).toBe(false);
    expect(
      SetStaffOverridesRequest.safeParse({ overrides: [{ ...twice, mode: 'MAYBE' }] }).success,
    ).toBe(false);
    await expect(staff(fn).setOverrides(id, { overrides: [] })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(calls).toHaveLength(1);
  });

  it('parses a member', async () => {
    const { fn } = fakeFetch(200, detail);
    expect((await staff(fn).get(id)).name).toBe('Morgan Avery');
  });
});

describe('api.departments', () => {
  const client = (fn: typeof fetch) =>
    createDepartmentsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

  it('lists departments and reads the org chart', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 10 });
    await client(fn).list({ status: 'active' });
    expect(calls[0]?.url).toBe('/api/v1/business/departments?status=active&page=1&pageSize=10');
    const chart = fakeFetch(200, {
      nodes: [{ ...ref, supervisorId: null, departments: [], heads: [] }],
    });
    expect((await client(chart.fn).orgChart()).nodes).toHaveLength(1);
  });

  it('refuses a member twice in a team', () => {
    const m = { membershipId: id, kind: 'MEMBER' };
    expect(SetStaffTeamMembersRequest.safeParse({ members: [m, m] }).success).toBe(false);
  });
});

describe('api.roles', () => {
  it('saves a role grid by role name', async () => {
    const { fn, calls } = fakeFetch(200, {
      role: 'TAX_PREPARER',
      cells: [],
      updatedAt: null,
      updatedBy: null,
    });
    const client = createRolesClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    await client.savePermissions('TAX_PREPARER', {
      grants: [{ module: 'CLIENTS', capability: 'VIEW', granted: true }],
    });
    expect(calls[0]?.url).toBe('/api/v1/business/roles/TAX_PREPARER/permissions');
    expect(calls[0]?.init.method).toBe('PUT');
    await expect(client.permissions('NOBODY' as never)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  const customRole = {
    id,
    name: 'Senior Bookkeeper',
    description: null,
    basedOn: 'BOOKKEEPER',
    memberCount: 0,
    archivedAt: null,
    updatedAt: at,
  };

  it('creates a custom role with its grid, never from the Owner', async () => {
    const { fn, calls } = fakeFetch(201, customRole);
    const client = createRolesClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    const created = await client.createCustom({
      name: ' Senior Bookkeeper ',
      basedOn: 'BOOKKEEPER',
      grants: [{ module: 'REPORTS', capability: 'EXPORT', granted: true }],
      acknowledgeEscalation: true,
    });
    expect(created.archivedAt).toBeNull();
    expect(calls[0]?.url).toBe('/api/v1/business/roles/custom');
    expect(bodyOf(calls[0]?.init)).toMatchObject({ name: 'Senior Bookkeeper' });
    expect(CreateCustomRoleRequest.safeParse({ name: 'X', basedOn: 'OWNER' }).success).toBe(false);
    expect(CreateCustomRoleRequest.safeParse({ name: ' ', basedOn: 'STAFF' }).success).toBe(false);
    expect(
      CreateCustomRoleRequest.safeParse({ name: 'X', basedOn: 'STAFF', businessId: id }).success,
    ).toBe(false);
  });

  it('reads, edits and archives a custom role by id', async () => {
    const { fn, calls } = fakeFetch(200, { role: customRole, cells: [], updatedBy: null });
    const client = createRolesClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    await client.customRole(id);
    await client.updateCustom(id, { description: null });
    expect(calls[0]?.url).toBe(`/api/v1/business/roles/custom/${id}`);
    expect(calls[1]?.init.method).toBe('PATCH');
    expect(UpdateCustomRoleRequest.safeParse({}).success).toBe(false);
    expect(UpdateCustomRoleRequest.safeParse({ basedOn: 'ADMIN' }).success).toBe(false);
    await expect(client.customRole('nope')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const archive = fakeFetch(200, { ...customRole, archivedAt: at });
    await createRolesClient(createRequest({ baseUrl: '/api/v1', fetch: archive.fn })).archiveCustom(
      id,
    );
    expect(archive.calls[0]?.url).toBe(`/api/v1/business/roles/custom/${id}/archive`);
    expect(archive.calls[0]?.init.method).toBe('POST');
  });
});
