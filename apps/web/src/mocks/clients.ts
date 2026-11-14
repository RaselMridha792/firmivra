import {
  ApiRequestError,
  SetClientTagsRequest,
  BulkClientsRequest,
  ClientId,
  ClientTimelineQuery,
  type ClientListRow,
  ClientRecord,
  type ClientPortalRole,
  type ClientsClient,
  type ClientTaxYear,
  CreateClientRequest,
  ListClientsQuery,
  MyProfile,
  type MyProfileClient,
  parseInput,
  roleCan,
  type ClientService,
  type ClientServiceWorkspace,
  ExportClientsRequest,
  RequestNameChangeRequest,
  SetClientTaxYearRequest,
  TaxYear,
  UpdateClientProfileRequest,
  UpdateClientRequest,
  UpdateMyProfileRequest,
  SetClientOfficeRequest,
  AddClientLinkRequest,
  type ClientLink,
  UpdateClientLinkRequest,
} from '@firmivra/types';
import { mockedEmpty } from '../lib/mock';
import { timelineOf } from './client-timeline';
import { mockFirmTags, mockResolveTags } from './tags';
import { taxStatusFixtures } from './tax-statuses';
import { teamFixtures } from './team';
import { serviceMockEngagements } from './service-engagements';

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
      dateOfBirthUnavailable: false,
      ssnLast4: null,
      einLast4: null,
      address: emptyAddress,
      preferredContactMethod: null,
      referralSource: null,
      additionalInfo: null,
      responsibleParty: null,
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
    // A date of birth on file that can't be read right now (no firm key, KMS down): the screens
    // show it as unavailable. Saving a date of birth clears it.
    fixture(3, {
      displayName: 'Riley Example',
      email: 'riley@example.test',
      profile: { dateOfBirthUnavailable: true },
    }),
    fixture(4, { displayName: 'Pat Archived', archivedAt: at }),
  ];
  return fixtures;
}

/** The firm's active members as an assignee (the team mock's people, plus Sam Staff). */
const members = () => [
  mockStaff,
  ...teamFixtures()
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.user.id, name: m.user.name })),
];

let listOnly: readonly ClientRecord[] | undefined;

/**
 * Six more clients for the Clients list (R1), so a page fills as clients.jpg does: assigned to the
 * team mock's Owner and Admin, added in earlier months. Only `api.clients` has them; the other
 * mocks keep using `clientFixtures()`. Built on first use.
 */
