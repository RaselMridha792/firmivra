import { MembershipRole, SaveRolePermissionsRequest } from '@firmivra/types';
import { badTextPaths } from '../workspaces/input.js';

export const RoleParam = MembershipRole;
export const SaveRoleBody = SaveRolePermissionsRequest.superRefine((value, ctx) => {
  for (const path of badTextPaths(value)) {
    ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
  }
});
