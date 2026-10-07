import {
  type AdminRef,
  ApiRequestError,
  ApproveFirmApplicationRequest,
  type BusinessSummary,
  DeclineFirmApplicationRequest,
  type FirmApplicationCheck,
  type FirmApplicationEvent,
  FirmApplicationId,
  FirmApplicationRecord,
  type FirmApplicationsClient,
  FirmId,
  type FirmListItem,
  ListFirmApplicationsQuery,
  ListFirmsQuery,
  parseInput,
  RequestFirmInfoRequest,
  RESERVED_FIRM_SLUGS,
  SaveFirmNotesRequest,
  SubmitFirmApplicationRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockBusiness } from './me';

/**
 * Mock data for `api.firmApplications` (R4): the apply form, the Super Admin's applications, firms
 * and dashboard. Synthetic data only. Inputs are checked with the same schemas, in the same order
 * (400, then 404, then 409), and the API's error codes are returned, so a screen built on it works
 * unchanged against the real API. Nothing is built until the first call.
 */
const ADMIN: AdminRef = { userId: '0199b6a2-0000-7000-8000-0000000000a1', name: 'Morgan Admin' };
const uuid = (prefix: string, n: number) =>
  `${prefix}-0000-7000-8000-${String(n).padStart(12, '0')}`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const DAY = 24;
const WEEK_MS = 7 * 86_400_000;

type Row = FirmApplicationRecord;
type Fixture = Partial<Omit<Row, 'business'>> & {
  n: number;
  name: string;
  contact: string;
  email: string;
  hours: number;
  business?: Partial<Row['business']>;
};

/** One application; `history` lists what happened after it was submitted, newest first. */
const fixture = ({ n, name, contact, email, hours, business, history = [], ...data }: Fixture) =>
  // Parsed, so a fixture that breaks the contract fails on first use.
  FirmApplicationRecord.parse({
    id: uuid('0199b6a2', n),
    status: 'PENDING_REVIEW',
    submittedAt: hoursAgo(hours),
    business: {
      practiceType: 'TAX_ACCOUNTING',
      legalName: name,
      dbaName: null,
      entityType: 'LLC',
      einLast4: `00${String(n).padStart(2, '0')}`,
      email: null,
      phone: null,
      website: null,
      address: {
        line1: `${n} Example Way`,
        line2: null,
        city: 'Atlanta',
        state: 'GA',
        postalCode: '30301',
      },
      services: ['TAX_PREPARATION', 'BOOKKEEPING'],
      ...business,
    },
    primaryAdmin: {
      fullName: contact,
      email,
      phone: `+1404555010${n}`,
      title: 'Owner',
      preferredContact: 'EMAIL',
      alternatePhone: null,
    },
    account: {
      requestedPlan: 'PROFESSIONAL',
      teamSize: 3,
      clientVolume: 'FROM_250',
      heardFrom: 'Referral',
      requestedStartDate: null,
      additionalInfo: null,
    },
    credentials: [{ type: 'PTIN', number: `P0000000${n}`, issuedBy: 'IRS' }],
    documents: [],
    checks: [],
    internalNotes: null,
    decision: null,
    suggestedSlug: null,
    firm: null,
    ownerInvite: null,
    ...data,
    history: [...history, { type: 'SUBMITTED', at: hoursAgo(hours), by: null, message: null }],
  });

const done = (
  type: FirmApplicationEvent['type'],
  hours: number,
  message: string | null = null,
) => ({
  type,
  at: hoursAgo(hours),
  by: type === 'FIRM_ACTIVATED' ? null : ADMIN,
  message,
});
const firm = (n: number, name: string, slug: string, status: BusinessSummary['status']) => ({
  id: uuid('0199b6a3', n),
  slug,
  name,
  status,
});

let fixtures: readonly Row[] | undefined;

/**
 * Three pending applications (one waiting for information, one repeating a declined one), two
 * approved (a firm in setup and an active firm) and one declined.
 */
