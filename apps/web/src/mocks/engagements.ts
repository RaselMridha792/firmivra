import {
  type ClientPortalRole,
  ApiRequestError,
  CancelEngagementRequest,
  ClientId,
  CreateEngagementRequest,
  Engagement,
  EngagementId,
  type EngagementsClient,
  type EngagementStatus,
  ListEngagementsQuery,
  MyService,
  type MyServicesClient,
  parseInput,
  RequestCancellationRequest,
  type ServiceRef,
  UpdateEngagementRequest,
} from '@firmivra/types';
import { clientFixtures, firstClientId, mockStaff, type MockFirmRole } from './clients';

/**
 * Mock data for `api.engagements` and `api.myServices(slug)` (R10). Synthetic data only. Same
 * input checks, lifecycle rules and error codes as the API.
 */
const at = '2026-10-01T09:00:00.000Z';
const DAY = 86_400_000;
/** The mock firm's time zone: "today" and cancelBy follow its calendar, as the API's do. */
const FIRM_TIME_ZONE = 'America/New_York';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: FIRM_TIME_ZONE }).format(new Date());
/** A calendar date `days` after (or before) `date`. */
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

const client = firstClientId;
const services: (ServiceRef & { stages: string[] })[] = [
  {
    id: '0199b6a2-0000-7000-8000-0000000000a1',
    name: 'Annual Tax',
    kind: 'ANNUAL_TAX',
    stages: ['New', 'Preparation', 'Review', 'Filed'],
  },
  {
    id: '0199b6a2-0000-7000-8000-0000000000b2',
    name: 'Bookkeeping',
    kind: 'BOOKKEEPING',
    stages: ['Monthly close'],
  },
  { id: '0199b6a2-0000-7000-8000-0000000000c3', name: 'Payroll', kind: 'PAYROLL', stages: [] },
];
const ref = ({ stages: _s, ...service }: (typeof services)[number]) => service;

const fixture = (n: number, data: Partial<Engagement> & { title: string }): Engagement =>
  Engagement.parse({
    id: `0199b6a2-0000-7000-8000-${String(n).padStart(12, '0')}`,
    clientId: client,
    service: ref(services[0]!),
    taxYear: null,
    periodStart: null,
    periodEnd: null,
    package: null,
    status: 'ACTIVE',
    stage: null,
    billingInterval: 'ONE_TIME',
    recurring: false,
    nextBillingOn: null,
    assignedTo: mockStaff,
    completedAt: null,
    cancelRequestedAt: null,
    cancelRequestReason: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: at,
    updatedAt: at,
    ...data,
  });

let fixtures: readonly Engagement[] | undefined;

/**
 * The first portal client's services: one of each tab (Active, Recurring, Completed, Cancelled).
 * Built on first use: importing this file runs nothing.
 */
