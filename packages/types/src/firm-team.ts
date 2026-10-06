import { z } from 'zod';

// Shared contract for docs/api/firm/team.yaml; policy validation also runs in the service.
export const FirmMember = z.strictObject({
  id: z.uuid(),
  user: z.strictObject({
    id: z.uuid(),
    name: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(200),
    email: z.email().min(1).max(254),
  }),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']),
  status: z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FirmMember = z.infer<typeof FirmMember>;

export const ListTeamMembersQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  status: z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']).optional(),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']).optional(),
});
export type ListTeamMembersQuery = z.infer<typeof ListTeamMembersQuery>;

export const ListTeamMembersResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmMember)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListTeamMembersResponse = z.infer<typeof ListTeamMembersResponse>;

export const ChangeTeamRoleRequest = z.strictObject({ role: z.enum(['OWNER', 'ADMIN', 'STAFF']) });
export type ChangeTeamRoleRequest = z.infer<typeof ChangeTeamRoleRequest>;

export const ChangeTeamRoleResponse = z.lazy(() => FirmMember);
export type ChangeTeamRoleResponse = z.infer<typeof ChangeTeamRoleResponse>;

export const DeactivateTeamMemberResponse = z.lazy(() => FirmMember);
export type DeactivateTeamMemberResponse = z.infer<typeof DeactivateTeamMemberResponse>;

export const ResendTeamInviteResponse = z.strictObject({ accepted: z.boolean() });
export type ResendTeamInviteResponse = z.infer<typeof ResendTeamInviteResponse>;
