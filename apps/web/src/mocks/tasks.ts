import {
  ApiRequestError,
  CreateTaskRequest,
  ListTasksQuery,
  type MemberRef,
  parseInput,
  Task,
  TaskId,
  type TasksClient,
  UpdateTaskRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { clientFixtures, firstClientId, type MockFirmRole, mockStaff } from './clients';

/**
 * Mock data for `api.tasks` (R12). Synthetic data only. Same checks, rules and error codes as the
 * API. `role: 'STAFF'` is Sam Staff, as in mocks/clients.ts: Sam sees his clients' tasks (clients
 * 1 and 2) and tasks assigned to him, and creates tasks only for his clients.
 */
const at = '2026-10-07T09:00:00.000Z';
const client = { id: firstClientId, displayName: 'Jamie Sample' };
const other = { id: '0199b6a1-0000-7000-8000-000000000003', displayName: 'Riley Example' };
/** The Bookkeeping engagement (mocks/engagements.ts) and the Tax Planning one (mocks/workspaces.ts). */
export const BOOKKEEPING_ENGAGEMENT = '0199b6a2-0000-7000-8000-000000000002';
export const TAX_PLANNING_ENGAGEMENT = '0199b6a2-0000-7000-8000-0000000000d1';
/** Last year's Tax Planning, COMPLETED (mocks/workspaces.ts). */
export const TAX_PLANNING_2025_ENGAGEMENT = '0199b6a2-0000-7000-8000-0000000000d2';
/** Each mock client's engagements: a task's engagement must be its client's. */
const ENGAGEMENTS: Record<string, readonly string[]> = {
  [client.id]: [BOOKKEEPING_ENGAGEMENT, TAX_PLANNING_ENGAGEMENT, TAX_PLANNING_2025_ENGAGEMENT],
};
/** The firm's active members: Mock User (mocks/me.ts) and Sam Staff. */
const members = (): MemberRef[] => [mockMe, mockStaff];
const taskId = (n: number) => `0199b6d1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const fixture = (n: number, fields: Partial<Task> & { title: string }): Task =>
  // Parsed, so a fixture that breaks the contract fails on first use.
  Task.parse({
    id: taskId(n),
    client,
    engagementId: null,
    details: null,
    kind: 'GENERAL',
    status: 'OPEN',
    dueOn: null,
    assignedTo: mockStaff,
    completedAt: null,
    createdBy: mockStaff,
    createdAt: at,
    updatedAt: at,
    ...fields,
  });

let fixtures: readonly Task[] | undefined;

/** Built on first use: importing this file runs nothing. */
export function taskFixtures(): readonly Task[] {
  fixtures ??= [
    fixture(1, {
      title: 'Reconcile September bank statement',
      engagementId: BOOKKEEPING_ENGAGEMENT,
      dueOn: '2026-10-15',
    }),
    fixture(2, {
      title: 'Ask for the missing payroll report',
      engagementId: BOOKKEEPING_ENGAGEMENT,
      dueOn: '2026-10-20',
    }),
    fixture(3, {
      title: 'Draft the 2026 estimate',
      engagementId: TAX_PLANNING_ENGAGEMENT,
      dueOn: '2026-10-25',
    }),
    fixture(4, {
      title: 'Update the client name',
      kind: 'NAME_CHANGE',
      details: 'Requested: Jamie Q. Sample',
    }),
    fixture(5, { title: 'Send the engagement letter', status: 'DONE', completedAt: at }),
    // An earlier name change, closed: reopening it while task 4 is open is NAME_CHANGE_PENDING.
    fixture(7, {
      title: 'Update the client name',
      kind: 'NAME_CHANGE',
      details: 'Requested: Jamie Sample-Smith',
      status: 'CANCELLED',
    }),
    fixture(6, {
      title: "Another staff member's client",
      client: other,
      assignedTo: mockMe,
      createdBy: mockMe,
    }),
  ];
  return fixtures;
}

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
/** The mock's cursor is the next row's position; anything else is refused, as by the API. */
export const mockOffset = (cursor: string | undefined) => {
  if (cursor === undefined) return 0;
  if (!/^\d{1,6}$/.test(cursor)) throw fail(400, 'VALIDATION_FAILED', 'Invalid cursor');
  return Number(cursor);
};

/** One store per page load, shared with the workspaces mock (open tasks on the detail). */
let rows: Task[] | undefined;
export const mockTaskStore = () => (rows ??= taskFixtures().map(copy));

const order = (a: Task, b: Task) => {
  if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
  if (b.status === 'OPEN' && a.status !== 'OPEN') return 1;
  if (a.status === 'OPEN') return (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999');
  return b.updatedAt.localeCompare(a.updatedAt);
};

/** An in-memory `api.tasks`. */
export function createTasksMock(options: { role?: MockFirmRole } = {}): TasksClient {
  let next = 100;
  const staffOnly = options.role === 'STAFF';
  const me = staffOnly ? mockStaff : mockMe;
  const theirClient = (clientId: string) =>
    clientFixtures().some((c) => c.id === clientId && c.assignedTo?.userId === me.userId);
  const visible = (t: Task) =>
    !staffOnly || theirClient(t.client.id) || t.assignedTo?.userId === me.userId;
  const find = (id: string) => {
    const t = mockTaskStore().find((x) => x.id === id && visible(x));
    if (!t) throw notFound();
    return t;
  };
  const assignee = (userId: string | null): MemberRef | null => {
    if (userId === null) return null;
    const m = members().find((x) => x.userId === userId);
    if (!m) throw fail(409, 'NOT_A_MEMBER', 'The assignee is not a member of the firm');
    return m;
  };
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListTasksQuery, query);
      const start = mockOffset(q.cursor);
      const all = mockTaskStore()
        .filter(visible)
        .filter(
          (t) =>
            (!q.clientId || t.client.id === q.clientId) &&
            (!q.engagementId || t.engagementId === q.engagementId) &&
            (!q.assignedUserId || t.assignedTo?.userId === q.assignedUserId) &&
            (!q.status || t.status === q.status),
        )
        .sort(order);
      const items = all.slice(start, start + q.limit);
      return copy({
        items,
        nextCursor: start + q.limit < all.length ? String(start + q.limit) : null,
      });
    },
    create: async (body) => {
      await mockDelay();
      const input = parseInput(CreateTaskRequest, body);
      const record = clientFixtures().find((c) => c.id === input.clientId);
      if (!record || (staffOnly && !theirClient(record.id))) throw notFound();
      if (input.engagementId && !ENGAGEMENTS[record.id]?.includes(input.engagementId)) {
        throw fail(409, 'ENGAGEMENT_MISMATCH', "The engagement is not this client's");
      }
      const assignedTo = assignee(input.assignedUserId ?? null);
      const now = new Date().toISOString();
      const created = fixture(next++, {
        title: input.title,
        client: { id: record.id, displayName: record.displayName },
        engagementId: input.engagementId ?? null,
        details: input.details ?? null,
        dueOn: input.dueOn ?? null,
        assignedTo,
        createdBy: me,
        createdAt: now,
        updatedAt: now,
      });
      mockTaskStore().push(created);
      return copy(created);
    },
    update: async (id, body) => {
      await mockDelay();
      const taskId = parseInput(TaskId, id);
      const input = parseInput(UpdateTaskRequest, body);
      const t = find(taskId);
      const { assignedUserId, status, ...rest } = input;
      const assignedTo = assignedUserId === undefined ? t.assignedTo : assignee(assignedUserId);
      if (
        status === 'OPEN' &&
        t.kind === 'NAME_CHANGE' &&
        t.status !== 'OPEN' &&
        mockTaskStore().some(
          (x) =>
            x !== t &&
            x.kind === 'NAME_CHANGE' &&
            x.status === 'OPEN' &&
            x.client.id === t.client.id,
        )
      ) {
        throw fail(409, 'NAME_CHANGE_PENDING', 'This client already has an open name change');
      }
      Object.assign(t, rest, { assignedTo, updatedAt: new Date().toISOString() });
      if (status) {
        t.status = status;
        t.completedAt = status === 'DONE' ? new Date().toISOString() : null;
      }
      return copy(t);
    },
  };
}
