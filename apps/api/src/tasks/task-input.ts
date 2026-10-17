import {
  BulkTaskRequest as BulkContract,
  CreateTaskDetailRequest as CreateContract,
  SaveTaskTypeRequest as TypeContract,
  TaskCalendarQuery as CalendarContract,
  TaskOverviewQuery as OverviewContract,
  UpdateTaskDetailRequest as UpdateContract,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths, storableDay } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED instead
// of reaching the driver and answering 500 (as workspaces/input.ts does for the older routes): a
// NUL character or half of a surrogate pair in any string, and a date in the year 0000.

/** The names of the body or query fields that hold a calendar day. */
const DAY_FIELDS = new Set(['dueOn', 'startOn', 'dueFrom', 'dueTo', 'from', 'to']);

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
