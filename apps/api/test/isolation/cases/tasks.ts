// Tasks on an engagement, and the Tasks module (R55): detail, actions, checklist, attachments,
// bulk actions, task types and drafts (R1). Each route that changes a task gets a record of its
// own, so one case never breaks the next (a completed task cannot take a stage, an archived one
// no edit, a published draft is no longer one).
import { randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef, SeedContext } from '../world.js';

const tag = () => randomUUID().slice(0, 8);
/** A fixed update time, so a PATCH case can send the version without reading it. */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const VERSION = STAMP.toISOString();
const DAY = new Date('2099-01-15T00:00:00.000Z');

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

/** A draft of client X, saved by the firm's Owner (who sees every draft with a client). */
const draft = (): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, owner, get }) {
    const row = await tx.task.create({
      data: {
        businessId,
        clientId: await get('client'),
        status: 'DRAFT',
        createdByUserId: owner.id,
        title: 'Fake draft',
      },
    });
    return row.id;
  },
});

/** The one checklist step of the draft `of`. */
const draftStep = (of: string): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, get }) {
    const row = await tx.taskChecklistItem.create({
      data: { businessId, taskId: await get(of), label: 'Fake draft step', position: 0 },
    });
    return row.id;
  },
});

/** A recurring series for client X (its first date far ahead; the job is off in tests). */
const series = (extra: Record<string, unknown> = {}): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, get }) {
    const row = await tx.taskSeries.create({
      data: {
        businessId,
        clientId: await get('client'),
        title: 'Fake series',
        unit: 'MONTH',
        startOn: DAY,
        ...extra,
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
  taskTemplatePatch: {
    async create({ tx, businessId }) {
      return (
        await tx.taskTemplate.create({
          data: { businessId, name: `Fake template ${tag()}`, updatedAt: STAMP },
        })
      ).id;
    },
  },
  taskTemplateArchive: {
    async create({ tx, businessId }) {
      return (
        await tx.taskTemplate.create({ data: { businessId, name: `Fake template ${tag()}` } })
      ).id;
    },
  },
  /** A task with a due date, for "make it recurring". */
  taskConvert: task(() => ({ dueOn: DAY })),
  taskSeries: series(),
  taskSeriesPatch: series({ updatedAt: STAMP }),
  taskSeriesPause: series(),
  taskSeriesPaused: series({ status: 'PAUSED', pausedAt: new Date() }),
  taskSeriesStop: series(),
  taskSeriesSkipFuture: series(),
  taskSeriesSkip: series(),
  taskOccurrence: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taskOccurrence.create({
        data: { businessId, seriesId: await get('taskSeriesSkip'), scheduledOn: DAY, dueOn: DAY },
      });
      return row.id;
    },
  },
  // Drafts: one to read, and one each to edit, publish and discard (with a step to keep).
  taskDraft: draft(),
  taskDraftPatch: draft(),
  taskDraftPatchStep: draftStep('taskDraftPatch'),
  taskDraftPublish: draft(),
  taskDraftPublishStep: draftStep('taskDraftPublish'),
  taskDraftDiscard: draft(),
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
/** The ids a draft's change (PATCH, publish) can name; `step` is a checklist step of the draft. */
const draftChangeIds = (step: string) => ({
  clientId: 'client',
  engagementId: 'engagement',
  assignedUserId: 'adminUser',
  typeId: 'taskType',
  serviceId: 'service',
  dependsOnTaskId: 'task',
  additionalAssigneeIds: 'adminUser',
  'checklist.id': step,
  'checklist.assignedUserId': 'adminUser',
  'attachments.documentId': 'document',
});
const draftChange = {
  title: 'Fake renamed draft',
  checklist: [{ id: PLACEHOLDER, label: 'Fake draft step', assignedUserId: PLACEHOLDER }],
  attachments: [{ documentId: PLACEHOLDER }],
};

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
  // ---------- Drafts ----------
  [`POST ${BASE}/tasks/drafts`]: {
    params: {},
    bodyIds: NEW_TASK_IDS,
    body: {
      title: 'Fake draft',
      checklist: [{ label: 'Fake step', assignedUserId: PLACEHOLDER }],
      attachments: [{ documentId: PLACEHOLDER }],
    },
  },
  [`GET ${BASE}/tasks/drafts/:id`]: { params: { id: 'taskDraft' } },
  [`PATCH ${BASE}/tasks/drafts/:id`]: {
    params: { id: 'taskDraftPatch' },
    bodyIds: draftChangeIds('taskDraftPatchStep'),
    body: draftChange,
  },
  // Published with every field the body names: a new task's checks pass with the firm's own.
  [`POST ${BASE}/tasks/drafts/:id/publish`]: {
    params: { id: 'taskDraftPublish' },
    bodyIds: draftChangeIds('taskDraftPublishStep'),
    body: draftChange,
  },
  [`DELETE ${BASE}/tasks/drafts/:id`]: { params: { id: 'taskDraftDiscard' } },
  [`PUT ${BASE}/task-types/:id`]: {
    params: { id: 'taskTypeEdit' },
    body: () => ({ name: `Fake renamed type ${tag()}` }),
  },
  [`POST ${BASE}/task-types/:id/archive`]: { params: { id: 'taskTypeEdit' } },
  [`POST ${BASE}/task-types/:id/restore`]: { params: { id: 'taskTypeEdit' } },

  // ---------- Templates and recurring series ----------
  [`GET ${BASE}/task-templates/:id`]: { params: { id: 'taskTemplate' } },
  [`POST ${BASE}/task-templates`]: {
    params: {},
    body: () => ({ name: `Fake new template ${tag()}`, assignmentRule: 'SPECIFIC_USER' }),
    bodyIds: { typeId: 'taskType', serviceId: 'service', assignedUserId: 'adminUser' },
  },
  [`PATCH ${BASE}/task-templates/:id`]: {
    params: { id: 'taskTemplatePatch' },
    body: { version: VERSION, assignmentRule: 'SPECIFIC_USER' },
    bodyIds: { typeId: 'taskType', serviceId: 'service', assignedUserId: 'adminUser' },
  },
  [`POST ${BASE}/task-templates/:id/duplicate`]: { params: { id: 'taskTemplate' } },
  [`POST ${BASE}/task-templates/:id/archive`]: { params: { id: 'taskTemplateArchive' } },
  [`POST ${BASE}/task-templates/:id/restore`]: { params: { id: 'taskTemplateArchive' } },
  [`POST ${BASE}/tasks/:id/save-as-template`]: {
    params: { id: 'task' },
    body: () => ({ name: `Fake saved template ${tag()}` }),
  },
  [`POST ${BASE}/tasks/:id/convert-to-recurring`]: {
    params: { id: 'taskConvert' },
    body: { recurrence: { unit: 'MONTH' } },
  },
  [`GET ${BASE}/task-series/:id`]: { params: { id: 'taskSeries' } },
  [`GET ${BASE}/task-series/:id/occurrences`]: { params: { id: 'taskSeries' } },
  [`POST ${BASE}/task-series`]: {
    params: {},
    body: () => ({
      title: `Fake new series ${tag()}`,
      assignmentRule: 'SPECIFIC_USER',
      recurrence: { unit: 'MONTH', startOn: '2099-01-15' },
    }),
    bodyIds: {
      clientId: 'client',
      engagementId: 'engagement',
      serviceId: 'service',
      typeId: 'taskType',
      assignedUserId: 'adminUser',
      extraAssigneeIds: 'adminUser',
      templateId: 'taskTemplate',
    },
  },
  [`PATCH ${BASE}/task-series/:id`]: {
    params: { id: 'taskSeriesPatch' },
    body: { scope: 'FUTURE', version: VERSION, assignmentRule: 'SPECIFIC_USER' },
    bodyIds: {
      engagementId: 'engagement',
      serviceId: 'service',
      typeId: 'taskType',
      assignedUserId: 'adminUser',
      extraAssigneeIds: 'adminUser',
    },
  },
  [`POST ${BASE}/task-series/:id/pause`]: { params: { id: 'taskSeriesPause' } },
  [`POST ${BASE}/task-series/:id/resume`]: { params: { id: 'taskSeriesPaused' } },
  [`POST ${BASE}/task-series/:id/stop`]: { params: { id: 'taskSeriesStop' } },
  [`POST ${BASE}/task-series/:id/skip-future`]: {
    params: { id: 'taskSeriesSkipFuture' },
    body: { confirm: true },
  },
  [`POST ${BASE}/task-series/:id/occurrences/:occurrenceId/skip`]: {
    params: { id: 'taskSeriesSkip', occurrenceId: 'taskOccurrence' },
    body: {},
  },
};
