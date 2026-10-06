import {
  ApiRequestError,
  ClientId,
  ClientRecord,
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
 * checked with the same schemas and the API's error codes are returned, so a screen built on it
 * works unchanged against the real API.
 */
const at = '2026-10-01T09:00:00.000Z';
const staff = { userId: '0199b6a0-0000-7000-8000-0000000000f1', name: 'Sam Staff' };
const clientId = (n: number) => `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
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
      address: emptyAddress,
      preferredContactMethod: null,
      referralSource: null,
      additionalInfo: null,
      updatedAt: null,
      ...data.profile,
    },
  });

/** The signed-in portal client in mock mode is the first one. */
export const clientFixtures: readonly ClientRecord[] = [
  fixture(1, {
    displayName: 'Jamie Sample',
    email: 'jamie.sample@example.test',
    phone: '+14045550123',
    assignedTo: staff,
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
      ssnLast4: '6789',
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
    assignedTo: staff,
    portalStatus: 'PENDING_APPROVAL',
    profile: { businessName: 'Acme Widgets LLC', entityType: 'LLC' },
  }),
  fixture(3, { displayName: 'Riley Example', email: 'riley@example.test' }),
  fixture(4, { displayName: 'Pat Archived', archivedAt: at }),
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const now = () => new Date().toISOString();
const statusRef = (id: string) => {
  const s = taxStatusFixtures.find((t) => t.id === id);
  if (!s) throw fail(404, 'NOT_FOUND', 'Not found');
  if (s.archivedAt) throw fail(409, 'TAX_STATUS_ARCHIVED', 'This tax status is archived');
  return { id: s.id, name: s.name };
};
const listItem = ({ profile: _p, portalLogins: _l, updatedAt: _u, ...item }: ClientRecord) => item;

/**
 * An in-memory `api.clients`. `role: 'STAFF'` lets a screen try the staff view: archive and
 * restore get 403 FORBIDDEN.
 */
export function createClientsMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): ClientsClient {
  let rows: ClientRecord[] = clientFixtures.map((r) => structuredClone(r));
  let years: (ClientTaxYear & { clientId: string })[] = [
    {
      clientId: clientId(1),
      taxYear: 2025,
      status: statusRef(taxStatusFixtures[2]!.id),
      clientNote: 'We are preparing your return.',
      updatedBy: staff,
      updatedAt: at,
    },
  ];
  const history: Record<string, ClientTaxYear[]> = {};
  let nextId = 100;
  const find = (id: string) => {
    const row = rows.find((r) => r.id === parseInput(ClientId, id));
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const save = (row: ClientRecord) => {
    rows = rows.map((r) => (r.id === row.id ? row : r));
    return structuredClone(row);
  };
  const uniqueEmail = (email: string | null | undefined, exceptId?: string) => {
    if (email && rows.some((r) => r.id !== exceptId && r.email === email)) {
      throw fail(409, 'DUPLICATE_EMAIL', 'Another client has this email');
    }
  };
  const manager = () => {
    if (options.role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };

  async function saveProfile(id: string, body: unknown) {
    const { ssn, address, ...data } = parseInput(UpdateClientProfileRequest, body);
    const row = find(id);
    const profile = {
      ...row.profile,
      ...data,
      address: { ...row.profile.address, ...address },
      ...(ssn !== undefined ? { ssnLast4: ssn === null ? null : ssn.slice(-4) } : {}),
      updatedAt: now(),
    };
    save({ ...row, profile, updatedAt: now() });
    return { ...profile };
  }

  return {
    list: async (query = {}) => {
      await pause();
      const q = parseInput(ListClientsQuery, query);
      const term = q.search?.toLowerCase();
      const matches = rows
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
      return structuredClone(find(id));
    },
    create: async (body) => {
      await pause();
      const { profile, assignedUserId, ...data } = parseInput(CreateClientRequest, body);
      uniqueEmail(data.email);
      const row = fixture(nextId++, {
        ...data,
        assignedTo: assignedUserId === staff.userId ? staff : null,
        createdAt: now(),
        updatedAt: now(),
      });
      rows = [...rows, row];
      return profile
        ? { ...row, profile: await saveProfile(row.id, profile) }
        : structuredClone(row);
    },
    update: async (id, body) => {
      await pause();
      const { assignedUserId, ...data } = parseInput(UpdateClientRequest, body);
      const row = find(id);
      if (row.archivedAt) throw fail(409, 'CLIENT_ARCHIVED', 'Restore the client first');
      uniqueEmail(data.email, row.id);
      return save({
        ...row,
        ...data,
        ...(assignedUserId !== undefined
          ? { assignedTo: assignedUserId === staff.userId ? staff : null }
          : {}),
        updatedAt: now(),
      });
    },
    archive: async (id) => {
      await pause();
      manager();
      const row = find(id);
      return row.archivedAt
        ? structuredClone(row)
        : save({ ...row, archivedAt: now(), updatedAt: now() });
    },
    restore: async (id) => {
      await pause();
      manager();
      return save({ ...find(id), archivedAt: null, updatedAt: now() });
    },
    updateProfile: async (id, body) => {
      await pause();
      return saveProfile(id, body);
    },
    taxYears: async (id) => {
      await pause();
      find(id);
      return years
        .filter((y) => y.clientId === id)
        .sort((a, b) => b.taxYear - a.taxYear)
        .map(({ clientId: _c, ...y }) => ({ ...y }));
    },
    setTaxYear: async (id, taxYear, body) => {
      await pause();
      find(id);
      const year = parseInput(TaxYear, taxYear);
      const { taxStatusId, clientNote } = parseInput(SetClientTaxYearRequest, body);
      const before = years.find((y) => y.clientId === id && y.taxYear === year);
      const row = {
        clientId: id,
        taxYear: year,
        status: statusRef(taxStatusId),
        clientNote: clientNote === undefined ? (before?.clientNote ?? null) : clientNote,
        updatedBy: staff,
        updatedAt: now(),
      };
      years = [...years.filter((y) => y !== before), row];
      const { clientId: _c, ...result } = row;
      (history[`${id}/${year}`] ??= []).unshift(result);
      return { ...result };
    },
    taxYearHistory: async (id, taxYear) => {
      await pause();
      find(id);
      return (history[`${id}/${parseInput(TaxYear, taxYear)}`] ?? []).map((h) => ({
        status: h.status,
        clientNote: h.clientNote,
        changedBy: h.updatedBy,
        changedAt: h.updatedAt,
      }));
    },
  };
}

/** An in-memory `api.myProfile(slug)` for the first fixture client. */
export function createMyProfileMock(): MyProfileClient {
  const c = clientFixtures[0]!;
  let me: MyProfile = MyProfile.parse({
    fullName: c.displayName,
    dateOfBirth: c.profile.dateOfBirth,
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
      me = { ...me, ...data, address: { ...me.address, ...address } };
      return structuredClone(me);
    },
    requestNameChange: async (body) => {
      await pause();
      parseInput(RequestNameChangeRequest, body);
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
          status: taxStatusFixtures[2]!.name,
          clientNote: 'We are preparing your return.',
          updatedAt: at,
        },
        { taxYear: 2024, status: taxStatusFixtures[5]!.name, clientNote: null, updatedAt: at },
      ];
    },
  };
}
