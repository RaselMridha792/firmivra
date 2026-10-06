import {
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
import { clientFixtures } from './clients';

/**
 * Mock data for `api.engagements` and `api.myServices(slug)` (R10). Synthetic data only. Same
 * input checks, lifecycle rules and error codes as the API.
 */
const at = '2026-10-01T09:00:00.000Z';
const day = 86_400_000;
const date = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
const client = clientFixtures[0]!.id;
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
    assignedTo: { userId: '0199b6a0-0000-7000-8000-0000000000f1', name: 'Sam Staff' },
    completedAt: null,
    cancelRequestedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: at,
    updatedAt: at,
    ...data,
  });

/** The first portal client's services: one of each tab (Active, Recurring, Completed, Cancelled). */
export const engagementFixtures: readonly Engagement[] = [
  fixture(1, { title: '2025 Personal Tax', taxYear: 2025, stage: 'Preparation' }),
  fixture(2, {
    title: 'Bookkeeping (Growth)',
    service: ref(services[1]!),
    package: 'Growth',
    stage: 'Monthly close',
    billingInterval: 'MONTHLY',
    recurring: true,
    nextBillingOn: date(40),
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
    cancelledAt: new Date(Date.now() - 30 * day).toISOString(),
    cancellationReason: 'Client moved payroll in-house.',
  }),
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const now = () => new Date().toISOString();

/** Each mock keeps its own rows; callers always get copies, like a real API response. */
function createStore() {
  let rows: Engagement[] = engagementFixtures.map((r) => structuredClone(r));
  let history: {
    engagementId: string;
    status: EngagementStatus;
    stage: string | null;
    changedAt: string;
  }[] = [];
  return {
    all: () => rows,
    history: () => history,
    find: (id: string) => {
      const row = rows.find((r) => r.id === parseInput(EngagementId, id));
      if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
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
const checkStage = (row: Engagement, stage: string | null | undefined) => {
  const service = services.find((s) => s.id === row.service.id);
  if (stage && service && !service.stages.includes(stage)) {
    throw fail(409, 'INVALID_STAGE', "The stage is not one of the service's stages");
  }
};
const newestFirst = (a: Engagement, b: Engagement) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** An in-memory `api.engagements`. */
export function createEngagementsMock(): EngagementsClient {
  const { all, history, find, save } = createStore();
  let nextId = 100;
  return {
    listForClient: async (clientId, query = {}) => {
      await pause();
      const id = parseInput(ClientId, clientId);
      const { status } = parseInput(ListEngagementsQuery, query);
      return all()
        .filter((r) => r.clientId === id && (!status || r.status === status))
        .sort(newestFirst)
        .map((r) => structuredClone(r));
    },
    get: async (id) => {
      await pause();
      return structuredClone(find(id));
    },
    create: async (body) => {
      await pause();
      const { serviceId, assignedUserId: _a, ...data } = parseInput(CreateEngagementRequest, body);
      const service = services.find((s) => s.id === serviceId);
      if (!service) throw fail(404, 'NOT_FOUND', 'Not found');
      const billingInterval = data.billingInterval ?? 'ONE_TIME';
      const row = fixture(nextId++, {
        ...data,
        service: ref(service),
        billingInterval,
        recurring: billingInterval !== 'ONE_TIME',
        assignedTo: null,
        createdAt: now(),
        updatedAt: now(),
      });
      checkStage(row, row.stage);
      return save(row);
    },
    update: async (id, body) => {
      await pause();
      const { assignedUserId: _a, ...data } = parseInput(UpdateEngagementRequest, body);
      const row = find(id);
      checkStage(row, data.stage);
      return save({ ...row, ...data, updatedAt: now() });
    },
    complete: async (id) => {
      await pause();
      const row = find(id);
      if (row.status === 'COMPLETED' || row.status === 'CANCELLED') {
        throw fail(409, 'INVALID_STATUS', 'Only a pending or active engagement can be completed');
      }
      return save({ ...row, status: 'COMPLETED', completedAt: now(), updatedAt: now() });
    },
    cancel: async (id, body) => {
      await pause();
      const { reason } = parseInput(CancelEngagementRequest, body);
      const row = find(id);
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
      const row = find(id);
      if (row.status !== 'CANCELLED')
        throw fail(409, 'INVALID_STATUS', 'Only a cancelled engagement can be reactivated');
      if (Date.now() - Date.parse(row.cancelledAt!) > 90 * day) {
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
        updatedAt: now(),
      });
    },
    history: async (id) => {
      await pause();
      find(id);
      return history()
        .filter((h) => h.engagementId === id)
        .map(({ engagementId: _e, ...h }) => ({ ...h, changedBy: null }));
    },
  };
}

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
    cancelRequestedAt: r.cancelRequestedAt,
    cancelledAt: r.cancelledAt,
    documentAccessUntil: r.cancelledAt
      ? new Date(Date.parse(r.cancelledAt) + 60 * day).toISOString().slice(0, 10)
      : null,
  });

/** An in-memory `api.myServices(slug)` for the first fixture client. */
export function createMyServicesMock(): MyServicesClient {
  const { all, find, save } = createStore();
  return {
    list: async () => {
      await pause();
      return all()
        .filter((r) => r.clientId === client)
        .sort(newestFirst)
        .map(toMyService);
    },
    requestCancellation: async (id, body = {}) => {
      await pause();
      parseInput(RequestCancellationRequest, body);
      const row = find(id);
      if (row.clientId !== client) throw fail(404, 'NOT_FOUND', 'Not found');
      if (!row.recurring)
        throw fail(409, 'NOT_RECURRING', 'Only recurring services can be cancelled here');
      if (row.nextBillingOn && Date.parse(row.nextBillingOn) - Date.now() < 14 * day) {
        throw fail(
          409,
          'TOO_LATE_TO_CANCEL',
          'Cancel at least 14 days before the next billing date',
        );
      }
      return toMyService(save({ ...row, cancelRequestedAt: now(), updatedAt: now() }));
    },
  };
}
