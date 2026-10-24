import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import {
  AddTaskAttachmentRequest,
  BulkTaskRequest,
  BulkTaskResult,
  ChecklistItemId,
  ConvertToRecurringRequest,
  CreateTaskDetailRequest,
  CreateTaskSeriesRequest,
  CreateTaskTemplateRequest,
  DuplicateTaskRequest,
  ReorderChecklistRequest,
  SaveTaskAsTemplateRequest,
  SaveTaskTypeRequest,
  SeriesPreview,
  SeriesPreviewRequest,
  SetTaskProgressRequest,
  SkipFutureRequest,
  SkipOccurrenceRequest,
  TaskAttachment,
  TaskAttachmentId,
  TaskCalendar,
  TaskCalendarQuery,
  TaskDetail,
  TaskOccurrence,
  TaskOccurrenceId,
  TaskOccurrencePage,
  TaskOccurrencesQuery,
  TaskOverviewPage,
  TaskOverviewQuery,
  TaskSeriesDetail,
  TaskSeriesId,
  TaskSeriesPage,
  TaskSeriesQuery,
  TaskSummary,
  TaskTemplate,
  TaskTemplateId,
  TaskTemplateList,
  TaskTemplatesQuery,
  TaskType,
  TaskTypeId,
  TaskTypeList,
  UpdateTaskAttachmentRequest,
  UpdateTaskDetailRequest,
  UpdateTaskSeriesRequest,
  UpdateTaskTemplateRequest,
} from './work.js';
import {
  PublishTaskDraftRequest,
  SaveTaskDraftRequest,
  TaskDraft,
  TaskDraftId,
  TaskDraftPage,
  TaskDraftQuery,
  UpdateTaskDraftRequest,
} from './drafts.js';
import { TaskId } from './schemas.js';

const TASKS = '/business/tasks';
const task = (id: string) => `${TASKS}/${parseInput(TaskId, id)}`;
const DRAFTS = `${TASKS}/drafts`;
const draft = (id: string) => `${DRAFTS}/${parseInput(TaskDraftId, id)}`;
const type = (id: string) => `/business/task-types/${parseInput(TaskTypeId, id)}`;
const template = (id: string) => `/business/task-templates/${parseInput(TaskTemplateId, id)}`;
const series = (id: string) => `/business/task-series/${parseInput(TaskSeriesId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.taskWork` (apps/web/src/lib/api.ts): the Tasks module's screens (contract in ./work.ts).
 * Everyone with the permission grid's TASKS view reads; changes need Create, Edit or Manage
 * (403 FORBIDDEN), and Staff reach only their assigned clients' tasks (404 otherwise). Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. No business id
 * is ever sent. Error codes: TaskErrorCode (./schemas.ts) and TaskWorkErrorCode (./work.ts).
 * Create, Save as Draft, Duplicate, Set Up Recurring and Convert are retry-safe with
 * `idempotencyKey` (./work.ts IdempotencyKey): one new key per save, reused only to retry it.
 */
