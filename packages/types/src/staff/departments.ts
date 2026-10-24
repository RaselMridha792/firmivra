import { z } from 'zod';
import { SearchText, clearable, text } from '../clients/text.js';
import { StaffGroupStatus, TeamMemberKind } from '../schemas.js';
import { NamedRef, StaffRef } from './schemas.js';

// Teams & Departments (R42 contract): departments, the teams inside them, their members and the
// org chart. Tables: departments, teams, team_members, member_departments (R35). Owner and Admin
// change; Manager reads (grid STAFF_MANAGEMENT view). Nothing is deleted: INACTIVE or ARCHIVED
// instead; deactivating a group that active staff are in is 409 GROUP_IN_USE unless `moveTo`.

const DateTime = z.iso.datetime({ offset: true });

export const DepartmentId = z.uuid();
export const StaffTeamId = z.uuid();

/** The tab's filter: "All Statuses". */
export const GroupStatusFilter = z.enum(['all', 'active', 'inactive', 'archived']);
export type GroupStatusFilter = z.infer<typeof GroupStatusFilter>;

/** One Department List row. */
export const Department = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  head: StaffRef.nullable(),
  teamCount: z.number().int(),
  staffCount: z.number().int(),
  status: StaffGroupStatus,
  createdAt: DateTime,
});
export type Department = z.infer<typeof Department>;

/** GET /business/departments: search by name; numbered pages ("Showing 1 - 8 of 8"). */
export const DepartmentListQuery = z.strictObject({
  search: SearchText.optional(),
  status: GroupStatusFilter.optional().default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type DepartmentListQuery = z.input<typeof DepartmentListQuery>;

export const DepartmentListResponse = z.object({
  items: z.array(Department).max(100),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type DepartmentListResponse = z.infer<typeof DepartmentListResponse>;

/** GET /business/departments/summary: Total Departments, Total Teams, Total Staff, Active Staff. */
export const DepartmentSummary = z.object({
  departments: z.number().int(),
  teams: z.number().int(),
  staff: z.number().int(),
  activeStaff: z.number().int(),
});
export type DepartmentSummary = z.infer<typeof DepartmentSummary>;

/** One team row (Teams tab, "Teams in This Department"). */
export const StaffTeam = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  department: NamedRef,
  lead: StaffRef.nullable(),
  memberCount: z.number().int(),
  status: StaffGroupStatus,
  createdAt: DateTime,
});
export type StaffTeam = z.infer<typeof StaffTeam>;

/** GET /business/departments/{id}: the Department Details panel. */
export const DepartmentDetail = Department.extend({ teams: z.array(StaffTeam) });
export type DepartmentDetail = z.infer<typeof DepartmentDetail>;

export const CreateDepartmentRequest = z.strictObject({
  name: text(80),
  description: clearable(text(500, 'many')),
  headMembershipId: z.uuid().nullable().optional(),
});
export type CreateDepartmentRequest = z.input<typeof CreateDepartmentRequest>;

/**
 * PATCH /business/departments/{id}: Edit, Change Head, Deactivate / Reactivate, Archive.
 * `moveTo` moves the department's people to another active department first.
 */
export const UpdateDepartmentRequest = z
  .strictObject({
    name: text(80).optional(),
    description: clearable(text(500, 'many')),
    headMembershipId: z.uuid().nullable().optional(),
    status: StaffGroupStatus.optional(),
    moveTo: DepartmentId.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateDepartmentRequest = z.input<typeof UpdateDepartmentRequest>;

/** GET /business/teams. */
export const StaffTeamListQuery = z.strictObject({
  search: SearchText.optional(),
  departmentId: DepartmentId.optional(),
  status: GroupStatusFilter.optional().default('all'),
});
export type StaffTeamListQuery = z.input<typeof StaffTeamListQuery>;

export const StaffTeamList = z.object({ items: z.array(StaffTeam) });
export type StaffTeamList = z.infer<typeof StaffTeamList>;

export const StaffTeamMember = StaffRef.extend({ kind: TeamMemberKind });
export type StaffTeamMember = z.infer<typeof StaffTeamMember>;

/** GET /business/teams/{id}: Manage Members. */
export const StaffTeamDetail = StaffTeam.extend({ members: z.array(StaffTeamMember) });
export type StaffTeamDetail = z.infer<typeof StaffTeamDetail>;

export const CreateStaffTeamRequest = z.strictObject({
  departmentId: DepartmentId,
  name: text(80),
  description: clearable(text(500, 'many')),
  leadMembershipId: z.uuid().nullable().optional(),
});
export type CreateStaffTeamRequest = z.input<typeof CreateStaffTeamRequest>;

/** PATCH /business/teams/{id}: Edit, Change Lead, Move Department, Deactivate / Archive. */
export const UpdateStaffTeamRequest = z
  .strictObject({
    name: text(80).optional(),
    description: clearable(text(500, 'many')),
    leadMembershipId: z.uuid().nullable().optional(),
    departmentId: DepartmentId.optional(),
    status: StaffGroupStatus.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateStaffTeamRequest = z.input<typeof UpdateStaffTeamRequest>;

/** PUT /business/teams/{id}/members: the whole member list (a member's one primary, one backup). */
export const SetStaffTeamMembersRequest = z.strictObject({
  members: z
    .array(z.strictObject({ membershipId: z.uuid(), kind: TeamMemberKind }))
    .max(500)
    .refine(
      (list) => new Set(list.map((m) => m.membershipId)).size === list.length,
      'Add each person once',
    ),
});
export type SetStaffTeamMembersRequest = z.input<typeof SetStaffTeamMembersRequest>;

/**
 * GET /business/departments/{id}/members: Manage Members on a department (Octavia's SM13): the
 * staff assigned straight to it (member_departments), whatever their teams. Deactivated staff are
 * not listed and keep their assignments.
 */
export const DepartmentMembers = z.object({ members: z.array(StaffRef) });
export type DepartmentMembers = z.infer<typeof DepartmentMembers>;

/**
 * PUT /business/departments/{id}/members: the department's whole list, with no team needed. Only
 * an active department; each person an active, invited or locked member. Taking someone out of
 * their only department is 409 LAST_DEPARTMENT (staff keep at least one, as Create Staff asks).
 */
export const SetDepartmentMembersRequest = z.strictObject({
  membershipIds: z
    .array(z.uuid())
    .max(500)
    .refine((list) => new Set(list).size === list.length, 'Add each person once'),
});
export type SetDepartmentMembersRequest = z.input<typeof SetDepartmentMembersRequest>;

/** One person in the org chart; `supervisorId` (a membership id) draws the line up. */
export const OrgChartNode = StaffRef.extend({
  supervisorId: z.uuid().nullable(),
  departments: z.array(NamedRef),
  /** Departments this person heads. */
  heads: z.array(NamedRef),
});
export type OrgChartNode = z.infer<typeof OrgChartNode>;

/** GET /business/org-chart: active members and their reporting lines. */
export const OrgChart = z.object({ nodes: z.array(OrgChartNode) });
export type OrgChart = z.infer<typeof OrgChart>;

export const DepartmentErrorCode = z.enum([
  /** 409: a name already used by a department or team at this firm that is not archived. */
  'DUPLICATE_NAME',
  /** 409: active staff or workflows use the group; send `moveTo` or move them first. */
  'GROUP_IN_USE',
  /** 409: the head or lead is not an active member. */
  'MEMBER_NOT_ACTIVE',
]);
export type DepartmentErrorCode = z.infer<typeof DepartmentErrorCode>;
