import {
  CreateCustomRoleRequest,
  MembershipRole,
  SaveRolePermissionsRequest,
  UpdateCustomRoleRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

/** Refuses hidden characters in any text the body carries. */
const clean = <S extends z.ZodType>(schema: S) =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const RoleParam = MembershipRole;
export const CustomRoleParam = z.uuid();
export const SaveRoleBody = clean(SaveRolePermissionsRequest);
export const CreateCustomRoleBody = clean(CreateCustomRoleRequest);
export const UpdateCustomRoleBody = clean(UpdateCustomRoleRequest);
