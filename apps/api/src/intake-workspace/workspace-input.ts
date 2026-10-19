import {
  AddFormNoteRequest,
  AssignedFormId,
  AssignedFormsQuery,
  IntakeFormId,
  IntakeFormsQuery,
  ResetIntakeSettingsRequest,
  SaveIntakeFormRequest,
  SaveSendDraftRequest,
  SendIntakeFormRequest,
  UpdateAssignedFormRequest,
  UpdateIntakeSettingsRequest,
} from '@firmivra/types';
import { z } from 'zod';
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
export const AssignedFormIdParam = AssignedFormId;
export const DraftIdParam = z.uuid();
export const AssignedFormsQ = clean(AssignedFormsQuery);
export const FormsQ = clean(IntakeFormsQuery);
export const UpdateSettingsBody = clean(UpdateIntakeSettingsRequest);
export const ResetSettingsBody = clean(ResetIntakeSettingsRequest);
export const SendBody = clean(SendIntakeFormRequest);
export const SendDraftBody = clean(SaveSendDraftRequest);
export const NoteBody = clean(AddFormNoteRequest);
export const UpdateAssignedBody = clean(UpdateAssignedFormRequest);
export const SaveFormBody = clean(SaveIntakeFormRequest);
/** Saving a form that exists: a starting point is for new forms only. */
export const SaveExistingFormBody = clean(SaveIntakeFormRequest.omit({ startFrom: true }));
export const DuplicateFormBody = z.strictObject({ asTemplate: z.boolean().default(false) });
