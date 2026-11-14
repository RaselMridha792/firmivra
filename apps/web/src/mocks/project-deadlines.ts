import {
  ApiRequestError,
  type MemberRef,
  PROJECT_DEADLINE_UNIT_MINUTES,
  type ProjectDeadline,
  ProjectDeadlinesQuery,
  type ProjectDeadlinesClient,
  SaveProjectDeadlineRequest,
  parseInput,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { firstClientId, type MockFirmRole, mockStaff } from './clients';

// Tax Planning Review 2, Project Deadlines in mock mode (synthetic data only): the API's rules on
// page memory. Mock User (the Owner role) owns a private deadline and one shared with Sam Staff;
// Sam Staff owns one shared with Mock User. Services are the catalog mock's (services-pricing.ts),
// clients the clients mock's.

const me: MemberRef = { userId: '00000000-0000-4000-8000-000000000101', name: 'Mock User' };
const admin: MemberRef = { userId: '0199b6a0-0000-7000-8000-0000000000a1', name: 'Alex Admin' };
const COWORKERS: MemberRef[] = [admin, me, mockStaff];
/** The catalog mock's Tax Planning and Personal Tax Preparation services. */
const SERVICES = {
  planning: { id: '0199c0e0-0a00-7000-8000-000000000004', name: 'Tax Planning' },
  personal: { id: '0199c0e0-0a00-7000-8000-000000000001', name: 'Personal Tax Preparation' },
};
const CLIENT = { id: firstClientId, name: 'Jamie Sample' };
const id = (n: number) => `0199c0d0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const inDays = (days: number, hour = 17) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

type Stored = Omit<ProjectDeadline, 'mine' | 'clientHidden'>;

function seed(): Stored[] {
  return [
    {
      id: id(1),
      name: 'Finish the 2027 planning projections',
      dueAt: inDays(5),
      description: 'Run the scenarios before the client meeting.',
      service: SERVICES.planning,
      client: CLIENT,
      owner: me,
      visibility: 'PRIVATE',
      sharedWith: [],
      reminders: [
        { amount: 1, unit: 'DAYS', inApp: true, email: true, sentAt: null },
        { amount: 2, unit: 'HOURS', inApp: true, email: false, sentAt: null },
      ],
      completedAt: null,
      completedBy: null,
      createdAt: inDays(-3),
    },
    {
      id: id(2),
      name: 'Send the plan for internal review',
      dueAt: inDays(12, 11),
      description: null,
      service: SERVICES.planning,
      client: null,
      owner: me,
      visibility: 'SHARED',
      sharedWith: [mockStaff],
      reminders: [{ amount: 2, unit: 'DAYS', inApp: true, email: true, sentAt: null }],
      completedAt: null,
      completedBy: null,
      createdAt: inDays(-2),
    },
    {
      id: id(3),
      name: 'Collect the estimated payment records',
      dueAt: inDays(20, 9),
      description: 'Ask for the Q3 and Q4 confirmations.',
      service: SERVICES.personal,
      client: null,
      owner: mockStaff,
      visibility: 'SHARED',
      sharedWith: [me],
      reminders: [],
      completedAt: null,
      completedBy: null,
      createdAt: inDays(-1),
    },
  ];
}

const fail = (status: number, code: string, message: string, path?: string) =>
  new ApiRequestError(
    status,
    code,
    message,
    undefined,
    undefined,
    path ? [{ path, message }] : undefined,
  );

/** An in-memory `api.projectDeadlines`; `role: 'STAFF'` signs in as Sam Staff. */
export function createProjectDeadlinesMock(
  options: { role?: MockFirmRole; empty?: boolean } = {},
): ProjectDeadlinesClient {
  const who = options.role === 'STAFF' ? mockStaff : me;
  let rows: Stored[] = options.empty ? [] : seed();
  let next = 100;
  const sees = (d: Stored) =>
    d.owner.userId === who.userId ||
    (d.visibility === 'SHARED' && d.sharedWith.some((m) => m.userId === who.userId));
  const view = (d: Stored): ProjectDeadline => ({
    ...structuredClone(d),
    mine: d.owner.userId === who.userId,
    clientHidden: false,
  });
  const find = (deadlineId: string) => {
    const d = rows.find((x) => x.id === deadlineId);
    if (!d || !sees(d)) throw fail(404, 'NOT_FOUND', 'Not found');
    return d;
  };
  const owned = (deadlineId: string) => {
    const d = find(deadlineId);
    if (d.owner.userId !== who.userId) {
      throw fail(403, 'OWNER_ONLY', 'Only the owner can change, share or delete this deadline');
    }
    return d;
  };
  const fields = (body: Parameters<ProjectDeadlinesClient['create']>[0]) => {
    const input = parseInput(SaveProjectDeadlineRequest, body);
    const service = Object.values(SERVICES).find((s) => s.id === input.serviceId) ?? {
      id: input.serviceId,
      name: 'Service',
    };
    const shared = input.sharedWithUserIds.map((userId) => {
      const m = COWORKERS.find((c) => c.userId === userId && c.userId !== who.userId);
      if (!m) {
        throw fail(
          400,
          'VALIDATION_FAILED',
          'Choose active coworkers of the firm',
          'sharedWithUserIds',
        );
      }
      return m;
    });
    return {
      name: input.name,
      dueAt: new Date(input.dueAt).toISOString(),
      description: input.description ?? null,
      service,
      client: input.clientId
        ? input.clientId === CLIENT.id
          ? CLIENT
          : { id: input.clientId, name: 'Client' }
        : null,
      visibility: input.visibility,
      sharedWith: shared.sort((a, b) => a.name.localeCompare(b.name)),
      reminders: input.reminders
        .map((r) => ({
          amount: r.amount,
          unit: r.unit,
          inApp: r.inApp,
          email: r.email,
          sentAt: null,
        }))
        .sort(
          (a, b) =>
            b.amount * PROJECT_DEADLINE_UNIT_MINUTES[b.unit] -
            a.amount * PROJECT_DEADLINE_UNIT_MINUTES[a.unit],
        ),
    };
  };
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ProjectDeadlinesQuery, query);
      return rows
        .filter(sees)
        .filter((d) =>
          q.status === 'open' ? !d.completedAt : q.status === 'completed' ? !!d.completedAt : true,
        )
        .filter((d) =>
          q.scope === 'mine'
            ? d.owner.userId === who.userId
            : q.scope === 'shared'
              ? d.owner.userId !== who.userId
              : true,
        )
        .sort((a, b) =>
          q.status === 'completed'
            ? b.dueAt.localeCompare(a.dueAt)
            : a.dueAt.localeCompare(b.dueAt),
        )
        .map(view);
    },
    coworkers: async () => {
      await mockDelay();
      return COWORKERS.filter((m) => m.userId !== who.userId);
    },
    get: async (deadlineId) => {
      await mockDelay();
      return view(find(deadlineId));
    },
    create: async (body) => {
      await mockDelay();
      const d: Stored = {
        id: id(next++),
        ...fields(body),
        owner: who,
        completedAt: null,
        completedBy: null,
        createdAt: new Date().toISOString(),
      };
      rows = [...rows, d];
      return view(d);
    },
    update: async (deadlineId, body) => {
      await mockDelay();
      const d = owned(deadlineId);
      Object.assign(d, fields(body));
      return view(d);
    },
    complete: async (deadlineId) => {
      await mockDelay();
      const d = find(deadlineId);
      d.completedAt ??= new Date().toISOString();
      d.completedBy ??= who;
      return view(d);
    },
    reopen: async (deadlineId) => {
      await mockDelay();
      const d = find(deadlineId);
      d.completedAt = null;
      d.completedBy = null;
      return view(d);
    },
    remove: async (deadlineId) => {
      await mockDelay();
      owned(deadlineId);
      rows = rows.filter((x) => x.id !== deadlineId);
      return { ok: true };
    },
  };
}
