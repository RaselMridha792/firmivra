import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { portalMe } from '../clients/client.js';
import { CalendarDate } from '../clients/schemas.js';

// Client Portal Review One T16 (Tasks Review T16 with T12): the tasks a firm marks visible to the
// client, in the portal's Requests area (GET /portal/{slug}/me/tasks, behind the per-client
// Tasks & Requests switch). Only the approved fields: title, instructions, where it stands, the
// due date and the checklist, and only the attachments approved one by one. Never internal notes,
// the assignee, priority, a blocked reason or any other staff field.

export const MyTaskId = z.uuid();

/** Where a task stands, in the client's words. A draft or cancelled task never shows. */
export const MyTaskStatus = z.enum([
  'TO_DO',
  'IN_PROGRESS',
  'WAITING_ON_YOU',
  'ON_HOLD',
  'COMPLETED',
]);
export type MyTaskStatus = z.infer<typeof MyTaskStatus>;

export const MyTaskRow = z.object({
  id: MyTaskId,
  title: z.string(),
  status: MyTaskStatus,
  dueOn: CalendarDate.nullable(),
  /** With `dueOn`, the firm's local time ("14:30"); null for an all-day task. */
  dueTime: z.string().nullable(),
  /** The checklist's progress. */
  checklist: z.object({ done: z.number().int(), total: z.number().int() }),
});
export type MyTaskRow = z.infer<typeof MyTaskRow>;

export const MyTaskList = z.object({ items: z.array(MyTaskRow) });
export type MyTaskList = z.infer<typeof MyTaskList>;

/** A file the firm approved for this task (download it with the portal's documents route). */
export const MyTaskAttachment = z.object({
  documentId: z.uuid(),
  fileName: z.string(),
});
export type MyTaskAttachment = z.infer<typeof MyTaskAttachment>;

export const MyTask = MyTaskRow.extend({
  /** The firm's instructions for the client. */
  details: z.string().nullable(),
  checklistItems: z.array(z.object({ id: z.uuid(), label: z.string(), done: z.boolean() })),
  /** Only the files approved for the client, and only for a household login (PRIMARY, SPOUSE). */
  attachments: z.array(MyTaskAttachment),
});
export type MyTask = z.infer<typeof MyTask>;

/** The signed-in client's visible tasks at one firm (portal, Requests area). */
export function createMyTasksClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/tasks`;
  return {
    /** Open tasks first by due date, then the completed ones. */
    list: async (): Promise<MyTaskRow[]> => (await request(MyTaskList, base())).items,
    get: async (id: string): Promise<MyTask> =>
      request(MyTask, `${base()}/${parseInput(MyTaskId, id)}`),
  };
}
export type MyTasksClient = ReturnType<typeof createMyTasksClient>;
