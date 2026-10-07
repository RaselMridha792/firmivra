import {
  ApiRequestError,
  CreateTaskRequest,
  ListTasksQuery,
  parseInput,
  Task,
  type TasksClient,
  UpdateTaskRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { firstClientId, type MockFirmRole, mockStaff } from './clients';

/**
 * Mock data for `api.tasks` (R12). Synthetic data only. Same checks, rules and error codes as the
 * API: `role: 'STAFF'` sees only Sam Staff's clients' tasks and tasks assigned to Sam.
 */
const at = '2026-10-07T09:00:00.000Z';
const client = { id: firstClientId, displayName: 'Jamie Sample' };
const other = { id: '0199b6a1-0000-7000-8000-000000000003', displayName: 'Riley Example' };
/** The Bookkeeping engagement (mocks/engagements.ts) and the Tax Planning one (mocks/workspaces.ts). */
export const BOOKKEEPING_ENGAGEMENT = '0199b6a2-0000-7000-8000-000000000002';
export const TAX_PLANNING_ENGAGEMENT = '0199b6a2-0000-7000-8000-0000000000d1';
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
    fixture(6, { title: "Another staff member's client", client: other, assignedTo: null }),
  ];
  return fixtures;
}

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

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
  const visible = (t: Task) =>
    options.role !== 'STAFF' ||
    t.client.id === firstClientId ||
    t.assignedTo?.userId === mockStaff.userId;
  const find = (id: string) => {
    const t = mockTaskStore().find((x) => x.id === id && visible(x));
    if (!t) throw fail(404, 'NOT_FOUND', 'Not found');
    return t;
  };
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListTasksQuery, query);
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
      const start = q.cursor ? Number(q.cursor) : 0;
      const items = all.slice(start, start + q.limit);
      return copy({
        items,
        nextCursor: start + q.limit < all.length ? String(start + q.limit) : null,
      });
    },
    create: async (body) => {
      await mockDelay();
      const input = parseInput(CreateTaskRequest, body);
      if (input.clientId !== client.id && input.clientId !== other.id)
        throw fail(404, 'NOT_FOUND', 'Not found');
      if (input.assignedUserId && input.assignedUserId !== mockStaff.userId) {
        throw fail(409, 'NOT_A_MEMBER', 'The assignee is not a member of the firm');
      }
      const now = new Date().toISOString();
      const created = fixture(next++, {
        title: input.title,
        client: input.clientId === client.id ? client : other,
        engagementId: input.engagementId ?? null,
        details: input.details ?? null,
        dueOn: input.dueOn ?? null,
        assignedTo: input.assignedUserId ? mockStaff : null,
        createdAt: now,
        updatedAt: now,
      });
      mockTaskStore().push(created);
      return copy(created);
    },
    update: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateTaskRequest, body);
      const t = find(id);
      const { assignedUserId, status, ...rest } = input;
      Object.assign(t, rest, { updatedAt: new Date().toISOString() });
      if (assignedUserId !== undefined) t.assignedTo = assignedUserId ? mockStaff : null;
      if (status) {
        t.status = status;
        t.completedAt = status === 'DONE' ? new Date().toISOString() : null;
      }
      return copy(t);
    },
  };
}
