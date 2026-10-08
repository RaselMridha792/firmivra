import {
  ApiRequestError,
  ClientId,
  ClientRecord,
  type ClientPortalRole,
  type ClientsClient,
  type ClientTaxYear,
  CreateClientRequest,
  ListClientsQuery,
  MyProfile,
  type MyProfileClient,
  parseInput,
  RequestNameChangeRequest,
  SetClientTaxYearRequest,
  TaxYear,
  UpdateClientProfileRequest,
  UpdateClientRequest,
  UpdateMyProfileRequest,
} from '@firmivra/types';
import { taxStatusFixtures } from './tax-statuses';

/**
 * Mock data for `api.clients` and `api.myProfile(slug)` (R10). Synthetic data only. Inputs are
 * checked with the same schemas, in the same order, and the API's error codes are returned, so a
 * screen built on it works unchanged against the real API.
 */
const at = '2026-10-01T09:00:00.000Z';
/** The signed-in staff member in the STAFF role; clients 1 and 2 are assigned to them. */
export const mockStaff = { userId: '0199b6a0-0000-7000-8000-0000000000f1', name: 'Sam Staff' };
const clientId = (n: number) => `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
/** Client 1's id (`clientId(1)`): the signed-in portal client in mock mode. */
export const firstClientId = '0199b6a1-0000-7000-8000-000000000001';
const emptyAddress = {
  line1: null,
  line2: null,
  city: null,
  state: null,
  postalCode: null,
  country: 'US',
};
type Fixture = Omit<Partial<ClientRecord>, 'profile'> & {
  displayName: string;
  profile?: Partial<ClientRecord['profile']>;
};
const fixture = (n: number, data: Fixture): ClientRecord =>
  // Parsed, so a fixture that breaks the contract fails as soon as the mock loads.
  ClientRecord.parse({
    id: clientId(n),
    accountType: 'INDIVIDUAL',
    email: null,
    phone: null,
    assignedTo: null,
    portalStatus: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    portalLogins: [],
    ...data,
    profile: {
      firstName: null,
      middleName: null,
      lastName: null,
      preferredName: null,
      businessName: null,
      entityType: null,
      dateOfBirth: null,
      ssnLast4: null,
      einLast4: null,
      address: emptyAddress,
      preferredContactMethod: null,
      referralSource: null,
      additionalInfo: null,
      updatedAt: null,
      ...data.profile,
    },
  });

let fixtures: readonly ClientRecord[] | undefined;

/**
 * The signed-in portal client in mock mode is the first one. Built on first use: importing this
 * file runs nothing.
 */
export function clientFixtures(): readonly ClientRecord[] {
  fixtures ??= [
    fixture(1, {
      displayName: 'Jamie Sample',
      email: 'jamie.sample@example.test',
      phone: '+14045550123',
      assignedTo: mockStaff,
      portalStatus: 'ACTIVE',
      portalLogins: [
        {
          clientAccountId: '0199b6a1-0000-7000-8000-0000000000a1',
          email: 'jamie.sample@example.test',
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      ],
      profile: {
        firstName: 'Jamie',
        lastName: 'Sample',
        dateOfBirth: '1985-04-12',
        ssnLast4: '0001',
        address: {
          ...emptyAddress,
          line1: '123 Main Street',
          city: 'Atlanta',
          state: 'GA',
          postalCode: '30301',
        },
        preferredContactMethod: 'EMAIL',
        updatedAt: at,
      },
    }),
    fixture(2, {
      displayName: 'Acme Widgets LLC (fake)',
      accountType: 'BUSINESS',
      email: 'books@acme.example.test',
      assignedTo: mockStaff,
      portalStatus: 'PENDING_APPROVAL',
      profile: { businessName: 'Acme Widgets LLC', entityType: 'LLC', einLast4: '0002' },
    }),
    fixture(3, { displayName: 'Riley Example', email: 'riley@example.test' }),
    fixture(4, { displayName: 'Pat Archived', archivedAt: at }),
  ];
  return fixtures;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const forbidden = () => fail(403, 'FORBIDDEN', 'This action is not permitted');
const now = () => new Date().toISOString();
const statusRef = (id: string) => {
  const s = taxStatusFixtures().find((t) => t.id === id);
  if (!s) throw fail(404, 'NOT_FOUND', 'Not found');
  if (s.archivedAt) throw fail(409, 'TAX_STATUS_ARCHIVED', 'This tax status is archived');
  return { id: s.id, name: s.name };
};
const listItem = ({ profile: _p, portalLogins: _l, updatedAt: _u, ...item }: ClientRecord) =>
  structuredClone(item);

export type MockFirmRole = 'OWNER' | 'ADMIN' | 'STAFF';

/**
 * An in-memory `api.clients`. `role: 'STAFF'` is Sam Staff: only clients 1 and 2 (assigned to
 * them) exist for them, and archive, restore and the assignee get 403 FORBIDDEN.
 */
export function createClientsMock(options: { role?: MockFirmRole } = {}): ClientsClient {
  const staffOnly = options.role === 'STAFF';
  let rows: ClientRecord[] = clientFixtures().map((r) => structuredClone(r));
  let years: (ClientTaxYear & { clientId: string })[] = [
    {
      clientId: clientId(1),
      taxYear: 2025,
      status: statusRef(taxStatusFixtures()[2]!.id),
      clientNote: 'We are preparing your return.',
      updatedBy: mockStaff,
      updatedAt: at,
    },
  ];
  const history: Record<string, ClientTaxYear[]> = {};
  let nextId = 100;
  const visible = (r: ClientRecord) => !staffOnly || r.assignedTo?.userId === mockStaff.userId;
  /** The id is already checked; an unknown, other firm's or (Staff) unassigned client is 404. */
  const find = (id: string) => {
    const row = rows.find((r) => r.id === id && visible(r));
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const save = (row: ClientRecord) => {
    rows = rows.map((r) => (r.id === row.id ? row : r));
    return structuredClone(row);
  };
  const notArchived = (row: ClientRecord) => {
    if (row.archivedAt) throw fail(409, 'CLIENT_ARCHIVED', 'Restore the client first');
  };
  const uniqueEmail = (email: string | null | undefined, exceptId?: string) => {
    if (email && rows.some((r) => r.id !== exceptId && r.email === email)) {
      throw fail(409, 'DUPLICATE_EMAIL', 'Another client has this email');
    }
  };
  const assignee = (userId: string | null) => (userId === mockStaff.userId ? mockStaff : null);
  const saveProfile = (row: ClientRecord, body: UpdateClientProfileRequest) => {
    const { ssn, ein, address, ...data } = parseInput(UpdateClientProfileRequest, body);
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    const profile: ClientRecord['profile'] = {
      ...row.profile,
      ...defined,
      address: {
        ...row.profile.address,
        ...Object.fromEntries(Object.entries(address ?? {}).filter(([, v]) => v !== undefined)),
      },
      ...(ssn !== undefined ? { ssnLast4: ssn === null ? null : ssn.slice(-4) } : {}),
      ...(ein !== undefined ? { einLast4: ein === null ? null : ein.slice(-4) } : {}),
      updatedAt: now(),
    };
    save({ ...row, profile, updatedAt: now() });
    return structuredClone(profile);
  };

  return {
    list: async (query = {}) => {
      await pause();
      const q = parseInput(ListClientsQuery, query);
      if (staffOnly && q.assignedUserId) throw forbidden();
      const term = q.search?.toLowerCase();
      const matches = rows
        .filter(visible)
        .filter((r) => (q.status === 'all' ? true : (q.status === 'archived') === !!r.archivedAt))
        .filter((r) => !q.assignedUserId || r.assignedTo?.userId === q.assignedUserId)
        .filter(
          (r) =>
            !term || [r.displayName, r.email, r.phone].some((v) => v?.toLowerCase().includes(term)),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const start = q.cursor ? Number(q.cursor) : 0;
      const page = matches.slice(start, start + q.limit);
      const next = start + q.limit < matches.length ? String(start + q.limit) : null;
      return { items: page.map(listItem), nextCursor: next };
    },
    get: async (id) => {
      await pause();
      return structuredClone(find(parseInput(ClientId, id)));
    },
    create: async (body) => {
      await pause();
      const { profile, assignedUserId, ...data } = parseInput(CreateClientRequest, body);
      if (staffOnly && assignedUserId) throw forbidden();
      uniqueEmail(data.email);
      const row = fixture(nextId++, {
        ...data,
        assignedTo: staffOnly ? mockStaff : assignee(assignedUserId ?? null),
        createdAt: now(),
        updatedAt: now(),
      });
      rows = [...rows, row];
      if (profile) saveProfile(row, profile);
      return structuredClone(find(row.id));
    },
    update: async (id, body) => {
      await pause();
      const cid = parseInput(ClientId, id);
      const { assignedUserId, ...data } = parseInput(UpdateClientRequest, body);
      if (staffOnly && assignedUserId !== undefined) throw forbidden();
      const row = find(cid);
      notArchived(row);
      uniqueEmail(data.email, row.id);
      const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      return save({
        ...row,
        ...defined,
        ...(assignedUserId !== undefined ? { assignedTo: assignee(assignedUserId) } : {}),
        updatedAt: now(),
      });
    },
    archive: async (id) => {
      await pause();
      const cid = parseInput(ClientId, id);
      if (staffOnly) throw forbidden();
      const row = find(cid);
      return row.archivedAt
        ? structuredClone(row)
        : save({ ...row, archivedAt: now(), updatedAt: now() });
    },
    restore: async (id) => {
      await pause();
      const cid = parseInput(ClientId, id);
      if (staffOnly) throw forbidden();
      return save({ ...find(cid), archivedAt: null, updatedAt: now() });
    },
    updateProfile: async (id, body) => {
      await pause();
      const cid = parseInput(ClientId, id);
      parseInput(UpdateClientProfileRequest, body);
      const row = find(cid);
      notArchived(row);
      return saveProfile(row, body);
    },
    taxYears: async (id) => {
      await pause();
      const cid = parseInput(ClientId, id);
      find(cid);
      return years
        .filter((y) => y.clientId === cid)
        .sort((a, b) => b.taxYear - a.taxYear)
        .map(({ clientId: _c, ...y }) => structuredClone(y));
    },
    setTaxYear: async (id, taxYear, body) => {
      await pause();
      // Input first (400), then the record (404), as the real client and API do.
      const cid = parseInput(ClientId, id);
      const year = parseInput(TaxYear, taxYear);
      const { taxStatusId, clientNote } = parseInput(SetClientTaxYearRequest, body);
      notArchived(find(cid));
      const before = years.find((y) => y.clientId === cid && y.taxYear === year);
      const row = {
        clientId: cid,
        taxYear: year,
        status: statusRef(taxStatusId),
        clientNote: clientNote === undefined ? (before?.clientNote ?? null) : clientNote,
        updatedBy: mockStaff,
        updatedAt: now(),
      };
      years = [...years.filter((y) => y !== before), row];
      const { clientId: _c, ...result } = row;
      (history[`${cid}/${year}`] ??= []).unshift(result);
      return structuredClone(result);
    },
    taxYearHistory: async (id, taxYear) => {
      await pause();
      const cid = parseInput(ClientId, id);
      const year = parseInput(TaxYear, taxYear);
      find(cid);
      return (history[`${cid}/${year}`] ?? []).map((h) => ({
        status: { ...h.status },
        clientNote: h.clientNote,
        changedBy: h.updatedBy && { ...h.updatedBy },
        changedAt: h.updatedAt,
      }));
    },
  };
}

/**
 * An in-memory `api.myProfile(slug)` for the first fixture client. `portalRole: 'SPOUSE'` (or
 * AUTHORIZED) tries a second login: no date of birth, and changes get 403 FORBIDDEN.
 */
export function createMyProfileMock(
  options: { portalRole?: ClientPortalRole } = {},
): MyProfileClient {
  const portalRole = options.portalRole ?? 'PRIMARY';
  const primary = portalRole === 'PRIMARY';
  const c = clientFixtures()[0]!;
  let me: MyProfile = MyProfile.parse({
    portalRole,
    fullName: c.displayName,
    dateOfBirth: primary ? c.profile.dateOfBirth : null,
    email: c.email,
    phone: c.phone,
    address: c.profile.address,
    preferredContactMethod: c.profile.preferredContactMethod,
    referralSource: c.profile.referralSource,
    additionalInfo: c.profile.additionalInfo,
  });
  let nameChangePending = false;

  return {
    get: async () => {
      await pause();
      return structuredClone(me);
    },
    update: async (body) => {
      await pause();
      const { address, ...data } = parseInput(UpdateMyProfileRequest, body);
      if (!primary) throw forbidden();
      const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      me = {
        ...me,
        ...defined,
        address: {
          ...me.address,
          ...Object.fromEntries(Object.entries(address ?? {}).filter(([, v]) => v !== undefined)),
        },
      };
      return structuredClone(me);
    },
    requestNameChange: async (body) => {
      await pause();
      parseInput(RequestNameChangeRequest, body);
      if (!primary) throw forbidden();
      if (nameChangePending) {
        throw fail(409, 'NAME_CHANGE_PENDING', 'Your name change request is already with the team');
      }
      nameChangePending = true;
      return { ok: true };
    },
    taxYears: async () => {
      await pause();
      return [
        {
          taxYear: 2025,
          status: taxStatusFixtures()[2]!.name,
          clientNote: 'We are preparing your return.',
          updatedAt: at,
        },
        { taxYear: 2024, status: taxStatusFixtures()[5]!.name, clientNote: null, updatedAt: at },
      ];
    },
  };
}