export function engagementFixtures(): readonly Engagement[] {
  fixtures ??= [
    fixture(1, { title: '2025 Personal Tax', taxYear: 2025, stage: 'Preparation' }),
    fixture(2, {
      title: 'Bookkeeping (Growth)',
      service: ref(services[1]!),
      package: 'Growth',
      stage: 'Monthly close',
      billingInterval: 'MONTHLY',
      recurring: true,
      nextBillingOn: addDays(today(), 40),
    }),
    fixture(3, {
      title: '2024 Personal Tax',
      taxYear: 2024,
      status: 'COMPLETED',
      stage: 'Filed',
      completedAt: '2025-04-12T16:00:00.000Z',
    }),
    fixture(4, {
      title: 'Payroll',
      service: ref(services[2]!),
      billingInterval: 'MONTHLY',
      recurring: true,
      status: 'CANCELLED',
      cancelledAt: new Date(Date.now() - 30 * DAY).toISOString(),
      cancellationReason: 'Client moved payroll in-house.',
    }),
  ];
  return fixtures;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const now = () => new Date().toISOString();
const newestFirst = (a: Engagement, b: Engagement) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
/**
 * As in the API: an archived client takes no new engagement, edit or reactivation; complete and
 * cancel stay allowed, to wind its work down.
 */
const assertNotArchived = (clientId: string) => {
  if (clientFixtures().find((c) => c.id === clientId)?.archivedAt) {
    throw fail(409, 'CLIENT_ARCHIVED', 'Restore the client first');
  }
};
/** The clients a role may reach (Staff: their assigned ones). */
const reachable = (role?: MockFirmRole) =>
  new Set(
    clientFixtures()
      .filter((c) => role !== 'STAFF' || c.assignedTo?.userId === mockStaff.userId)
      .map((c) => c.id),
  );

/** Each mock keeps its own rows; callers always get copies, like a real API response. */
function createStore(clients: Set<string>) {
  let rows: Engagement[] = engagementFixtures().map((r) => structuredClone(r));
  let history: {
    engagementId: string;
    status: EngagementStatus;
    stage: string | null;
    changedAt: string;
  }[] = [];
  return {
    all: () => rows.filter((r) => clients.has(r.clientId)),
    history: () => history,
    /** The id is already checked. */
    find: (id: string) => {
      const row = rows.find((r) => r.id === id && clients.has(r.clientId));
      if (!row) throw notFound();
      return row;
    },
    /** Saves the row; a status or stage change gets a history entry, as in the database. */
    save: (row: Engagement) => {
      const before = rows.find((r) => r.id === row.id);
      if (!before || before.status !== row.status || before.stage !== row.stage) {
        history = [
          { engagementId: row.id, status: row.status, stage: row.stage, changedAt: now() },
          ...history,
        ];
      }
      rows = [...rows.filter((r) => r.id !== row.id), row];
      return structuredClone(row);
    },
  };
}

const checkStage = (serviceId: string, stage: string | null | undefined) => {
  const service = services.find((s) => s.id === serviceId);
  if (stage && service && !service.stages.includes(stage)) {
    throw fail(409, 'INVALID_STAGE', "The stage is not one of the service's stages");
  }
};
const defined = <T extends object>(data: T) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Partial<T>;

/** An in-memory `api.engagements`. `role: 'STAFF'` reaches only Sam Staff's clients. */
export function createEngagementsMock(options: { role?: MockFirmRole } = {}): EngagementsClient {
  const clients = reachable(options.role);
  const { all, history, find, save } = createStore(clients);
  let nextId = 100;
  const forbidden = () => fail(403, 'FORBIDDEN', 'This action is not permitted');
  return {
    listForClient: async (clientId, query = {}) => {
      await pause();
      const id = parseInput(ClientId, clientId);
      const { status } = parseInput(ListEngagementsQuery, query);
      if (!clients.has(id)) throw notFound();
      return all()
        .filter((r) => r.clientId === id && (!status || r.status === status))
        .sort(newestFirst)
        .map((r) => structuredClone(r));
    },
    get: async (id) => {
      await pause();
      return structuredClone(find(parseInput(EngagementId, id)));
    },
    create: async (clientId, body) => {
      await pause();
      const id = parseInput(ClientId, clientId);
      const { serviceId, assignedUserId, ...data } = parseInput(CreateEngagementRequest, body);
      if (options.role === 'STAFF' && assignedUserId) throw forbidden();
      const service = services.find((s) => s.id === serviceId);
      if (!clients.has(id) || !service) throw notFound();
      assertNotArchived(id);
      checkStage(serviceId, data.stage);
      const billingInterval = data.billingInterval ?? 'ONE_TIME';
      return save(
        fixture(nextId++, {
          ...data,
          clientId: id,
          service: ref(service),
          billingInterval,
          recurring: billingInterval !== 'ONE_TIME',
          createdAt: now(),
          updatedAt: now(),
        }),
      );
    },
    update: async (id, body) => {
      await pause();
      const eid = parseInput(EngagementId, id);
      const { assignedUserId, ...data } = parseInput(UpdateEngagementRequest, body);
      if (options.role === 'STAFF' && assignedUserId !== undefined) throw forbidden();
      const row = find(eid);
      assertNotArchived(row.clientId);
      checkStage(row.service.id, data.stage);
      return save({
        ...row,
        ...defined(data),
        ...(assignedUserId !== undefined
          ? { assignedTo: assignedUserId === mockStaff.userId ? mockStaff : null }
          : {}),
        updatedAt: now(),
      });
    },
    complete: async (id) => {
      await pause();
      const row = find(parseInput(EngagementId, id));
      if (row.status === 'COMPLETED' || row.status === 'CANCELLED') {
        throw fail(409, 'INVALID_STATUS', 'Only a pending or active engagement can be completed');
      }
      return save({ ...row, status: 'COMPLETED', completedAt: now(), updatedAt: now() });
    },
    cancel: async (id, body) => {
      await pause();
      const eid = parseInput(EngagementId, id);
      const { reason } = parseInput(CancelEngagementRequest, body);
      const row = find(eid);
      if (row.status === 'CANCELLED') throw fail(409, 'INVALID_STATUS', 'Already cancelled');
      return save({
        ...row,
        status: 'CANCELLED',
        cancelledAt: now(),
        cancellationReason: reason,
        updatedAt: now(),
      });
    },
    reactivate: async (id) => {
      await pause();
      const row = find(parseInput(EngagementId, id));
      assertNotArchived(row.clientId);
      if (row.status !== 'CANCELLED') {
        throw fail(409, 'INVALID_STATUS', 'Only a cancelled engagement can be reactivated');
      }
      if (Date.now() - Date.parse(row.cancelledAt!) > 90 * DAY) {
        throw fail(
          409,
          'REACTIVATION_WINDOW_PASSED',
          'A cancelled engagement can be reactivated only within 90 days',
        );
      }
      return save({
        ...row,
        status: 'ACTIVE',
        cancelledAt: null,
        cancellationReason: null,
        completedAt: null,
        cancelRequestedAt: null,
        cancelRequestReason: null,
        updatedAt: now(),
      });
    },
    history: async (id) => {
      await pause();
      const eid = parseInput(EngagementId, id);
      find(eid);
      return history()
        .filter((h) => h.engagementId === eid)
        .map(({ engagementId: _e, ...h }) => ({ ...h, changedBy: null }));
    },
  };
}

/**
 * 14 days before the next billing date, for an ACTIVE recurring service; else null. A next
 * billing date already past is stale: no deadline (as in the API).
 */
const cancelBy = (r: Engagement) =>
  r.status === 'ACTIVE' && r.recurring && r.nextBillingOn && r.nextBillingOn >= today()
    ? addDays(r.nextBillingOn, -14)
    : null;

const toMyService = (r: Engagement): MyService =>
  MyService.parse({
    id: r.id,
    service: { name: r.service.name, kind: r.service.kind },
    title: r.title,
    taxYear: r.taxYear,
    package: r.package,
    status: r.status,
    stage: r.stage,
    billingInterval: r.billingInterval,
    recurring: r.recurring,
    nextBillingOn: r.nextBillingOn,
    cancelBy: cancelBy(r),
    cancelRequestedAt: r.cancelRequestedAt,
    cancelledAt: r.cancelledAt,
    documentAccessUntil: r.cancelledAt ? addDays(r.cancelledAt.slice(0, 10), 60) : null,
  });

/**
 * An in-memory `api.myServices(slug)` for the first fixture client. `portalRole: 'SPOUSE'` (or
 * AUTHORIZED) is another login of that client: it reads, and a cancellation request is 403.
 */
export function createMyServicesMock(
  options: { portalRole?: ClientPortalRole } = {},
): MyServicesClient {
  const primary = (options.portalRole ?? 'PRIMARY') === 'PRIMARY';
  const { all, find, save } = createStore(new Set([client]));
  return {
    list: async () => {
      await pause();
      return all().sort(newestFirst).map(toMyService);
    },
    requestCancellation: async (id, body = {}) => {
      await pause();
      const eid = parseInput(EngagementId, id);
      const { reason } = parseInput(RequestCancellationRequest, body);
      if (!primary) throw fail(403, 'FORBIDDEN', 'This action is not permitted');
      const row = find(eid);
      if (!row.recurring) {
        throw fail(409, 'NOT_RECURRING', 'Only recurring services can be cancelled here');
      }
      if (row.status !== 'ACTIVE') {
        throw fail(409, 'INVALID_STATUS', 'Only an active service can be cancelled');
      }
      // Asking again changes nothing.
      if (row.cancelRequestedAt) return toMyService(row);
      const last = cancelBy(row);
      if (last && today() > last) {
        throw fail(
          409,
          'TOO_LATE_TO_CANCEL',
          'Cancel at least 14 days before the next billing date',
        );
      }
      return toMyService(
        save({
          ...row,
          cancelRequestedAt: now(),
          cancelRequestReason: reason ?? null,
          updatedAt: now(),
        }),
      );
    },
  };
}

let mineByFirm: Map<string, MyServicesClient> | undefined;

/** `api.myServices(slug)` in mock mode: one per firm slug, made on first use. */
export function myServicesMock(firmSlug: string): MyServicesClient {
  mineByFirm ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = mineByFirm.get(key) ?? createMyServicesMock();
  mineByFirm.set(key, found);
  return found;
}
