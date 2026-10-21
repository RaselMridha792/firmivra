import {
  ConfirmStaffDocumentUploadRequest,
  CreateStaffDocumentUploadRequest,
  CreateStaffRequest,
  LockStaffRequest,
  SaveStaffDraftRequest,
  SetStaffNoteRequest,
  SetStaffOverridesRequest,
  SetStaffPermissionsRequest,
  StaffAccessInput,
  StaffCompensationInput,
  StaffCursorQuery,
  StaffDocumentId,
  StaffDraftId,
  StaffId,
  StaffImportPreviewRequest,
  StaffImportRequest,
  StaffListQuery,
  StaffSecurityActionRequest,
  StaffSessionId,
  UpdateStaffDocumentRequest,
  UpdateStaffRequest,
  UsersQuery,
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

export const StaffIdParam = StaffId;
export const StaffListQ = clean(StaffListQuery);
export const UsersQ = clean(UsersQuery);
export const StaffDraftIdParam = StaffDraftId;
export const CreateStaffBody = clean(CreateStaffRequest);
export const UpdateStaffBody = clean(UpdateStaffRequest);
export const LockStaffBody = clean(LockStaffRequest);
export const StaffActionBody = clean(StaffSecurityActionRequest);
export const SetStaffNoteBody = clean(SetStaffNoteRequest);
export const StaffCompensationBody = clean(StaffCompensationInput);
export const SaveStaffDraftBody = clean(SaveStaffDraftRequest);
export const SetStaffPermissionsBody = clean(SetStaffPermissionsRequest);
export const SetStaffOverridesBody = clean(SetStaffOverridesRequest);
export const StaffSessionIdParam = StaffSessionId;
export const StaffAccessBody = clean(StaffAccessInput);
export const StaffCursorQ = clean(StaffCursorQuery);
export const StaffDocumentIdParam = StaffDocumentId;
export const CreateStaffDocumentUploadBody = clean(CreateStaffDocumentUploadRequest);
export const ConfirmStaffDocumentUploadBody = clean(ConfirmStaffDocumentUploadRequest);
export const UpdateStaffDocumentBody = clean(UpdateStaffDocumentRequest);
export const StaffImportPreviewBody = clean(StaffImportPreviewRequest);
export const StaffImportBody = clean(StaffImportRequest);
