import {
  CreateReportRequest,
  CreateTaskRequest,
  ListTasksQuery,
  ListWorkspacesQuery,
  MyReportsQuery,
  ReportsQuery,
  UpdateReportRequest,
  UpdateTaskRequest,
} from '@firmivra/types';
import type { z } from 'zod';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED instead
// of reaching the driver and answering 500 (the content review, R12):
// - a NUL character, or half of a UTF-16 surrogate pair ("\ud800" in JSON), in any string, report
//   lines included (the contract already refuses control characters in its text fields);
// - a due date in the year 0000, which the contract's date format allows and Postgres does not.

/** A lone surrogate: a whole pair is one astral code point in a `u` regex, never `Cs`. */
const LONE_SURROGATE = /\p{Cs}/u;

/** The paths of every string in `value` that has a NUL or a lone surrogate. */
export function badTextPaths(
  value: unknown,
  path: (string | number)[] = [],
): (string | number)[][] {
  if (typeof value === 'string') {
    return value.includes('\u0000') || LONE_SURROGATE.test(value) ? [path] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => badTextPaths(v, [...path, i]));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => badTextPaths(v, [...path, k]));
  }
  return [];
}

/** A calendar day Postgres can store: the contract's `YYYY-MM-DD`, from the year 0001. */
export const storableDay = (value: string) => !value.startsWith('0000');

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
    const dueOn = (value as { dueOn?: unknown } | null)?.dueOn;
    if (typeof dueOn === 'string' && !storableDay(dueOn)) {
      ctx.addIssue({ code: 'custom', path: ['dueOn'], message: 'Use a real date' });
    }
  });

/** GET /business/tasks */
export const TasksQuery = clean(ListTasksQuery);
/** POST /business/tasks */
export const CreateTaskBody = clean(CreateTaskRequest);
/** PATCH /business/tasks/{id} */
export const UpdateTaskBody = clean(UpdateTaskRequest);
/** GET /business/workspaces */
export const WorkspacesQuery = clean(ListWorkspacesQuery);
/** GET /business/workspaces/{engagementId}/reports */
export const ReportsListQuery = clean(ReportsQuery);
/** POST /business/workspaces/{engagementId}/reports */
export const CreateReportBody = clean(CreateReportRequest);
/** PATCH /business/reports/{id} */
export const UpdateReportBody = clean(UpdateReportRequest);
/** GET /portal/{firmSlug}/me/services/{engagementId}/reports */
export const MyReportsListQuery = clean(MyReportsQuery);