function listFixtures(): readonly ClientRecord[] {
  const [owner, admin] = members().slice(1);
  listOnly ??= [
    fixture(5, {
      displayName: 'Morgan Lee',
      email: 'morgan.lee@example.test',
      phone: '+16785550142',
      assignedTo: owner ?? null,
      portalStatus: 'ACTIVE',
      createdAt: '2026-09-22T15:00:00.000Z',
    }),
    fixture(6, {
      displayName: 'Northwind Bakery LLC (fake)',
      accountType: 'BUSINESS',
      email: 'books@northwind.example.test',
      phone: '+17705550199',
      assignedTo: admin ?? null,
      portalStatus: 'INVITED',
      createdAt: '2026-09-15T15:00:00.000Z',
    }),
    fixture(7, {
      displayName: 'Casey Rivera',
      email: 'casey.rivera@example.test',
      phone: '+14045557754',
      assignedTo: owner ?? null,
      createdAt: '2026-09-03T15:00:00.000Z',
    }),
    fixture(8, {
      displayName: 'Harbor Point Dental (fake)',
      accountType: 'BUSINESS',
      email: 'office@harborpoint.example.test',
      phone: '+16785553344',
      assignedTo: admin ?? null,
      portalStatus: 'ACTIVE',
      createdAt: '2026-08-20T15:00:00.000Z',
    }),
    fixture(9, {
      displayName: 'Jordan Blake',
      email: 'jordan.blake@example.test',
      phone: '+17705556677',
      assignedTo: owner ?? null,
      createdAt: '2026-08-11T15:00:00.000Z',
    }),
    fixture(10, {
      displayName: 'Taylor Quinn',
      email: 'taylor.quinn@example.test',
      createdAt: '2026-07-02T15:00:00.000Z',
    }),
  ];
  return listOnly;
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

// The work around each client (R1): stage, open services, missing documents, balance, last
// activity and next appointment, as GET /business/clients sends them. Synthetic.
type ServiceRef = NonNullable<ClientListRow['services']>[number];
const service = (n: number, name: string, kind: ServiceRef['kind']): ServiceRef => ({
  id: `0199b6a2-0000-7000-8000-${String(n).padStart(12, '0')}`,
  name,
  kind,
});
/** Every service the mock firm offers (the list's service tabs, in this order). */
export const mockClientServices = (): ServiceRef[] => [
  service(1, 'Personal Tax', 'ANNUAL_TAX'),
  service(2, 'Business Tax', 'ANNUAL_TAX'),
  service(3, 'Bookkeeping', 'BOOKKEEPING'),
  service(4, 'Tax Planning', 'TAX_PLANNING'),
];
type Work = Required<
  Pick<
    ClientListRow,
    | 'status'
    | 'services'
    | 'missingDocuments'
    | 'balanceDueCents'
    | 'lastActivityAt'
    | 'nextAppointmentAt'
  >
>;
const daysFromNow = (days: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const noWork = (): Work => ({
  status: 'NEW',
  services: [],
  missingDocuments: 0,
  balanceDueCents: 0,
  lastActivityAt: null,
  nextAppointmentAt: null,
});
let workTable: Record<number, Work> | undefined;
/** Built on first use, around today. */
const work = (): Record<number, Work> => {
  const [personal, business, books, planning] = mockClientServices() as [
    ServiceRef,
    ServiceRef,
    ServiceRef,
    ServiceRef,
  ];
  workTable ??= {
    1: {
      status: 'ACTIVE',
      services: [personal, planning],
      missingDocuments: 2,
      balanceDueCents: 0,
      lastActivityAt: daysFromNow(0, 9),
      nextAppointmentAt: daysFromNow(6, 14),
    },
    2: {
      status: 'PENDING_DOCUMENTS',
      services: [business, books],
      missingDocuments: 4,
      balanceDueCents: 29_000,
      lastActivityAt: daysFromNow(-1, 15),
      nextAppointmentAt: daysFromNow(3, 10),
    },
    3: {
      status: 'NEW',
      services: [personal],
      missingDocuments: 0,
      balanceDueCents: 15_000,
      lastActivityAt: daysFromNow(-8, 11),
      nextAppointmentAt: null,
    },
    4: { ...noWork(), status: 'INACTIVE' },
    5: {
      status: 'ACTIVE',
      services: [personal, books],
      missingDocuments: 0,
      balanceDueCents: 0,
      lastActivityAt: daysFromNow(0, 14),
      nextAppointmentAt: daysFromNow(7, 15),
    },
    6: {
      status: 'ACTIVE',
      services: [business, books],
      missingDocuments: 1,
      balanceDueCents: 0,
      lastActivityAt: daysFromNow(-1, 13),
      nextAppointmentAt: daysFromNow(9, 16),
    },
    7: {
      status: 'IN_PROGRESS',
      services: [personal],
      missingDocuments: 1,
      balanceDueCents: 50_000,
      lastActivityAt: daysFromNow(-9, 12),
      nextAppointmentAt: null,
    },
    8: {
      status: 'ON_HOLD',
      services: [business, planning],
      missingDocuments: 0,
      balanceDueCents: 0,
      lastActivityAt: daysFromNow(-12, 15),
      nextAppointmentAt: daysFromNow(14, 14),
    },
    9: {
      status: 'ACTIVE',
      services: [personal, planning],
      missingDocuments: 0,
      balanceDueCents: 0,
      lastActivityAt: daysFromNow(-14, 11),
      nextAppointmentAt: daysFromNow(11, 13),
    },
    10: {
      status: 'INACTIVE',
      services: [],
      missingDocuments: 0,
      balanceDueCents: 0,
      lastActivityAt: daysFromNow(-40, 10),
      nextAppointmentAt: null,
    },
  };
  return workTable;
};
const workOf = (id: string): Work => structuredClone(work()[Number(id.slice(-12))] ?? noWork());

/**
 * An in-memory `api.clients`. `role: 'STAFF'` is Sam Staff: only clients 1 and 2 (assigned to
 * them) exist for them, and archive, restore and the assignee get 403 FORBIDDEN. `empty: true`
 * (default: NEXT_PUBLIC_API_MOCK_EMPTY=clients) starts with no clients; the services stay.
 */
export function createClientsMock(
  options: { role?: MockFirmRole; empty?: boolean } = {},
): ClientsClient {
  const staffOnly = options.role === 'STAFF';
  /** PRT-1 part 2: two synthetic locations, and the offices changed in this session. */
  const MOCK_OFFICES = [
    {
      id: '0199d000-0000-7000-8000-000000000001',
      name: 'Auburn Office',
      addressLines: ['123 Main St', 'Auburn, GA 30011'],
    },
    {
      id: '0199d000-0000-7000-8000-000000000002',
      name: 'Lawrenceville Office',
      addressLines: ['456 Pine Rd, Suite 200', 'Lawrenceville, GA 30046'],
    },
  ];
  const officeOf = new Map<string, string | null>();
  const empty = options.empty ?? mockedEmpty('clients');
  let rows: ClientRecord[] = empty
    ? []
    : [...clientFixtures(), ...listFixtures()].map((r) => structuredClone(r));
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
  /** Each client's tag names (L5); the firm's list is mocks/tags.ts. */
  const tags = new Map<string, string[]>();
  let nextId = 100;
  const visible = (r: ClientRecord) => !staffOnly || r.assignedTo?.userId === mockStaff.userId;
  /** The id is already checked; an unknown, other firm's or (Staff) unassigned client is 404. */
  const find = (id: string) => {
    const row = rows.find((r) => r.id === id && visible(r)) ?? serviceClient(id);
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  /** SH4: a Payroll or Bookkeeping mock client, as a record (mocks/service-engagements.ts). */
  const serviceClient = (id: string): ClientRecord | undefined => {
    const e = serviceMockEngagements(id)[0];
    const base = rows[0];
    return e && base
      ? {
          ...structuredClone(base),
          id,
          displayName: e.clientName,
          email: null,
          phone: null,
          portalLogins: [],
        }
      : undefined;
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
  /** As the API (Clients Review 2): the same phone digits as another client pauses the save. */
  const uniquePhone = (
    phone: string | null | undefined,
    allow: boolean | undefined,
    exceptId?: string,
  ) => {
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-10);
    if (!phone || allow) return;
    const same = rows.filter((r) => r.id !== exceptId && digits(r.phone) === digits(phone));
    if (same.length === 0) return;
    throw new ApiRequestError(
      409,
      'DUPLICATE_PHONE',
      'Another client has this phone number',
      undefined,
      undefined,
      undefined,
      {
        count: same.length,
        matches: same.map((r) => ({
          id: r.id,
          name: r.displayName,
          clientNumber: `CL-${10000 + Number(r.id.slice(-12))}`,
          archived: !!r.archivedAt,
        })),
      },
    );
  };
  // G9: linked profiles. Client 1 (Jamie Sample) starts as the owner of client 2's business.
  const links: {
    id: string;
    clientId: string;
    linkedClientId: string;
    role: ClientLink['role'];
    note: string | null;
    createdAt: string;
  }[] = [
    {
      id: '0199b6aa-0000-7000-8000-000000000900',
      clientId: '0199b6a1-0000-7000-8000-000000000002',
      linkedClientId: '0199b6a1-0000-7000-8000-000000000001',
      role: 'OWNER',
      note: null,
      createdAt: '2026-10-01T15:00:00.000Z',
    },
  ];
  const linkView = (l: (typeof links)[number], fromId: string): ClientLink => {
    const added = l.clientId === fromId;
    const other = rows.find((r) => r.id === (added ? l.linkedClientId : l.clientId))!;
    return {
      id: l.id,
      other: {
        id: other.id,
        displayName: other.displayName,
        accountType: other.accountType,
        clientNumber: `CL-${10000 + Number(other.id.slice(-12))}`,
        archived: !!other.archivedAt,
      },
      role: l.role,
      side: added ? 'LINKED' : 'ADDED_TO',
      note: l.note,
      createdAt: l.createdAt,
    };
  };
  const assignee = (userId: string | null) => {
    const member = members().find((m) => m.userId === userId);
    return member ? { ...member } : null;
  };
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
      // A new date of birth (or none) replaces the unreadable one.
      ...(data.dateOfBirth !== undefined ? { dateOfBirthUnavailable: false } : {}),
      updatedAt: now(),
    };
    save({ ...row, profile, updatedAt: now() });
    return structuredClone(profile);
  };

  const mock: ClientsClient = {
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
        .filter((r) => !q.clientStatus || workOf(r.id).status === q.clientStatus)
        .filter((r) => !q.serviceId || workOf(r.id).services.some((x) => x.id === q.serviceId))
        // The Pending Documents and Balances Due cards' clients, as the API (E1).
        .filter((r) => q.owes !== 'DOCUMENTS' || workOf(r.id).missingDocuments > 0)
        .filter((r) => q.owes !== 'BALANCE' || workOf(r.id).balanceDueCents > 0)
        .filter((r) => {
          if (!q.lastActivityFrom && !q.lastActivityTo) return true;
          const last = workOf(r.id).lastActivityAt?.slice(0, 10);
          return (
            !!last &&
            (!q.lastActivityFrom || last >= q.lastActivityFrom) &&
            (!q.lastActivityTo || last <= q.lastActivityTo)
          );
        })
        // More Filters and Added Last 30 Days (E2 additions), as the API. The mock keeps no
        // deadlines, priority or source, so those match no one.
        .filter((r) => !q.addedFrom || r.createdAt.slice(0, 10) >= q.addedFrom)
        .filter((r) => !q.accountType || r.accountType === q.accountType)
        .filter((r) => !q.state || r.profile.address.state?.toUpperCase() === q.state)
        .filter(
          (r) =>
            !q.place ||
            (r.profile.address.city ?? '').toLowerCase().includes(q.place.toLowerCase()),
        )
        .filter((r) => {
          if (!q.balance) return true;
          return workOf(r.id).balanceDueCents > 0 === (q.balance === 'DUE');
        })
        .filter((r) => {
          if (!q.documents) return true;
          return workOf(r.id).missingDocuments > 0 === (q.documents === 'MISSING');
        })
        .filter((r) => {
          if (!q.appointmentFrom && !q.appointmentTo) return true;
          const next = workOf(r.id).nextAppointmentAt?.slice(0, 10);
          return (
            !!next &&
            (!q.appointmentFrom || next >= q.appointmentFrom) &&
            (!q.appointmentTo || next <= q.appointmentTo)
          );
        })
        .filter(() => !q.deadlineFrom && !q.deadlineTo && !q.priority && !q.source)
        .filter((r) => !q.tagId || (tags.get(r.id) ?? []).length > 0)
        // G12: the API's orders; newest first by default.
        .sort((a, b) => {
          const newest = b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
          if (q.sort === 'OLDEST') return -newest;
          const byName = a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id);
          if (q.sort === 'NAME_ASC') return byName;
          if (q.sort === 'NAME_DESC') return -byName;
          return newest;
        });
      const start = q.page ? (q.page - 1) * q.limit : q.cursor ? Number(q.cursor) : 0;
      const page = matches.slice(start, start + q.limit);
      const next = !q.page && start + q.limit < matches.length ? String(start + q.limit) : null;
      return {
        items: page.map((r): ClientListRow => ({ ...listItem(r), ...workOf(r.id) })),
        nextCursor: next,
        total: matches.length,
      };
    },
    summary: async () => {
      await pause();
      const mine = rows.filter(visible);
      const live = mine.filter((r) => !r.archivedAt);
      const today = new Date();
      const month = today.toISOString().slice(0, 7);
      const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
        .toISOString()
        .slice(0, 7);
      const count = (test: (w: Work) => boolean) => live.filter((r) => test(workOf(r.id))).length;
      const active = count((w) => w.status === 'ACTIVE');
      return {
        kpis: {
          totalClients: {
            value: live.length,
            previous: live.filter((r) => r.createdAt.slice(0, 7) < month).length,
          },
          newClients: {
            value: mine.filter((r) => r.createdAt.slice(0, 7) === month).length,
            previous: mine.filter((r) => r.createdAt.slice(0, 7) === lastMonth).length,
          },
          activeClients: { value: active, previous: null },
          pendingDocuments: { value: count((w) => w.missingDocuments > 0), previous: null },
          balancesDue: { value: count((w) => w.balanceDueCents > 0), previous: null },
          inactiveClients: { value: count((w) => w.status === 'INACTIVE'), previous: null },
        },
        counts: {
          all: live.length,
          active,
          new: count((w) => w.status === 'NEW'),
          inactive: count((w) => w.status === 'INACTIVE'),
          byService: mockClientServices().map((x) => ({
            ...x,
            count: count((w) => w.services.some((y) => y.id === x.id)),
          })),
        },
      };
    },
    bulk: async (body) => {
      await pause();
      const req = parseInput(BulkClientsRequest, body);
      if (staffOnly) throw forbidden();
      const ids = [...new Set(req.clientIds)];
      if (!ids.every((id) => rows.some((r) => r.id === id && visible(r)))) {
        throw fail(404, 'NOT_FOUND', 'Not found');
      }
      // An assignee who is not an active member refuses the whole request, as the API does.
      if (req.action === 'ASSIGN' && req.assignedUserId && !assignee(req.assignedUserId)) {
        throw fail(404, 'NOT_FOUND', 'Not found');
      }
      // E2 additions: a tag that is not one of the firm's live tags refuses the whole request.
      const tag = req.action === 'TAG' ? mockFirmTags().find((t) => t.id === req.tagId) : undefined;
      if (req.action === 'TAG' && !tag) throw fail(404, 'NOT_FOUND', 'Not found');
      const skipped: { clientId: string; code: string }[] = [];
      let updated = 0;
      for (const id of ids) {
        const row = rows.find((r) => r.id === id && visible(r))!;
        if (req.action === 'ASSIGN') {
          if (row.archivedAt) {
            skipped.push({ clientId: id, code: 'CLIENT_ARCHIVED' });
            continue;
          }
          save({ ...row, assignedTo: assignee(req.assignedUserId), updatedAt: now() });
        } else if (req.action === 'TAG' || req.action === 'STAGE') {
          if (row.archivedAt) {
            skipped.push({ clientId: id, code: 'CLIENT_ARCHIVED' });
            continue;
          }
          if (req.action === 'TAG' && tag) {
            const had = tags.get(row.id) ?? [];
            if (!had.includes(tag.name)) tags.set(row.id, [...had, tag.name]);
          } else if (req.action === 'STAGE') {
            const n = Number(row.id.slice(-12));
            work()[n] = { ...(work()[n] ?? noWork()), status: req.status };
          }
        } else if (req.action === 'ARCHIVE') {
          if (!row.archivedAt) save({ ...row, archivedAt: now(), updatedAt: now() });
        } else {
          save({ ...row, archivedAt: null, updatedAt: now() });
        }
        updated += 1;
      }
      return { updated, skipped };
    },
    get: async (id) => {
      await pause();
      return structuredClone(find(parseInput(ClientId, id)));
    },
    tags: async (id) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      return { tags: [...(tags.get(row.id) ?? [])] };
    },
    // MSG-F16: what New Message's Add to Client Timeline wrote in this browser session.
    // E2 additions: the list's clients as a CSV, for the roles whose grid grants Clients EXPORT.
    exportList: async (body) => {
      await pause();
      const q = parseInput(ExportClientsRequest, body);
      if (!roleCan(options.role ?? 'OWNER', 'CLIENTS', 'EXPORT')) {
        throw fail(403, 'FORBIDDEN', 'You do not have access to this action');
      }
      // Export Selected: only the clients chosen, as the API.
      const { clientIds, ...filters } = q;
      const listed = await mock.list({ ...filters, page: 1, limit: 100 });
      const items = clientIds ? listed.items.filter((c) => clientIds.includes(c.id)) : listed.items;
      const csv = [
        'Client,Type,Email',
        ...items.map((c) => `${c.displayName},${c.accountType},${c.email ?? ''}`),
      ].join('\n');
      return {
        url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        fileName: 'clients.csv',
        rowCount: clientIds ? items.length : listed.total,
      };
    },
    // PRT-1 part 2: client 1 chose Lawrenceville at sign-up and has it; the others have none.
    // Clients Review 2 (G9): linked profiles, as the API (one link per pair; Staff, their own).
    links: async (id) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      return links
        .filter((l) => l.clientId === row.id || l.linkedClientId === row.id)
        .filter((l) => {
          const otherId = l.clientId === row.id ? l.linkedClientId : l.clientId;
          return rows.some((r) => r.id === otherId && visible(r));
        })
        .map((l) => linkView(l, row.id));
    },
    addLink: async (id, body) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      const input = parseInput(AddClientLinkRequest, body);
      if (input.linkedClientId === row.id) {
        throw new ApiRequestError(400, 'SELF_LINK', 'A client cannot be linked to itself');
      }
      const other = find(input.linkedClientId);
      if (row.archivedAt || other.archivedAt) {
        throw new ApiRequestError(409, 'CLIENT_ARCHIVED', 'Restore the archived client first');
      }
      const pair = (l: (typeof links)[number]) =>
        [l.clientId, l.linkedClientId].sort().join() === [row.id, other.id].sort().join();
      if (links.some(pair)) {
        throw new ApiRequestError(409, 'ALREADY_LINKED', 'These clients are already linked');
      }
      const link = {
        id: `0199b6aa-0000-7000-8000-${String(links.length + 1).padStart(12, '0')}`,
        clientId: row.id,
        linkedClientId: other.id,
        role: input.role,
        note: input.note ?? null,
        createdAt: now(),
      };
      links.push(link);
      return linkView(link, row.id);
    },
    updateLink: async (id, linkId, body) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      const input = parseInput(UpdateClientLinkRequest, body);
      const link = links.find(
        (l) => l.id === linkId && (l.clientId === row.id || l.linkedClientId === row.id),
      );
      if (!link) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      if (input.role) link.role = input.role;
      if (input.note !== undefined) link.note = input.note || null;
      return linkView(link, row.id);
    },
    removeLink: async (id, linkId) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      const at = links.findIndex(
        (l) => l.id === linkId && (l.clientId === row.id || l.linkedClientId === row.id),
      );
      if (at < 0) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      links.splice(at, 1);
      return { ok: true as const };
    },
    office: async (id) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      const current = officeOf.has(row.id)
        ? (officeOf.get(row.id) ?? null)
        : row.id.endsWith('1')
          ? MOCK_OFFICES[1]!.id
          : null;
      const office = MOCK_OFFICES.find((o) => o.id === current) ?? null;
      return {
        office: office ? { ...office, active: true } : null,
        chosenAtSignUp: row.id.endsWith('1')
          ? { id: MOCK_OFFICES[1]!.id, name: MOCK_OFFICES[1]!.name }
          : null,
        choices: MOCK_OFFICES,
        canChange: options.role !== 'STAFF',
      };
    },
    setOffice: async (id, body) => {
      await pause();
      if (options.role === 'STAFF')
        throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
      const row = find(parseInput(ClientId, id));
      const { officeId } = parseInput(SetClientOfficeRequest, body);
      if (officeId && !MOCK_OFFICES.some((o) => o.id === officeId)) {
        throw new ApiRequestError(
          400,
          'OFFICE_NOT_AVAILABLE',
          'Choose one of the firm’s active locations.',
        );
      }
      officeOf.set(row.id, officeId);
      const office = MOCK_OFFICES.find((o) => o.id === officeId) ?? null;
      return {
        office: office ? { ...office, active: true } : null,
        chosenAtSignUp: row.id.endsWith('1')
          ? { id: MOCK_OFFICES[1]!.id, name: MOCK_OFFICES[1]!.name }
          : null,
        choices: MOCK_OFFICES,
        canChange: true,
      };
    },
    // E4: the list's services as enrollments (the newest year's), plus a finished one for
    // client 1; each opens its module's list, where the role's grid views it.
    services: async (id) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      const n = Number(row.id.slice(-12));
      const role = options.role ?? 'OWNER';
      const MODULE: Partial<Record<ServiceRef['kind'], ClientServiceWorkspace['module']>> = {
        ANNUAL_TAX: 'TAX_RETURNS',
        QUARTERLY_TAX: 'TAX_RETURNS',
        BOOKKEEPING: 'BOOKKEEPING',
        PAYROLL: 'PAYROLL',
        TAX_PLANNING: 'TAX_PLANNING',
        BUSINESS_DEVELOPMENT: 'BUSINESS_ADVISORY',
      };
      const year = new Date().getUTCFullYear() - 1;
      const item = (
        s: ServiceRef,
        i: number,
        status: ClientService['status'],
        title: string,
      ): ClientService => {
        const area = MODULE[s.kind];
        return {
          // G8: client 1's first service is the engagements mock's first engagement, so the
          // Services tab's actions reach a real mock record.
          id:
            n === 1 && i === 0
              ? '0199b6a2-0000-7000-8000-000000000001'
              : `0199b6a5-0000-7000-8000-${String(n * 10 + i).padStart(12, '0')}`,
          service: s,
          title,
          status,
          since: row.createdAt,
          assignedTo: row.assignedTo,
          workspace: area && roleCan(role, area, 'VIEW') ? { module: area, id: null } : null,
        };
      };
      const items = (work()[n]?.services ?? []).map((s, i) =>
        item(s, i, 'ACTIVE', `${s.name} ${year}`),
      );
      const books = mockClientServices()[2];
      if (n === 1 && books) items.push(item(books, 9, 'COMPLETED', `Bookkeeping ${year - 1}`));
      return items;
    },
    timeline: async (id, query = {}) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      const { limit } = parseInput(ClientTimelineQuery, query);
      const all = timelineOf(row.id);
      return { items: all.slice(0, limit), nextCursor: null };
    },
    setTags: async (id, body) => {
      await pause();
      const row = find(parseInput(ClientId, id));
      const input = parseInput(SetClientTagsRequest, body);
      const names = mockResolveTags(input.tags, options.role ?? 'OWNER');
      tags.set(row.id, names);
      return { tags: [...names] };
    },
    create: async (body) => {
      await pause();
      const { profile, assignedUserId, allowDuplicatePhone, ...data } = parseInput(
        CreateClientRequest,
        body,
      );
      if (staffOnly && assignedUserId) throw forbidden();
      uniqueEmail(data.email);
      uniquePhone(data.phone, allowDuplicatePhone);
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
      const { assignedUserId, allowDuplicatePhone, ...data } = parseInput(
        UpdateClientRequest,
        body,
      );
      if (staffOnly && assignedUserId !== undefined) throw forbidden();
      const row = find(cid);
      notArchived(row);
      uniqueEmail(data.email, row.id);
      uniquePhone(data.phone, allowDuplicatePhone, row.id);
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
      const input = parseInput(UpdateClientProfileRequest, body);
      const row = find(cid);
      notArchived(row);
      // As the API (E5): a Business keeps its responsible party.
      if (input.responsibleParty === null && row.accountType === 'BUSINESS') {
        throw fail(400, 'VALIDATION_FAILED', 'A business keeps its responsible party');
      }
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
  return mock;
}