export function firmApplicationFixtures(): readonly Row[] {
  const reason = 'Not an accounting or tax practice.';
  fixtures ??= [
    fixture({
      n: 1,
      name: 'Sample Tax Partners LLC',
      contact: 'Jordan Sample',
      email: 'jordan@sample-tax.example.test',
      hours: 2 * DAY,
      business: { website: 'https://sample-tax.example.test' },
    }),
    fixture({
      n: 2,
      name: 'Example Books & Payroll',
      contact: 'Casey Example',
      email: 'casey.example@mail.example.test',
      hours: 3 * DAY,
      business: {
        practiceType: 'BOOKKEEPING',
        entityType: 'SOLE_PROPRIETOR',
        einLast4: null,
        website: 'https://example-books.example.test',
        services: ['BOOKKEEPING', 'PAYROLL'],
      },
      internalNotes: 'Asked for the PTIN by email; waiting for the reply.',
      history: [done('INFO_REQUESTED', DAY, 'Please send your PTIN.')],
    }),
    fixture({
      n: 3,
      name: 'Sample Ledger Advisors',
      contact: 'Riley Test',
      email: 'riley@sample-ledger.example.test',
      hours: 5,
      business: { einLast4: '0006' },
    }),
    fixture({
      n: 4,
      name: 'Sample Riverside Tax Co',
      contact: 'Avery Demo',
      email: 'avery@sample-riverside.example.test',
      hours: 4 * DAY,
      status: 'APPROVED',
      decision: { by: ADMIN, at: hoursAgo(3), reason: null },
      firm: firm(4, 'Sample Riverside Tax Co', 'sample-riverside-tax', 'PENDING_SETUP'),
      ownerInvite: { status: 'SENT', expiresAt: hoursAgo(3 - 7 * DAY) },
      history: [done('OWNER_INVITED', 3), done('APPROVED', 3)],
    }),
    fixture({
      n: 5,
      name: 'Example Northside Accounting LLC',
      contact: 'Taylor Placeholder',
      email: 'taylor@example-northside.example.test',
      hours: 9 * DAY,
      status: 'APPROVED',
      decision: { by: ADMIN, at: hoursAgo(8 * DAY), reason: null },
      firm: firm(5, 'Example Northside Accounting LLC', 'example-northside', 'ACTIVE'),
      ownerInvite: { status: 'ACCEPTED', expiresAt: hoursAgo(DAY) },
      history: [
        done('FIRM_ACTIVATED', 7 * DAY),
        done('OWNER_INVITED', 8 * DAY),
        done('APPROVED', 8 * DAY),
      ],
    }),
    fixture({
      n: 6,
      name: 'Sample Ledger Advisors',
      contact: 'Riley Test',
      email: 'riley@sample-ledger.example.test',
      hours: 6 * DAY,
      status: 'DECLINED',
      decision: { by: ADMIN, at: hoursAgo(4), reason },
      history: [done('DECLINED', 4, reason)],
    }),
  ];
  return fixtures;
}

/** A firm in the mock: from an approved application, or created without one (like the beta firm). */
interface MockFirm {
  firm: BusinessSummary;
  createdAt: string;
  applicationId: string | null;
  owner: FirmListItem['owner'];
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const easternMonth = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date(iso));
const page = <T>(items: T[], q: { page: number; pageSize: number }) => ({
  items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
  total: items.length,
  page: q.page,
  pageSize: q.pageSize,
});
const matches = (search: string | undefined, ...values: (string | null | undefined)[]) =>
  !search || values.some((v) => v?.toLowerCase().includes(search.toLowerCase()));
const check = (
  key: FirmApplicationCheck['key'],
  other: Row | undefined,
  what: string,
  pass: string,
) =>
  other
    ? {
        key,
        result: 'WARN' as const,
        note: `Same ${what} as ${other.business.legalName} (${other.status.toLowerCase().replace('_', ' ')})`,
      }
    : { key, result: 'PASS' as const, note: pass };

