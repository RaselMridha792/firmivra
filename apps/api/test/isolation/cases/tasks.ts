// Tasks on an engagement, and the Tasks module (R55): detail, actions, checklist, attachments,
// bulk actions and task types. Each route that changes a task gets a record of its own, so one
// case never breaks the next (a completed task cannot take a stage, an archived one no edit).
import { randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef, SeedContext } from '../world.js';

const tag = () => randomUUID().slice(0, 8);

/** A client X task on the world's engagement; the fields it starts with are the caller's. */
const task = (
  extra: (
    ctx: SeedContext,
  ) => Promise<Record<string, unknown>> | Record<string, unknown> = () => ({}),
): RecordDef => ({
  clientPrivate: true,
  async create(ctx) {
    const { tx, businessId, get } = ctx;
    const row = await tx.task.create({
      data: {
        businessId,
        clientId: await get('client'),
        engagementId: await get('engagement'),
        title: 'Fake task',
        ...(await extra(ctx)),
      },
    });
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  task: task(),
  taskProgress: task(),
  taskComplete: task(),
  taskReopen: task(),
  taskCancel: task(),
  taskArchive: task(),
  taskRestore: task(),
  taskBulk: task(),
  /** A task with exactly one checklist step, `taskChecklistItem`. */
  taskWithItem: task(),
  taskChecklistItem: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taskChecklistItem.create({
        data: { businessId, taskId: await get('taskWithItem'), label: 'Fake step', position: 0 },
      });
      return row.id;
    },
  },
  /** A task to attach a document to. */
  taskForAttach: task(),
  /** Tasks that already hold the attachment `taskAttachment` / `taskAttachmentDelete`. */
  taskWithAttachment: task(),
  taskAttachment: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taskAttachment.create({
        data: {
          businessId,
          taskId: await get('taskWithAttachment'),
          documentId: await get('document'),
        },
      });
      return row.id;
    },
  },
  taskWithAttachmentDelete: task(),
  taskAttachmentDelete: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taskAttachment.create({
        data: {
          businessId,
          taskId: await get('taskWithAttachmentDelete'),
          documentId: await get('document'),
        },
      });
      return row.id;
    },
  },
  /** A task type tasks are made with, and one the type routes change. */
  taskType: {
    async create({ tx, businessId }) {
      return (await tx.taskType.create({ data: { businessId, name: `Fake type ${tag()}` } })).id;
    },
  },
  taskTypeEdit: {
    async create({ tx, businessId }) {
      return (await tx.taskType.create({ data: { businessId, name: `Fake type ${tag()}` } })).id;
    },
  },
  taskTemplate: {
    async create({ tx, businessId }) {
      return (
        await tx.taskTemplate.create({ data: { businessId, name: `Fake template ${tag()}` } })
      ).id;
    },
  },
};

const BASE = '/api/v1/business';
/** The ids a new task's body can name. */
const NEW_TASK_IDS = {
  clientId: 'client',
  engagementId: 'engagement',
  assignedUserId: 'adminUser',
  typeId: 'taskType',
  serviceId: 'service',
  dependsOnTaskId: 'task',
  additionalAssigneeIds: 'adminUser',
  templateId: 'taskTemplate',
  'checklist.assignedUserId': 'adminUser',
  'attachments.documentId': 'document',
};
const PLACEHOLDER = randomUUID();

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}/tasks`]: {
    params: {},
    bodyIds: NEW_TASK_IDS,
    body: {
      title: 'Fake task',
      checklist: [{ label: 'Fake step', assignedUserId: PLACEHOLDER }],
      attachments: [{ documentId: PLACEHOLDER }],
    },
  },
  [`PATCH ${BASE}/tasks/:id`]: {
    params: { id: 'taskWithItem' },
    bodyIds: {
      assignedUserId: 'adminUser',
      typeId: 'taskType',
      serviceId: 'service',
      dependsOnTaskId: 'task',
      additionalAssigneeIds: 'adminUser',
      'checklist.id': 'taskChecklistItem',
      'checklist.assignedUserId': 'adminUser',
    },
    body: {
      title: 'Fake renamed task',
      checklist: [{ id: PLACEHOLDER, label: 'Fake step', assignedUserId: PLACEHOLDER }],
    },
  },
  [`GET ${BASE}/tasks/:id`]: { params: { id: 'task' } },
  [`POST ${BASE}/tasks/:id/complete`]: { params: { id: 'taskComplete' } },
  [`POST ${BASE}/tasks/:id/reopen`]: { params: { id: 'taskReopen' } },
  [`POST ${BASE}/tasks/:id/cancel`]: { params: { id: 'taskCancel' } },
  [`POST ${BASE}/tasks/:id/progress`]: {
    params: { id: 'taskProgress' },
    body: { progress: 'WAITING' },
  },
  [`POST ${BASE}/tasks/:id/duplicate`]: { params: { id: 'task' } },
  [`POST ${BASE}/tasks/:id/archive`]: { params: { id: 'taskArchive' } },
  [`POST ${BASE}/tasks/:id/restore`]: { params: { id: 'taskRestore' } },
  [`PUT ${BASE}/tasks/:id/checklist/order`]: {
    params: { id: 'taskWithItem' },
    bodyIds: { ids: 'taskChecklistItem' },
  },
  [`POST ${BASE}/tasks/:id/checklist/:itemId/complete`]: {
    params: { id: 'taskWithItem', itemId: 'taskChecklistItem' },
  },
  [`POST ${BASE}/tasks/:id/checklist/:itemId/reopen`]: {
    params: { id: 'taskWithItem', itemId: 'taskChecklistItem' },
  },
  [`POST ${BASE}/tasks/:id/attachments`]: {
    params: { id: 'taskForAttach' },
    bodyIds: { documentId: 'document' },
  },
  [`PATCH ${BASE}/tasks/:id/attachments/:attachmentId`]: {
    params: { id: 'taskWithAttachment', attachmentId: 'taskAttachment' },
    body: { clientVisible: true },
  },
  [`DELETE ${BASE}/tasks/:id/attachments/:attachmentId`]: {
    params: { id: 'taskWithAttachmentDelete', attachmentId: 'taskAttachmentDelete' },
  },
  [`POST ${BASE}/tasks/bulk`]: {
    params: {},
    // REASSIGN holds both id fields the bulk body names.
    bodyIds: { ids: 'taskBulk', assignedUserId: 'adminUser' },
    body: { action: 'REASSIGN' },
  },
  [`PUT ${BASE}/task-types/:id`]: {
    params: { id: 'taskTypeEdit' },
    body: () => ({ name: `Fake renamed type ${tag()}` }),
  },
  [`POST ${BASE}/task-types/:id/archive`]: { params: { id: 'taskTypeEdit' } },
  [`POST ${BASE}/task-types/:id/restore`]: { params: { id: 'taskTypeEdit' } },
};
