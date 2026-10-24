import {
  BulkTaskRequest as BulkContract,
  ConvertToRecurringRequest as ConvertContract,
  CreateTaskDetailRequest as CreateContract,
  CreateTaskSeriesRequest as CreateSeriesContract,
  CreateTaskTemplateRequest as CreateTemplateContract,
  PublishTaskDraftRequest as PublishDraftContract,
  SaveTaskAsTemplateRequest as SaveAsTemplateContract,
  SaveTaskDraftRequest as SaveDraftContract,
  SaveTaskTypeRequest as TypeContract,
  SeriesPreviewRequest as PreviewContract,
  SkipFutureRequest as SkipFutureContract,
  SkipOccurrenceRequest as SkipContract,
  TaskCalendarQuery as CalendarContract,
  TaskDraftQuery as DraftQueryContract,
  TaskOccurrencesQuery as OccurrencesContract,
  TaskOverviewQuery as OverviewContract,
  TaskSeriesQuery as SeriesQueryContract,
  TaskTemplatesQuery as TemplatesQueryContract,
  UpdateTaskDetailRequest as UpdateContract,
  UpdateTaskDraftRequest as UpdateDraftContract,
  UpdateTaskSeriesRequest as UpdateSeriesContract,
  UpdateTaskTemplateRequest as UpdateTemplateContract,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths, storableDay } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED instead
// of reaching the driver and answering 500 (as workspaces/input.ts does for the older routes): a
// NUL character or half of a surrogate pair in any string, and a date in the year 0000.

/** The names of the body or query fields that hold a calendar day. */
const DAY_FIELDS = new Set(['dueOn', 'startOn', 'dueFrom', 'dueTo', 'from', 'to', 'endOn']);

function days(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => days(v, [...path, i]));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => days(v, [...path, k]));
  }
  const key = path.at(-1);
  return typeof value === 'string' &&
    typeof key === 'string' &&
    DAY_FIELDS.has(key) &&
    !storableDay(value)
    ? [path]
    : [];
}

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
    for (const path of days(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Use a real date' });
    }
  });

/** POST /business/tasks */
export const CreateTaskDetailRequest = clean(CreateContract);
/** PATCH /business/tasks/{id} */
export const UpdateTaskDetailRequest = clean(UpdateContract);
/** GET /business/tasks/overview */
export const TaskOverviewQuery = clean(OverviewContract);
/** GET /business/tasks/calendar */
export const TaskCalendarQuery = clean(CalendarContract);
/** POST /business/tasks/bulk */
export const BulkTaskRequest = clean(BulkContract);
/** POST and PUT /business/task-types */
export const SaveTaskTypeRequest = clean(TypeContract);
/** GET /business/task-templates */
export const TaskTemplatesQuery = clean(TemplatesQueryContract);
/** POST /business/task-templates */
export const CreateTaskTemplateRequest = clean(CreateTemplateContract);
/** PATCH /business/task-templates/{id} */
export const UpdateTaskTemplateRequest = clean(UpdateTemplateContract);
/** POST /business/tasks/{id}/save-as-template */
export const SaveTaskAsTemplateRequest = clean(SaveAsTemplateContract);
/** GET /business/task-series */
export const TaskSeriesQuery = clean(SeriesQueryContract);
/** POST /business/task-series/preview */
export const SeriesPreviewRequest = clean(PreviewContract);
/** POST /business/task-series */
export const CreateTaskSeriesRequest = clean(CreateSeriesContract);
/** PATCH /business/task-series/{id} */
export const UpdateTaskSeriesRequest = clean(UpdateSeriesContract);
/** GET /business/task-series/{id}/occurrences */
export const TaskOccurrencesQuery = clean(OccurrencesContract);
/** POST /business/task-series/{id}/occurrences/{occurrenceId}/skip */
export const SkipOccurrenceRequest = clean(SkipContract);
/** POST /business/task-series/{id}/skip-future */
export const SkipFutureRequest = clean(SkipFutureContract);
/** POST /business/tasks/{id}/convert-to-recurring */
export const ConvertToRecurringRequest = clean(ConvertContract);
/** GET /business/tasks/drafts */
export const TaskDraftQuery = clean(DraftQueryContract);
/** POST /business/tasks/drafts */
export const SaveTaskDraftRequest = clean(SaveDraftContract);
/** PATCH /business/tasks/drafts/{id} */
export const UpdateTaskDraftRequest = clean(UpdateDraftContract);
/** POST /business/tasks/drafts/{id}/publish */
export const PublishTaskDraftRequest = clean(PublishDraftContract);
