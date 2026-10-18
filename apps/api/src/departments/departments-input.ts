import {
  CreateDepartmentRequest,
  CreateStaffTeamRequest,
  DepartmentListQuery,
  SetStaffTeamMembersRequest,
  StaffTeamListQuery,
  UpdateDepartmentRequest,
  UpdateStaffTeamRequest,
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

export const DepartmentListQ = clean(DepartmentListQuery);
export const CreateDepartmentBody = clean(CreateDepartmentRequest);
export const UpdateDepartmentBody = clean(UpdateDepartmentRequest);
export const TeamListQ = clean(StaffTeamListQuery);
export const CreateTeamBody = clean(CreateStaffTeamRequest);
export const UpdateTeamBody = clean(UpdateStaffTeamRequest);
export const SetTeamMembersBody = clean(SetStaffTeamMembersRequest);
