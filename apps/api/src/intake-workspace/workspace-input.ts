import {
  AssignedFormsQuery,
  IntakeFormId,
  IntakeFormsQuery,
  ResetIntakeSettingsRequest,
  UpdateIntakeSettingsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED: a NUL
// character or half of a surrogate pair in any string.

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const FormIdParam = IntakeFormId;
export const AssignedFormsQ = clean(AssignedFormsQuery);
export const FormsQ = clean(IntakeFormsQuery);
export const UpdateSettingsBody = clean(UpdateIntakeSettingsRequest);
export const ResetSettingsBody = clean(ResetIntakeSettingsRequest);
