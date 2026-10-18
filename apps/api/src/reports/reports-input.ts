import {
  CreateReportScheduleRequest as CreateScheduleContract,
  DuplicateSavedReportRequest as DuplicateContract,
  ExportReportRequest as ExportContract,
  RecentReportsQuery as RecentContract,
  ReportLookupQuery as LookupContract,
  ReportSchedulesQuery as SchedulesContract,
  ReportsDashboardQuery as DashboardContract,
  RunReportRequest as RunContract,
  SaveReportRequest as SaveContract,
  SaveReportSettingsRequest as SettingsContract,
  SavedReportsQuery as SavedContract,
  UpdateReportScheduleRequest as UpdateScheduleContract,
  UpdateSavedReportRequest as UpdateSavedContract,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED instead
// of reaching the driver and answering 500: a NUL character or half of a surrogate pair in any
// string (a filter value included).

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const RunBody = clean(RunContract);
export const DashboardQuery = clean(DashboardContract).refine(
  (q) => (q.from === undefined) === (q.to === undefined),
  'Send both dates of a custom range',
);
export const LookupQuery = clean(LookupContract);
export const RecentQuery = clean(RecentContract);
export const SettingsBody = clean(SettingsContract);
export const SavedQuery = clean(SavedContract);
export const SaveBody = clean(SaveContract);
export const UpdateSavedBody = clean(UpdateSavedContract);
export const DuplicateBody = clean(DuplicateContract);
export const ExportBody = clean(ExportContract);
export const SchedulesQuery = clean(SchedulesContract);
export const CreateScheduleBody = clean(CreateScheduleContract);
export const UpdateScheduleBody = clean(UpdateScheduleContract);