export function createTaskWorkClient(request: ApiRequest) {
  return {
    // ----- Overview -----
    summary: async (): Promise<TaskSummary> => request(TaskSummary, `${TASKS}/summary`),
    overview: async (query: TaskOverviewQuery = {}): Promise<TaskOverviewPage> =>
      request(
        TaskOverviewPage,
        `${TASKS}/overview${toQuery(parseInput(TaskOverviewQuery, query))}`,
      ),
    calendar: async (query: TaskCalendarQuery): Promise<TaskCalendar> =>
      request(TaskCalendar, `${TASKS}/calendar${toQuery(parseInput(TaskCalendarQuery, query))}`),

    // ----- One task -----
    task: async (id: string): Promise<TaskDetail> => request(TaskDetail, task(id)),
    create: async (body: CreateTaskDetailRequest): Promise<TaskDetail> =>
      request(TaskDetail, TASKS, post(parseInput(CreateTaskDetailRequest, body))),
    update: async (id: string, body: UpdateTaskDetailRequest): Promise<TaskDetail> =>
      request(TaskDetail, task(id), {
        method: 'PATCH',
        body: parseInput(UpdateTaskDetailRequest, body),
      }),
    /** 409 REQUIRED_ITEMS_OPEN or DEPENDENCY_OPEN. */
    complete: async (id: string): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/complete`, post()),
    reopen: async (id: string): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/reopen`, post()),
    cancel: async (id: string): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/cancel`, post()),
    setProgress: async (id: string, body: SetTaskProgressRequest): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/progress`, post(parseInput(SetTaskProgressRequest, body))),
    /**
     * A new OPEN copy with its checklist and reminders (not the attachments or history). With
     * `idempotencyKey`, a retry returns the first copy.
     */
    duplicate: async (id: string, body: DuplicateTaskRequest = {}): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/duplicate`, post(parseInput(DuplicateTaskRequest, body))),
    archive: async (id: string): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/archive`, post()),
    restore: async (id: string): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/restore`, post()),
    bulk: async (body: BulkTaskRequest): Promise<BulkTaskResult> =>
      request(BulkTaskResult, `${TASKS}/bulk`, post(parseInput(BulkTaskRequest, body))),

    // ----- Checklist -----
    completeItem: async (id: string, itemId: string): Promise<TaskDetail> =>
      request(
        TaskDetail,
        `${task(id)}/checklist/${parseInput(ChecklistItemId, itemId)}/complete`,
        post(),
      ),
    reopenItem: async (id: string, itemId: string): Promise<TaskDetail> =>
      request(
        TaskDetail,
        `${task(id)}/checklist/${parseInput(ChecklistItemId, itemId)}/reopen`,
        post(),
      ),
    reorderChecklist: async (id: string, body: ReorderChecklistRequest): Promise<TaskDetail> =>
      request(TaskDetail, `${task(id)}/checklist/order`, {
        method: 'PUT',
        body: parseInput(ReorderChecklistRequest, body),
      }),

    // ----- Attachments -----
    /** 409 ATTACHMENT_NOT_ALLOWED. */
    addAttachment: async (id: string, body: AddTaskAttachmentRequest): Promise<TaskAttachment> =>
      request(
        TaskAttachment,
        `${task(id)}/attachments`,
        post(parseInput(AddTaskAttachmentRequest, body)),
      ),
    updateAttachment: async (
      id: string,
      attachmentId: string,
      body: UpdateTaskAttachmentRequest,
    ): Promise<TaskAttachment> =>
      request(
        TaskAttachment,
        `${task(id)}/attachments/${parseInput(TaskAttachmentId, attachmentId)}`,
        { method: 'PATCH', body: parseInput(UpdateTaskAttachmentRequest, body) },
      ),
    removeAttachment: async (id: string, attachmentId: string): Promise<OkResponse> =>
      request(OkResponse, `${task(id)}/attachments/${parseInput(TaskAttachmentId, attachmentId)}`, {
        method: 'DELETE',
      }),

    // ----- Drafts (./drafts.ts) -----
    drafts: async (query: TaskDraftQuery = {}): Promise<TaskDraftPage> =>
      request(TaskDraftPage, `${DRAFTS}${toQuery(parseInput(TaskDraftQuery, query))}`),
    draft: async (id: string): Promise<TaskDraft> => request(TaskDraft, draft(id)),
    /** Save as Draft: only the title is required. */
    saveDraft: async (body: SaveTaskDraftRequest): Promise<TaskDraft> =>
      request(TaskDraft, DRAFTS, post(parseInput(SaveTaskDraftRequest, body))),
    updateDraft: async (id: string, body: UpdateTaskDraftRequest): Promise<TaskDraft> =>
      request(TaskDraft, draft(id), {
        method: 'PATCH',
        body: parseInput(UpdateTaskDraftRequest, body),
      }),
    /** Save Task on a draft: the same id becomes an OPEN task. 400 naming `clientId` without one. */
    publishDraft: async (id: string, body: PublishTaskDraftRequest = {}): Promise<TaskDetail> =>
      request(TaskDetail, `${draft(id)}/publish`, post(parseInput(PublishTaskDraftRequest, body))),
    discardDraft: async (id: string): Promise<OkResponse> =>
      request(OkResponse, draft(id), { method: 'DELETE' }),

    // ----- Task types -----
    types: async (): Promise<TaskType[]> =>
      (await request(TaskTypeList, '/business/task-types')).items,
    createType: async (body: SaveTaskTypeRequest): Promise<TaskType> =>
      request(TaskType, '/business/task-types', post(parseInput(SaveTaskTypeRequest, body))),
    updateType: async (id: string, body: SaveTaskTypeRequest): Promise<TaskType> =>
      request(TaskType, type(id), { method: 'PUT', body: parseInput(SaveTaskTypeRequest, body) }),
    archiveType: async (id: string): Promise<TaskType> =>
      request(TaskType, `${type(id)}/archive`, post()),
    restoreType: async (id: string): Promise<TaskType> =>
      request(TaskType, `${type(id)}/restore`, post()),

    // ----- Templates -----
    templates: async (query: TaskTemplatesQuery = {}): Promise<TaskTemplate[]> =>
      (
        await request(
          TaskTemplateList,
          `/business/task-templates${toQuery(parseInput(TaskTemplatesQuery, query))}`,
        )
      ).items,
    getTemplate: async (id: string): Promise<TaskTemplate> => request(TaskTemplate, template(id)),
    createTemplate: async (body: CreateTaskTemplateRequest): Promise<TaskTemplate> =>
      request(
        TaskTemplate,
        '/business/task-templates',
        post(parseInput(CreateTaskTemplateRequest, body)),
      ),
    updateTemplate: async (id: string, body: UpdateTaskTemplateRequest): Promise<TaskTemplate> =>
      request(TaskTemplate, template(id), {
        method: 'PATCH',
        body: parseInput(UpdateTaskTemplateRequest, body),
      }),
    duplicateTemplate: async (id: string): Promise<TaskTemplate> =>
      request(TaskTemplate, `${template(id)}/duplicate`, post()),
    archiveTemplate: async (id: string): Promise<TaskTemplate> =>
      request(TaskTemplate, `${template(id)}/archive`, post()),
    restoreTemplate: async (id: string): Promise<TaskTemplate> =>
      request(TaskTemplate, `${template(id)}/restore`, post()),
    /** "Save as Template" on a task. */
    saveAsTemplate: async (id: string, body: SaveTaskAsTemplateRequest): Promise<TaskTemplate> =>
      request(
        TaskTemplate,
        `${task(id)}/save-as-template`,
        post(parseInput(SaveTaskAsTemplateRequest, body)),
      ),

    // ----- Recurring series -----
    seriesList: async (query: TaskSeriesQuery = {}): Promise<TaskSeriesPage> =>
      request(
        TaskSeriesPage,
        `/business/task-series${toQuery(parseInput(TaskSeriesQuery, query))}`,
      ),
    series: async (id: string): Promise<TaskSeriesDetail> => request(TaskSeriesDetail, series(id)),
    /** The next due dates for unsaved settings. 400 INVALID_RECURRENCE. */
    previewSeries: async (body: SeriesPreviewRequest): Promise<SeriesPreview> =>
      request(
        SeriesPreview,
        '/business/task-series/preview',
        post(parseInput(SeriesPreviewRequest, body)),
      ),
    createSeries: async (body: CreateTaskSeriesRequest): Promise<TaskSeriesDetail> =>
      request(
        TaskSeriesDetail,
        '/business/task-series',
        post(parseInput(CreateTaskSeriesRequest, body)),
      ),
    updateSeries: async (id: string, body: UpdateTaskSeriesRequest): Promise<TaskSeriesDetail> =>
      request(TaskSeriesDetail, series(id), {
        method: 'PATCH',
        body: parseInput(UpdateTaskSeriesRequest, body),
      }),
    pauseSeries: async (id: string): Promise<TaskSeriesDetail> =>
      request(TaskSeriesDetail, `${series(id)}/pause`, post()),
    resumeSeries: async (id: string): Promise<TaskSeriesDetail> =>
      request(TaskSeriesDetail, `${series(id)}/resume`, post()),
    /** Stops future generation; the tasks already made stay. */
    stopSeries: async (id: string): Promise<TaskSeriesDetail> =>
      request(TaskSeriesDetail, `${series(id)}/stop`, post()),
    occurrences: async (
      id: string,
      query: TaskOccurrencesQuery = {},
    ): Promise<TaskOccurrencePage> =>
      request(
        TaskOccurrencePage,
        `${series(id)}/occurrences${toQuery(parseInput(TaskOccurrencesQuery, query))}`,
      ),
    /** 409 OCCURRENCE_CLOSED once made or skipped. */
    skipOccurrence: async (
      id: string,
      occurrenceId: string,
      body: SkipOccurrenceRequest = {},
    ): Promise<TaskOccurrence> =>
      request(
        TaskOccurrence,
        `${series(id)}/occurrences/${parseInput(TaskOccurrenceId, occurrenceId)}/skip`,
        post(parseInput(SkipOccurrenceRequest, body)),
      ),
    /** "Delete future occurrences": skips every one not made yet. Needs `confirm: true`. */
    skipFuture: async (id: string, body: SkipFutureRequest): Promise<TaskSeriesDetail> =>
      request(
        TaskSeriesDetail,
        `${series(id)}/skip-future`,
        post(parseInput(SkipFutureRequest, body)),
      ),
    /** The task becomes the first occurrence of a new series. */
    convertToRecurring: async (
      id: string,
      body: ConvertToRecurringRequest,
    ): Promise<TaskSeriesDetail> =>
      request(
        TaskSeriesDetail,
        `${task(id)}/convert-to-recurring`,
        post(parseInput(ConvertToRecurringRequest, body)),
      ),
  };
}
export type TaskWorkClient = ReturnType<typeof createTaskWorkClient>;
