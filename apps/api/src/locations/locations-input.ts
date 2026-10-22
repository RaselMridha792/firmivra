import {
  ConfirmLocationPhotoUploadRequest,
  CreateLocationPhotoUploadRequest,
  CreateLocationRequest,
  DeactivateLocationRequest,
  DeactivateManagerRequest,
  LocationActionsQuery,
  LocationActivityQuery,
  LocationsQuery,
  ReassignManagerRequest,
  SetLocationStaffRequest,
  UpdateLocationActionRequest,
  UpdateLocationRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas (packages/types/src/settings/locations.ts), plus what Postgres cannot
// hold, refused as 400 VALIDATION_FAILED: a NUL character or half of a surrogate pair.

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const LocationsQ = clean(LocationsQuery);
export const CreateLocationBody = clean(CreateLocationRequest);
export const UpdateLocationBody = clean(UpdateLocationRequest);
export const DeactivateLocationBody = clean(DeactivateLocationRequest);
export const ReassignManagerBody = clean(ReassignManagerRequest);
export const DeactivateManagerBody = clean(DeactivateManagerRequest);
export const SetLocationStaffBody = clean(SetLocationStaffRequest);
export const LocationActionsQ = clean(LocationActionsQuery);
export const UpdateLocationActionBody = clean(UpdateLocationActionRequest);
export const LocationActivityQ = clean(LocationActivityQuery);
export const LocationPhotoUploadBody = clean(CreateLocationPhotoUploadRequest);
export const ConfirmLocationPhotoBody = clean(ConfirmLocationPhotoUploadRequest);

export type Out<S extends z.ZodType> = z.output<S>;