/** An in-memory `api.firmApplications`. The Super Admin acting is Morgan Admin. */
export function createFirmApplicationsMock(): FirmApplicationsClient {
  let rows: Row[] = structuredClone([...firmApplicationFixtures()]);
  const firms: MockFirm[] = [
    {
      firm: mockBusiness,
      createdAt: hoursAgo(30 * DAY),
      applicationId: null,
      owner: { name: 'Mock User', email: 'owner@lvp.test', phone: null },
    },
    ...rows.flatMap((r) =>
      r.firm
        ? [
            {
              firm: r.firm,
              createdAt: r.decision?.at ?? r.submittedAt,
              applicationId: r.id,
              owner: null,
            },
          ]
        : [],
    ),
    {
      firm: firm(7, 'Old Example Firm', 'old-example', 'SUSPENDED'),
      createdAt: hoursAgo(60 * DAY),
      applicationId: null,
      owner: { name: 'Sam Former', email: 'sam@old-example.example.test', phone: null },
    },
  ];
  /** Stands in for the API's keyed EIN hash: fixtures by their last 4, new applications by the EIN. */
  const einKeys = new Map(
    rows.map((r) => [r.id, r.business.einLast4 && `fixture-${r.business.einLast4}`]),
  );
  let nextId = 100;
  const now = () => new Date().toISOString();

  const taken = (slug: string) =>
    RESERVED_FIRM_SLUGS.includes(slug) || firms.some((f) => f.firm.slug === slug);
  /** The legal name as an address; cut before trimming hyphens, so it never ends in one. */
  const suggest = (name: string) => {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 56)
        .replace(/^-+|-+$/g, '') || 'firm';
    let slug = base;
    for (let i = 2; taken(slug); i++) slug = `${base}-${i}`;
    return slug;
  };
  /** The checks the API runs when an application is opened. */
  const checks = (row: Row): FirmApplicationCheck[] => {
    const others = rows.filter((r) => r.id !== row.id);
    const { legalName, website } = row.business;
    const einKey = einKeys.get(row.id);
    const host = website && new URL(website).hostname.replace(/^www\./, '');
    return [
      einKey
        ? check(
            'DUPLICATE_EIN',
            others.find((r) => einKeys.get(r.id) === einKey),
            'EIN',
            'No other application or firm has this EIN',
          )
        : { key: 'DUPLICATE_EIN', result: 'SKIPPED', note: 'No EIN given' },
      check(
        'DUPLICATE_NAME',
        others.find((r) => r.business.legalName.toLowerCase() === legalName.toLowerCase()),
        'name',
        'No other application or firm has this name',
      ),
      check(
        'DUPLICATE_EMAIL',
        others.find((r) => r.primaryAdmin.email === row.primaryAdmin.email),
        'email',
        'No other application uses this email',
      ),
      !host
        ? { key: 'EMAIL_DOMAIN', result: 'SKIPPED', note: 'No website given' }
        : host === row.primaryAdmin.email.split('@')[1]
          ? { key: 'EMAIL_DOMAIN', result: 'PASS', note: 'The email domain matches the website' }
          : {
              key: 'EMAIL_DOMAIN',
              result: 'WARN',
              note: "The email domain doesn't match the website",
            },
    ];
  };
  /** What the API returns: a copy, with the derived fields filled in. */
  const view = (row: Row): Row => {
    const invite = row.ownerInvite;
    return structuredClone({
      ...row,
      checks: checks(row),
      suggestedSlug: row.status === 'PENDING_REVIEW' ? suggest(row.business.legalName) : null,
      firm: firms.find((f) => f.firm.id === row.firm?.id)?.firm ?? null,
      ownerInvite:
        invite?.status === 'SENT' && invite.expiresAt < now()
          ? { ...invite, status: 'EXPIRED' as const }
          : invite,
    });
  };
  const find = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const pending = (row: Row) => {
    if (row.status !== 'PENDING_REVIEW')
      throw fail(409, 'APPLICATION_DECIDED', 'This application is already decided');
    return row;
  };
  /** The message of the last information request (the database keeps it as decision_reason). */
  const lastRequest = (row: Row) => row.history.find((h) => h.type === 'INFO_REQUESTED')?.message;
  const save = (row: Row) => {
    rows = rows.map((r) => (r.id === row.id ? row : r));
    return view(row);
  };
  const event = (type: FirmApplicationEvent['type'], message: string | null = null) => ({
    type,
    at: now(),
    by: ADMIN,
    message,
  });
  const invite = () => ({
    status: 'SENT' as const,
    expiresAt: new Date(Date.now() + WEEK_MS).toISOString(),
  });
  const firmItem = (f: MockFirm): FirmListItem => {
    const app = rows.find((r) => r.id === f.applicationId);
    const admin = app?.primaryAdmin;
    return structuredClone({
      ...f.firm,
      owner: admin ? { name: admin.fullName, email: admin.email, phone: admin.phone } : f.owner,
      plan: app?.account.requestedPlan ?? null,
      approvedAt: app?.decision?.at ?? null,
      createdAt: f.createdAt,
    });
  };

  return {
    submit: async (body) => {
      await mockDelay();
      const {
        business,
        primaryAdmin: admin,
        account,
        credentials,
      } = parseInput(SubmitFirmApplicationRequest, body);
      // Only the last 4 digits go into the record, as in the API.
      const { ein, ...biz } = business;
      const at = now();
      const row = FirmApplicationRecord.parse({
        id: uuid('0199b6a2', nextId++),
        status: 'PENDING_REVIEW',
        submittedAt: at,
        business: {
          ...biz,
          dbaName: biz.dbaName ?? null,
          einLast4: ein ? ein.slice(-4) : null,
          email: biz.email ?? null,
          phone: biz.phone ?? null,
          website: biz.website ?? null,
          address: { ...biz.address, line2: biz.address.line2 ?? null },
        },
        primaryAdmin: {
          ...admin,
          title: admin.title ?? null,
          alternatePhone: admin.alternatePhone ?? null,
        },
        account: {
          ...account,
          heardFrom: account.heardFrom ?? null,
          requestedStartDate: account.requestedStartDate ?? null,
          additionalInfo: account.additionalInfo ?? null,
        },
        credentials: credentials.map((c) => ({ ...c, issuedBy: c.issuedBy ?? null })),
        documents: [],
        checks: [],
        internalNotes: null,
        decision: null,
        suggestedSlug: null,
        firm: null,
        ownerInvite: null,
        history: [{ type: 'SUBMITTED', at, by: null, message: null }],
      });
      einKeys.set(row.id, ein ?? null);
      rows = [...rows, row];
      return { received: true };
    },

    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListFirmApplicationsQuery, query);
      const found = rows
        .filter((r) => !q.status || r.status === q.status)
        .filter((r) =>
          matches(
            q.search,
            r.business.legalName,
            r.business.dbaName,
            r.primaryAdmin.fullName,
            r.primaryAdmin.email,
          ),
        )
        .filter((r) => (!q.from || r.submittedAt >= q.from) && (!q.to || r.submittedAt < q.to))
        .sort(
          (a, b) => (q.order === 'oldest' ? 1 : -1) * a.submittedAt.localeCompare(b.submittedAt),
        )
        .map(({ id, status, submittedAt, business: b, primaryAdmin: p, account, decision }) => ({
          id,
          status,
          legalName: b.legalName,
          dbaName: b.dbaName,
          practiceType: b.practiceType,
          entityType: b.entityType,
          services: [...b.services],
          requestedPlan: account.requestedPlan,
          contactName: p.fullName,
          contactEmail: p.email,
          contactPhone: p.phone,
          submittedAt,
          decidedAt: decision?.at ?? null,
        }));
      return page(found, q);
    },

    counts: async () => {
      await mockDelay();
      const month = easternMonth(now());
      const count = (status: Row['status'], thisMonth = false) =>
        rows.filter(
          (r) =>
            r.status === status &&
            (!thisMonth || (r.decision && easternMonth(r.decision.at) === month)),
        ).length;
      return {
        all: rows.length,
        pendingReview: count('PENDING_REVIEW'),
        approved: count('APPROVED'),
        declined: count('DECLINED'),
        approvedThisMonth: count('APPROVED', true),
        declinedThisMonth: count('DECLINED', true),
      };
    },

    get: async (id) => {
      await mockDelay();
      return view(find(parseInput(FirmApplicationId, id)));
    },

    approve: async (id, body = {}) => {
      await mockDelay();
      const key = parseInput(FirmApplicationId, id);
      const { slug } = parseInput(ApproveFirmApplicationRequest, body);
      const row = pending(find(key));
      const chosen = slug ?? suggest(row.business.legalName);
      if (taken(chosen)) throw fail(409, 'SLUG_TAKEN', 'This portal address is not available');
      const created = firm(nextId++, row.business.legalName, chosen, 'PENDING_SETUP');
      firms.push({ firm: created, createdAt: now(), applicationId: row.id, owner: null });
      return save({
        ...row,
        status: 'APPROVED',
        decision: { by: ADMIN, at: now(), reason: null },
        firm: created,
        ownerInvite: invite(),
        history: [event('OWNER_INVITED'), event('APPROVED'), ...row.history],
      });
    },

    requestInfo: async (id, body) => {
      await mockDelay();
      const key = parseInput(FirmApplicationId, id);
      const { message } = parseInput(RequestFirmInfoRequest, body);
      const row = pending(find(key));
      // Like the database: the same message as the last request is no change and no new entry.
      if (lastRequest(row) === message) return view(row);
      return save({ ...row, history: [event('INFO_REQUESTED', message), ...row.history] });
    },

    decline: async (id, body) => {
      await mockDelay();
      const key = parseInput(FirmApplicationId, id);
      const { reason } = parseInput(DeclineFirmApplicationRequest, body);
      const row = pending(find(key));
      if (lastRequest(row) === reason) {
        throw fail(400, 'VALIDATION_FAILED', 'Write a reason that differs from the last request');
      }
      return save({
        ...row,
        status: 'DECLINED',
        decision: { by: ADMIN, at: now(), reason },
        history: [event('DECLINED', reason), ...row.history],
      });
    },

    saveNotes: async (id, body) => {
      await mockDelay();
      const key = parseInput(FirmApplicationId, id);
      const { notes } = parseInput(SaveFirmNotesRequest, body);
      return save({ ...find(key), internalNotes: notes });
    },

    resendOwnerInvite: async (id) => {
      await mockDelay();
      const row = find(parseInput(FirmApplicationId, id));
      if (row.status !== 'APPROVED' || row.ownerInvite?.status === 'ACCEPTED') {
        throw fail(409, 'INVITE_NOT_NEEDED', 'There is no activation link to send');
      }
      return save({
        ...row,
        ownerInvite: invite(),
        history: [event('OWNER_INVITED'), ...row.history],
      });
    },

    listFirms: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListFirmsQuery, query);
      const inStatus = (s: BusinessSummary['status']) =>
        !q.status ||
        (q.status === 'INACTIVE' ? s === 'SUSPENDED' || s === 'CLOSED' : s === q.status);
      const found = firms
        .map(firmItem)
        .filter(
          (f) => inStatus(f.status) && matches(q.search, f.name, f.owner?.name, f.owner?.email),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return page(found, q);
    },

    firmCounts: async () => {
      await mockDelay();
      const by = (...statuses: string[]) =>
        firms.filter((f) => statuses.includes(f.firm.status)).length;
      return {
        active: by('ACTIVE'),
        pendingSetup: by('PENDING_SETUP'),
        inactive: by('SUSPENDED', 'CLOSED'),
        total: firms.length,
      };
    },

    getFirm: async (id) => {
      await mockDelay();
      const key = parseInput(FirmId, id);
      const f = firms.find((x) => x.firm.id === key);
      if (!f) throw fail(404, 'NOT_FOUND', 'Not found');
      const app = rows.find((r) => r.id === f.applicationId);
      return { ...firmItem(f), application: app ? view(app) : null };
    },

    dashboard: async () => {
      await mockDelay();
      return {
        pendingApplications: rows.filter((r) => r.status === 'PENDING_REVIEW').length,
        activeFirms: firms.filter((f) => f.firm.status === 'ACTIVE').length,
        totalUsers: 12,
        newUsersThisWeek: 3,
        monthlyRevenueCents: null,
      };
    },
  };
}
