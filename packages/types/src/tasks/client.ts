import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  CreateTaskRequest,
  ListTasksQuery,
  Task,
  TaskId,
  TaskList,
  UpdateTaskRequest,
} from './schemas.js';

const BASE = '/business/tasks';

/**
 * `api.tasks`: the firm's to-dos for its clients (client record Tasks tab, workspaces). Staff see,
 * change and create only their assigned clients' tasks (404 NOT_FOUND otherwise). A client's task
 * goes to a Staff member only when that client is assigned to them (409 CLIENT_NOT_ASSIGNED).
 */
export function createTasksClient(request: ApiRequest) {
  return {
    /** One page; pass `nextCursor` back as `cursor` for the next. */
    list: async (query: ListTasksQuery = {}): Promise<TaskList> => {
      const q = parseInput(ListTasksQuery, query);
      return request(TaskList, `${BASE}${toQuery(q)}`);
    },
    create: async (body: CreateTaskRequest): Promise<Task> =>
      request(Task, BASE, { method: 'POST', body: parseInput(CreateTaskRequest, body) }),
    update: async (id: string, body: UpdateTaskRequest): Promise<Task> =>
      request(Task, `${BASE}/${parseInput(TaskId, id)}`, {
        method: 'PATCH',
        body: parseInput(UpdateTaskRequest, body),
      }),
  };
}
export type TasksClient = ReturnType<typeof createTasksClient>;