/**
 * An in-memory `api.myProfile(slug)` for the first fixture client. `portalRole: 'SPOUSE'` tries a
 * second login: no date of birth, and changes get 403 FORBIDDEN. `'AUTHORIZED'` also sees the
 * name only, the rest empty (q21).
 */
export function createMyProfileMock(
  options: { portalRole?: ClientPortalRole } = {},
): MyProfileClient {
  const portalRole = options.portalRole ?? 'PRIMARY';
  const primary = portalRole === 'PRIMARY';
  const nameOnly = portalRole === 'AUTHORIZED';
  const c = clientFixtures()[0]!;
  let me: MyProfile = MyProfile.parse({
    portalRole,
    fullName: c.displayName,
    dateOfBirth: primary ? c.profile.dateOfBirth : null,
    dateOfBirthUnavailable: primary && c.profile.dateOfBirthUnavailable,
    email: c.email,
    phone: nameOnly ? null : c.phone,
    address: nameOnly ? emptyAddress : c.profile.address,
    preferredContactMethod: nameOnly ? null : c.profile.preferredContactMethod,
    referralSource: nameOnly ? null : c.profile.referralSource,
    additionalInfo: nameOnly ? null : c.profile.additionalInfo,
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

let myProfileByFirm: Map<string, MyProfileClient> | undefined;

/** `api.myProfile(slug)` in mock mode: one client per firm, so saved changes stay. */
export function myProfileMock(firmSlug: string): MyProfileClient {
  myProfileByFirm ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = myProfileByFirm.get(key) ?? createMyProfileMock();
  myProfileByFirm.set(key, found);
  return found;
}
