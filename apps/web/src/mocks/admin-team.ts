import { ApiRequestError } from '@firmivra/types';
import { MOCK_ROLE, mockDelay, mocked, mockedEmpty } from '../lib/mock';
import {
  ACCESS_SCOPES,
  type AccessLevel,
  accessLevelOf,
  type AccessScope,
  type AuthorityLevel,
  type Availability,
  AVAILABILITY,
  defaultScope,
  departmentById,
  MEMBER_STATUSES,
  type MemberStatus,
  type ModuleKey,
  type PermissionAction,
  roleById,
  roleTemplate,
  samePermissions,
  scopeRank,
  TEAM_DEPARTMENTS,
  TEAM_LOCATIONS,
  TEAM_MODULES,
  TEAM_ROLES,
  TEAM_UNITS,
  type TeamLocation,
  type TeamPermissions,
  type TeamRole,
  type TeamUnit,
} from './admin-team-catalog';

export * from './admin-team-catalog';

/**
 * Mock of the Super Admin Team module (S05, issue #757): Firmivra's own team, its hierarchy,
 * permissions, custom groups and team messages. There is no API or contract yet, so the types and
 * the client live here and the pages call `adminTeam.*` directly. Synthetic people only (invented
 * names, @example.test emails, 555-01xx numbers). One in-memory store behind every call, so a
 * member added on /team/new shows in the directory, its counts and the message recipients.
 *
 * Who is signed in: Morgan Admin (the console's mock Super Admin) is the CEO / Owner, level 1, and
 * sees and may do everything. NEXT_PUBLIC_API_MOCK_ROLE=ADMIN signs in as Marcus Webb, a Sales
 * Manager allowed to add people (only Sales, only Lead / Supervisor and lower, only access he has
 * himself); STAFF as Elena Ortiz, an Account Executive with no user administration. The rules are
 * the hierarchy docx's: no role, scope or permission above the actor's own; nobody changes a peer,
 * someone above them, or their own role, access or status; only the CEO adds Chief Officers; the
 * HR administrator adds below-C-suite people anywhere, and a VP / Director hire entered by HR waits
 * as Pending Approval. Every change writes an activity (audit) entry.
 * NEXT_PUBLIC_API_MOCK_EMPTY=adminTeam starts with no members, groups or messages.
 */

const MODULE = 'adminTeam';

/** No Super Admin team API yet: outside mock mode every call fails like an unreachable API. */
async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}
const empty = () => mockedEmpty(MODULE);

const uuid = (block: string, n: number) =>
  `0199d1a0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Team member not found');
const forbidden = (message = 'This action is not permitted') => fail(403, 'FORBIDDEN', message);

/** Texts for this module's own error codes: pass to errorMessage(error, TEAM_ERROR_MESSAGES). */
export const TEAM_ERROR_MESSAGES: Record<string, string> = {
  EMAIL_TAKEN: 'Someone on the team already uses this email address.',
  ROLE_CEILING: "You can't assign this role: it is above your authority.",
  PERMISSION_CEILING: 'You can only grant access that you have yourself.',
  SCOPE_CEILING: "You can't give a wider access scope than your own.",
  SELF_CHANGE: "You can't change your own role, access or status.",
  PEER_PROTECTED: 'Only someone above this person in the hierarchy can change them.',
  FORBIDDEN: "You don't have permission to do this.",
};

// ---------------------------------------------------------------- public shapes

export interface TeamPersonRef {
  id: string;
  name: string;
}

/** What the signed-in admin may do with one person. The API decides; the page only hides. */
export interface MemberActions {
  edit: boolean;
  changeRole: boolean;
  changeStatus: boolean;
  remove: boolean;
  approve: boolean;
  resendInvite: boolean;
  message: boolean;
}

export interface AdminTeamMember {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string | null;
  /** The visible title; the authority comes from the role's level, never from this text. */
  jobTitle: string;
  departmentId: string;
  departmentName: string;
  roleId: string;
  roleTitle: string;
  level: AuthorityLevel;
  accessLevel: AccessLevel;
  reportsTo: TeamPersonRef | null;
  locationId: string | null;
  locationName: string | null;
  teamId: string | null;
  teamName: string | null;
  scope: AccessScope;
  permissions: TeamPermissions;
  /** The permissions differ from the role's template ("Custom Permissions Applied"). */
  customPermissions: boolean;
  status: MemberStatus;
  availability: Availability;
  invitedBy: TeamPersonRef | null;
  approvedBy: TeamPersonRef | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
  isYou: boolean;
  allowed: MemberActions;
}

export type TeamSort =
  'name' | 'department' | 'jobTitle' | 'accessLevel' | 'location' | 'status' | 'availability';

export interface TeamQuery {
  search?: string;
  departmentId?: string;
  roleId?: string;
  status?: MemberStatus;
  locationId?: string;
  teamId?: string;
  accessLevel?: AccessLevel;
  reportsToId?: string;
  sort?: TeamSort;
  descending?: boolean;
  page?: number;
  pageSize?: number;
}

export interface TeamPage {
  items: AdminTeamMember[];
  total: number;
  page: number;
  pageSize: number;
}

/** The KPI row, counted from the members the viewer may see. */
export interface TeamSummary {
  total: number;
  /** Added in the last 30 days: the "vs. last month" change. */
  addedLastMonth: number;
  admins: number;
  standard: number;
  active: number;
  /** Suspended, inactive or deactivated. Pending people are neither active nor inactive. */
  inactive: number;
}

export interface TeamCapabilities {
  add: boolean;
  editMembers: boolean;
  changeRoles: boolean;
  changeStatus: boolean;
  remove: boolean;
  customizePermissions: boolean;
  manageGroups: boolean;
  messageCompany: boolean;
  announce: boolean;
}

export interface TeamViewer {
  id: string;
  name: string;
  level: AuthorityLevel;
  departmentId: string;
  roleTitle: string;
  can: TeamCapabilities;
}

export interface TeamFilterOptions {
  departments: { id: string; name: string }[];
  roles: { id: string; title: string }[];
  statuses: MemberStatus[];
  locations: TeamLocation[];
  teams: TeamUnit[];
  accessLevels: AccessLevel[];
  supervisors: TeamPersonRef[];
}

export interface FormRole {
  id: string;
  departmentId: string;
  title: string;
  level: AuthorityLevel;
  /** HR entered a VP / Director: saved as Pending Approval for the department's Chief Officer. */
  needsApproval: boolean;
}

export interface FormPerson {
  id: string;
  name: string;
  roleTitle: string;
  departmentId: string;
  level: AuthorityLevel;
}

/** What the add and edit forms may offer this viewer (lower levels see fewer options). */
export interface MemberFormOptions {
  departments: { id: string; name: string }[];
  /** One department, prefilled and locked (a department manager adding to their own team). */
  departmentLocked: boolean;
  roles: FormRole[];
  supervisors: FormPerson[];
  locations: TeamLocation[];
  teams: TeamUnit[];
  scopes: AccessScope[];
  /** The viewer's own access: the ceiling for anything beyond a role's template. */
  viewerPermissions: TeamPermissions;
  /** The CEO grants anything. */
  unrestricted: boolean;
  canCustomize: boolean;
  statuses: MemberStatus[];
}

export interface SaveTeamMember {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  departmentId: string;
  roleId: string;
  reportsToId: string;
  locationId: string;
  teamId: string;
  scope: AccessScope | '';
  status: MemberStatus | '';
  permissions: TeamPermissions;
  invite: { email: boolean; sms: boolean };
}
export type MemberField = keyof SaveTeamMember;
export type MemberFieldErrors = Partial<Record<MemberField, string>>;

export type BulkChange =
  | { kind: 'department'; departmentId: string; roleId: string }
  | { kind: 'role'; roleId: string }
  | { kind: 'status'; status: MemberStatus };

export interface BulkResult {
  updated: number;
  skipped: { id: string; name: string; reason: string }[];
}

export type TeamActivityKind =
  | 'CREATED'
  | 'INVITED'
  | 'PROFILE_UPDATED'
  | 'DEPARTMENT_CHANGED'
  | 'ROLE_CHANGED'
  | 'PERMISSIONS_CHANGED'
  | 'SCOPE_CHANGED'
  | 'STATUS_CHANGED'
  | 'APPROVED'
  | 'REJECTED';

/** One audit entry: actor, target, action, previous and new value, time, approver. */
export interface TeamActivity {
  id: string;
  memberId: string;
  kind: TeamActivityKind;
  summary: string;
  previousValue: string | null;
  newValue: string | null;
  actor: TeamPersonRef;
  approver: TeamPersonRef | null;
  at: string;
}

export interface TeamGroup {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  createdBy: TeamPersonRef;
}

export type MessageAudience = 'COMPANY' | 'DEPARTMENT' | 'LOCATION' | 'MEMBERS' | 'GROUP';
export type MessageChannel = 'IN_APP' | 'EMAIL' | 'SMS';
export type MessagePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export const MESSAGE_PRIORITIES: Record<MessagePriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};
export const MESSAGE_CHANNELS: Record<MessageChannel, string> = {
  IN_APP: 'In-App Chat',
  EMAIL: 'Email',
  SMS: 'Text Message (SMS)',
};

export interface MessageTarget {
  kind: 'department' | 'location' | 'team' | 'member' | 'group';
  id: string;
}

export interface TeamAttachment {
  name: string;
  size: number;
  type: string;
}

export interface SendTeamMessage {
  audience: MessageAudience;
  targets: MessageTarget[];
  subject: string;
  priority: MessagePriority;
  /** HTML from the message editor; the API sanitizes it. */
  body: string;
  channels: MessageChannel[];
  allowReplies: boolean;
  announcement: boolean;
  attachments: TeamAttachment[];
}
export type MessageField = 'targets' | 'subject' | 'body' | 'channels' | 'attachments';
export type MessageFieldErrors = Partial<Record<MessageField, string>>;

export interface MessageOptions {
  audiences: { id: MessageAudience; allowed: boolean }[];
  departments: { id: string; name: string; memberCount: number }[];
  locations: { id: string; name: string; memberCount: number }[];
  teams: { id: string; name: string; departmentName: string; memberCount: number }[];
  members: { id: string; name: string; jobTitle: string; departmentName: string }[];
  groups: (TeamGroup & { memberCount: number })[];
  canAnnounce: boolean;
  canCreateGroup: boolean;
}

export interface SendMessageResult {
  id: string;
  recipients: number;
  /** Per channel: sent, and recipients it cannot reach (no active account, no mobile number). */
  channels: { channel: MessageChannel; sent: number; unavailable: number }[];
  announcement: boolean;
}

export interface CreateTeamGroup {
  name: string;
  description: string;
  memberIds: string[];
}

export type TeamView = 'card' | 'list';

// ---------------------------------------------------------------- store

interface StoredMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string;
  roleId: string;
  reportsToId: string | null;
  locationId: string | null;
  teamId: string | null;
  scope: AccessScope;
  permissions: TeamPermissions;
  status: MemberStatus;
  availability: Availability;
  invitedById: string | null;
  approvedById: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
}

interface StoredMessage extends SendTeamMessage {
  id: string;
  senderId: string;
  recipientIds: string[];
  sentAt: string;
}

const NOW = Date.now();
const DAY = 86_400_000;
const daysAgo = (days: number, hours = 0) =>
  new Date(NOW - days * DAY - hours * 3_600_000).toISOString();

const MEMBER = (n: number) => uuid('7e01', n);
const LOCATION = (name: string) => TEAM_LOCATIONS.find((entry) => entry.name === name)?.id ?? null;
const UNIT = (name: string) => TEAM_UNITS.find((entry) => entry.name === name)?.id ?? null;

/** [n, first, last, phone, role, job title, reports to n, location, team, status, presence, days ago] */
type SeedRow = [
  number,
  string,
  string,
  string | null,
  string,
  string,
  number | null,
  string,
  string | null,
  MemberStatus,
  Availability,
  number,
];
// prettier-ignore
const SEED: SeedRow[] = [
  [1, 'Morgan', 'Admin', '(404) 555-0100', 'ceo', 'Owner / CEO', null, 'Atlanta, GA', 'Leadership', 'ACTIVE', 'ONLINE', 900],
  [2, 'Jordan', 'Ellis', '(404) 555-0111', 'cro', 'Chief Revenue Officer', 1, 'Atlanta, GA', null, 'ACTIVE', 'ONLINE', 610],
  [3, 'Priya', 'Raman', '(404) 555-0123', 'sales-director', 'Sales Director', 2, 'Atlanta, GA', 'Enterprise Sales', 'ACTIVE', 'IN_MEETING', 420],
  [4, 'Marcus', 'Webb', '(704) 555-0134', 'sales-manager', 'Sales Manager', 3, 'Charlotte, NC', 'Enterprise Sales', 'ACTIVE', 'ONLINE', 300],
  [5, 'Elena', 'Ortiz', '(470) 555-0145', 'account-executive', 'Account Executive', 4, 'Remote', 'Enterprise Sales', 'ACTIVE', 'AWAY', 200],
  [6, 'Samuel', 'Brooks', null, 'sdr', 'Sales Development Representative', 4, 'Atlanta, GA', 'Growth Sales', 'PENDING_INVITATION', 'OFFLINE', 3],
  [7, 'Nina', 'Patel', '(404) 555-0167', 'chro', 'Chief People Officer', 1, 'Atlanta, GA', 'People Operations', 'ACTIVE', 'ONLINE', 540],
  [8, 'Grace', 'Kim', '(470) 555-0178', 'hr-administrator', 'People Administrator', 7, 'Remote', 'People Operations', 'ACTIVE', 'ONLINE', 160],
  [9, 'Daniel', 'Price', '(512) 555-0189', 'cto', 'Chief Technology Officer', 1, 'Austin, TX', null, 'ACTIVE', 'ONLINE', 600],
  [10, 'Aisha', 'Bello', '(512) 555-0190', 'engineering-manager', 'Engineering Manager', 9, 'Austin, TX', 'Platform', 'ACTIVE', 'IN_MEETING', 350],
  [11, 'Leo', 'Martins', '(470) 555-0102', 'software-engineer', 'Software Engineer', 10, 'Remote', 'Platform', 'ACTIVE', 'OFFLINE', 120],
  [12, 'Hannah', 'Cole', '(704) 555-0113', 'customer-success-manager', 'Client Success Manager', 1, 'Charlotte, NC', 'Onboarding', 'ACTIVE', 'AWAY', 280],
  [13, 'Victor', 'Hayes', '(704) 555-0124', 'support-representative', 'Customer Support Representative', 12, 'Charlotte, NC', 'Support Desk', 'SUSPENDED', 'OFFLINE', 240],
  [14, 'Olivia', 'Grant', '(470) 555-0135', 'marketing-director', 'Marketing Director', 1, 'Remote', 'Brand', 'PENDING_APPROVAL', 'OFFLINE', 6],
  [15, 'Ethan', 'Reyes', '(404) 555-0146', 'staff-accountant', 'Staff Accountant', 1, 'Atlanta, GA', 'Controllership', 'INACTIVE', 'OFFLINE', 400],
];

function seedMembers(): StoredMember[] {
  return SEED.map(
    ([
      n,
      firstName,
      lastName,
      phone,
      roleId,
      jobTitle,
      reportsTo,
      location,
      team,
      status,
      availability,
      days,
    ]) => {
      const role = roleById(roleId);
      const permissions = roleTemplate(roleId);
      // The Sales Manager was given "add team member" on top of his template.
      if (n === 4) permissions.team = ['view', 'create', 'edit'];
      return {
        id: MEMBER(n),
        firstName,
        lastName,
        email: `${firstName}.${lastName}@example.test`.toLowerCase(),
        phone,
        jobTitle,
        roleId,
        reportsToId: reportsTo === null ? null : MEMBER(reportsTo),
        locationId: LOCATION(location),
        teamId: team ? UNIT(team) : null,
        scope: defaultScope(role?.level ?? 6),
        permissions,
        status,
        availability,
        invitedById: n === 1 ? null : n === 14 ? MEMBER(8) : MEMBER(1),
        approvedById: null,
        createdAt: daysAgo(days),
        updatedAt: daysAgo(Math.min(days, 30)),
        lastActiveAt:
          status === 'ACTIVE' ? daysAgo(0, n % 5) : status === 'SUSPENDED' ? daysAgo(12) : null,
      };
    },
  );
}

const ACTIVITY = (n: number) => uuid('7e04', n);

function seedActivity(members: StoredMember[]): TeamActivity[] {
  const ref = (id: string | null): TeamPersonRef => {
    const member = members.find((entry) => entry.id === id);
    return member
      ? { id: member.id, name: `${member.firstName} ${member.lastName}` }
      : { id: MEMBER(1), name: 'Morgan Admin' };
  };
  let n = 0;
  const entry = (
    memberId: string,
    kind: TeamActivityKind,
    summary: string,
    actorId: string | null,
    at: string,
    previousValue: string | null = null,
    newValue: string | null = null,
  ): TeamActivity => ({
    id: ACTIVITY((n += 1)),
    memberId,
    kind,
    summary,
    previousValue,
    newValue,
    actor: ref(actorId),
    approver: null,
    at,
  });
  const created = members.map((member) =>
    entry(
      member.id,
      'CREATED',
      member.status === 'PENDING_APPROVAL'
        ? `Added as ${roleById(member.roleId)?.title ?? 'a team member'}, waiting for the department head's role assignment`
        : `Added to the team as ${roleById(member.roleId)?.title ?? 'a team member'}`,
      member.invitedById,
      member.createdAt,
    ),
  );
  return [
    ...created,
    entry(
      MEMBER(4),
      'ROLE_CHANGED',
      'Role changed',
      MEMBER(2),
      daysAgo(90),
      'Account Executive',
      'Sales Manager',
    ),
    entry(
      MEMBER(4),
      'PERMISSIONS_CHANGED',
      'Permission team.create granted',
      MEMBER(1),
      daysAgo(30),
      null,
      'team.create',
    ),
    entry(MEMBER(6), 'INVITED', 'Invitation email sent', MEMBER(1), daysAgo(3)),
    entry(
      MEMBER(13),
      'STATUS_CHANGED',
      'Status changed',
      MEMBER(12),
      daysAgo(12),
      'Active',
      'Suspended',
    ),
    entry(
      MEMBER(15),
      'STATUS_CHANGED',
      'Status changed',
      MEMBER(1),
      daysAgo(60),
      'Active',
      'Inactive',
    ),
  ];
}

function seedGroups(): TeamGroup[] {
  return [
    {
      id: uuid('7e02', 1),
      name: 'Leadership Team',
      description: 'The CEO and the department heads',
      memberIds: [MEMBER(1), MEMBER(2), MEMBER(7), MEMBER(9)],
      createdBy: { id: MEMBER(1), name: 'Morgan Admin' },
    },
    {
      id: uuid('7e02', 2),
      name: 'Launch Champions',
      description: 'People who try new releases first',
      memberIds: [MEMBER(5), MEMBER(10), MEMBER(11), MEMBER(12)],
      createdBy: { id: MEMBER(9), name: 'Daniel Price' },
    },
  ];
}

const SEEDED = seedMembers();
const store = {
  members: empty() ? [] : structuredClone(SEEDED),
  activity: empty() ? [] : seedActivity(SEEDED),
  groups: empty() ? [] : seedGroups(),
  messages: [] as StoredMessage[],
  view: 'card' as TeamView,
  next: { member: 100, activity: 1000, group: 100, message: 1 },
};

/** The signed-in admin, from NEXT_PUBLIC_API_MOCK_ROLE (see the header comment). */
const VIEWER_ID = MEMBER(MOCK_ROLE === 'ADMIN' ? 4 : MOCK_ROLE === 'STAFF' ? 5 : 1);
const viewerRecord = (): StoredMember => {
  const record =
    store.members.find((member) => member.id === VIEWER_ID) ??
    SEEDED.find((member) => member.id === VIEWER_ID);
  if (!record) throw fail(401, 'UNAUTHENTICATED', 'Sign in required');
  return record;
};

// ---------------------------------------------------------------- rules

interface Facts {
  record: StoredMember;
  role: TeamRole;
  level: AuthorityLevel;
  departmentId: string;
  name: string;
}

const UNKNOWN_ROLE: TeamRole = { id: '', departmentId: '', title: 'Unknown role', level: 6 };
const facts = (record: StoredMember): Facts => {
  const role = roleById(record.roleId) ?? UNKNOWN_ROLE;
  return {
    record,
    role,
    level: role.level,
    departmentId: role.departmentId,
    name: `${record.firstName} ${record.lastName}`,
  };
};

/** The CHRO and the Authorized HR / People Administrator onboard people in every department. */
const isHr = (actor: Facts) =>
  Boolean(actor.role.hrOverride) || (actor.departmentId === 'hr' && actor.level === 2);

function capabilities(actor: Facts): TeamCapabilities {
  const team = actor.record.permissions.team ?? [];
  const has = (action: PermissionAction) => team.includes(action);
  return {
    add: has('create'),
    editMembers: has('edit'),
    changeRoles: has('assign'),
    changeStatus: actor.level <= 2 || has('manage'),
    remove: actor.level <= 2 || has('delete'),
    customizePermissions: actor.level <= 2 || has('manage'),
    manageGroups: actor.level <= 4,
    messageCompany: actor.level === 1,
    announce: actor.level <= 2,
  };
}

/** Directory scope: the CEO and HR see everyone; others their department (and leadership). */
function sees(actor: Facts, target: Facts): boolean {
  if (actor.level === 1 || isHr(actor) || actor.record.id === target.record.id) return true;
  if (actor.departmentId === target.departmentId) return true;
  return actor.level <= 3 && target.level <= 2;
}

/** Whether the actor's authority reaches the person (department scope, never a peer or above). */
function reaches(actor: Facts, target: Facts): boolean {
  if (actor.record.id === target.record.id) return false;
  if (actor.level === 1) return true;
  if (target.level <= actor.level) return false;
  if (isHr(actor)) return target.level > 2;
  return actor.departmentId === target.departmentId;
}

/** May the actor give this role: directly, only with the department head's approval, or not. */
function roleGate(actor: Facts, role: TeamRole): 'direct' | 'approval' | 'no' {
  if (actor.level === 1) return 'direct';
  // Only the CEO adds or assigns Chief Officers and the CEO.
  if (role.level <= 2) return 'no';
  if (isHr(actor)) {
    if (role.level >= 4) return 'direct';
    // VP / Director roles belong to the department's Chief Officer.
    return actor.level === 2 && actor.departmentId === role.departmentId ? 'direct' : 'approval';
  }
  if (role.departmentId !== actor.departmentId) return 'no';
  if (actor.level === 2) return role.level >= 3 ? 'direct' : 'no';
  if (actor.level === 3) return role.level >= 4 ? 'direct' : 'no';
  if (actor.level === 4) return role.level >= 5 ? 'direct' : 'no';
  return 'no';
}

function assignableDepartments(actor: Facts): string[] {
  return actor.level === 1 || isHr(actor)
    ? TEAM_DEPARTMENTS.map((department) => department.id)
    : [actor.departmentId];
}

function assignableScopes(actor: Facts): AccessScope[] {
  if (actor.level === 1) return ACCESS_SCOPES.map((scope) => scope.id);
  const floor = isHr(actor) ? scopeRank('DEPARTMENT') : scopeRank(actor.record.scope);
  return ACCESS_SCOPES.filter((scope) => scope.id !== 'CUSTOM' && scopeRank(scope.id) >= floor).map(
    (scope) => scope.id,
  );
}

/** A role's template plus the actor's own access: the most the actor may grant with that role. */
export function grantable(
  roleId: string,
  viewerPermissions: TeamPermissions,
  unrestricted: boolean,
): TeamPermissions {
  const result: TeamPermissions = {};
  const template = roleTemplate(roleId);
  for (const module of TEAM_MODULES) {
    const actions = unrestricted
      ? module.actions
      : module.actions.filter(
          (action) =>
            template[module.id]?.includes(action) || viewerPermissions[module.id]?.includes(action),
        );
    if (actions.length) result[module.id] = actions;
  }
  return result;
}

function withinCeiling(requested: TeamPermissions, ceiling: TeamPermissions): boolean {
  return TEAM_MODULES.every(({ id }) =>
    (requested[id] ?? []).every((action) => ceiling[id]?.includes(action)),
  );
}

/** Valid supervisors for a role: higher authority, in the department, leadership, or the CEO. */
export function supervisorsFor(
  people: FormPerson[],
  departmentId: string,
  level: AuthorityLevel,
): FormPerson[] {
  return people.filter(
    (person) =>
      person.level < level &&
      (person.departmentId === departmentId ||
        person.departmentId === 'executive' ||
        person.level === 1),
  );
}

/** Everyone below this person in the reporting line (they can't become their supervisor). */
function reportsOf(memberId: string): Set<string> {
  const below = new Set<string>();
  const queue = [memberId];
  while (queue.length) {
    const current = queue.pop();
    for (const member of store.members) {
      if (member.reportsToId === current && !below.has(member.id)) {
        below.add(member.id);
        queue.push(member.id);
      }
    }
  }
  return below;
}

function allowedActions(actor: Facts, target: Facts): MemberActions {
  const can = capabilities(actor);
  const reach = reaches(actor, target);
  const self = actor.record.id === target.record.id;
  const status = target.record.status;
  return {
    edit: self || (reach && can.editMembers),
    changeRole: reach && can.changeRoles,
    changeStatus: reach && can.changeStatus,
    remove: reach && can.remove && status !== 'DEACTIVATED',
    approve:
      status === 'PENDING_APPROVAL' &&
      (actor.level === 1 || (actor.level === 2 && actor.departmentId === target.departmentId)),
    resendInvite: status === 'PENDING_INVITATION' && (reach || self) && can.add,
    message: !self && status !== 'DEACTIVATED',
  };
}

// ---------------------------------------------------------------- validation

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (value: string) => value.replace(/\D/g, '');

/** The form's and the API's checks, one message per field (the form shows them as you submit). */
export function checkMember(input: SaveTeamMember, mode: 'create' | 'edit'): MemberFieldErrors {
  const errors: MemberFieldErrors = {};
  const name = (value: string, field: 'firstName' | 'lastName', label: string) => {
    if (!value.trim()) errors[field] = `Enter a ${label}`;
    else if (value.trim().length > 50) errors[field] = 'Use 50 characters or fewer';
  };
  name(input.firstName, 'firstName', 'first name');
  name(input.lastName, 'lastName', 'last name');
  if (mode === 'create') {
    const email = input.email.trim();
    if (!email || !EMAIL.test(email) || email.length > 254)
      errors.email = 'Enter an email address like name@company.com';
  }
  const phone = digits(input.phone);
  if (input.phone.trim() && (phone.length < 10 || phone.length > 15))
    errors.phone = 'Enter a phone number with 10 to 15 digits';
  if (input.jobTitle.trim().length > 80) errors.jobTitle = 'Use 80 characters or fewer';
  if (!input.departmentId) errors.departmentId = 'Choose a department';
  const role = roleById(input.roleId);
  if (!input.roleId) errors.roleId = 'Choose a role';
  else if (!role || role.departmentId !== input.departmentId)
    errors.roleId = 'Choose a role in this department';
  const team = TEAM_UNITS.find((unit) => unit.id === input.teamId);
  if (input.teamId && team?.departmentId !== input.departmentId)
    errors.teamId = 'Choose a team in this department';
  if (input.locationId && !TEAM_LOCATIONS.some((location) => location.id === input.locationId))
    errors.locationId = 'Choose a location from the list';
  if (!input.scope) errors.scope = 'Choose an access scope';
  if (!input.status) errors.status = 'Choose a status';
  else if (
    mode === 'create' &&
    input.status === 'PENDING_INVITATION' &&
    !input.invite.email &&
    !input.invite.sms
  )
    errors.status = 'Send an invitation, or choose another status';
  if (input.invite.sms && !input.phone.trim())
    errors.invite = 'Add a phone number to send a text invitation';
  return errors;
}

const ATTACHMENT_TYPES = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'];
export const ATTACHMENT_RULES = {
  accept: ATTACHMENT_TYPES,
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 10,
};
export const MESSAGE_LIMIT = 2000;

/** The visible text of the editor's HTML. */
export const plainText = (html: string) =>
  html
    .replace(/<(br|\/p|\/li|\/div)[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, '_')
    .replace(/\s+/g, ' ')
    .trim();

export function checkMessage(input: SendTeamMessage): MessageFieldErrors {
  const errors: MessageFieldErrors = {};
  if (input.audience !== 'COMPANY' && input.targets.length === 0)
    errors.targets = 'Choose at least one recipient';
  if (!input.subject.trim()) errors.subject = 'Enter a subject';
  else if (input.subject.trim().length > 150) errors.subject = 'Use 150 characters or fewer';
  const length = plainText(input.body).length;
  if (length === 0) errors.body = 'Write a message';
  else if (length > MESSAGE_LIMIT)
    errors.body = `Use ${MESSAGE_LIMIT.toLocaleString('en-US')} characters or fewer`;
  if (input.channels.length === 0) errors.channels = 'Choose at least one delivery method';
  const badFile = input.attachments.find(
    (file) =>
      file.size > ATTACHMENT_RULES.maxBytes ||
      !ATTACHMENT_TYPES.some((type) => file.name.toLowerCase().endsWith(type)),
  );
  if (badFile)
    errors.attachments = `${badFile.name} is not a PDF, Word, Excel or image file up to 10MB`;
  else if (input.attachments.length > ATTACHMENT_RULES.maxFiles)
    errors.attachments = 'Attach up to 10 files';
  return errors;
}

const firstError = (errors: Record<string, string | undefined>) =>
  Object.values(errors).find(Boolean);

// ---------------------------------------------------------------- read models

const nameOf = (id: string | null): TeamPersonRef | null => {
  const member =
    store.members.find((entry) => entry.id === id) ?? SEEDED.find((entry) => entry.id === id);
  return member ? { id: member.id, name: `${member.firstName} ${member.lastName}` } : null;
};

function toMember(record: StoredMember, actor: Facts): AdminTeamMember {
  const target = facts(record);
  const location = TEAM_LOCATIONS.find((entry) => entry.id === record.locationId);
  const team = TEAM_UNITS.find((entry) => entry.id === record.teamId);
  return structuredClone({
    id: record.id,
    firstName: record.firstName,
    lastName: record.lastName,
    name: target.name,
    email: record.email,
    phone: record.phone,
    jobTitle: record.jobTitle || target.role.title,
    departmentId: target.departmentId,
    departmentName: departmentById(target.departmentId)?.name ?? 'No department',
    roleId: record.roleId,
    roleTitle: target.role.title,
    level: target.level,
    accessLevel: accessLevelOf(target.level),
    reportsTo: nameOf(record.reportsToId),
    locationId: record.locationId,
    locationName: location?.name ?? null,
    teamId: record.teamId,
    teamName: team?.name ?? null,
    scope: record.scope,
    permissions: record.permissions,
    customPermissions: !samePermissions(record.permissions, roleTemplate(record.roleId)),
    status: record.status,
    availability: record.availability,
    invitedBy: nameOf(record.invitedById),
    approvedBy: nameOf(record.approvedById),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActiveAt: record.lastActiveAt,
    isYou: record.id === actor.record.id,
    allowed: allowedActions(actor, target),
  });
}

const visibleMembers = (actor: Facts) =>
  store.members.filter((member) => sees(actor, facts(member)));

const ACCESS_RANK: Record<AccessLevel, number> = { SUPER_ADMIN: 0, ADMIN: 1, STANDARD: 2 };
const STATUS_RANK = Object.keys(MEMBER_STATUSES) as MemberStatus[];
const PRESENCE_RANK = Object.keys(AVAILABILITY) as Availability[];

const sortValue: Record<TeamSort, (member: AdminTeamMember) => string | number> = {
  name: (member) => member.name.toLowerCase(),
  department: (member) => member.departmentName.toLowerCase(),
  jobTitle: (member) => member.jobTitle.toLowerCase(),
  accessLevel: (member) => ACCESS_RANK[member.accessLevel],
  location: (member) => (member.locationName ?? '').toLowerCase(),
  status: (member) => STATUS_RANK.indexOf(member.status),
  availability: (member) => PRESENCE_RANK.indexOf(member.availability),
};

function matches(member: AdminTeamMember, query: TeamQuery): boolean {
  const search = (query.search ?? '').trim().toLowerCase();
  if (search) {
    const haystack = [
      member.name,
      member.email,
      member.phone ?? '',
      digits(member.phone ?? ''),
      member.departmentName,
      member.teamName ?? '',
      member.locationName ?? '',
      member.roleTitle,
      member.jobTitle,
      MEMBER_STATUSES[member.status],
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (query.departmentId && member.departmentId !== query.departmentId) return false;
  if (query.roleId && member.roleId !== query.roleId) return false;
  if (query.status && member.status !== query.status) return false;
  if (query.locationId && member.locationId !== query.locationId) return false;
  if (query.teamId && member.teamId !== query.teamId) return false;
  if (query.accessLevel && member.accessLevel !== query.accessLevel) return false;
  if (query.reportsToId && member.reportsTo?.id !== query.reportsToId) return false;
  return true;
}

function log(
  actor: Facts,
  memberId: string,
  kind: TeamActivityKind,
  summary: string,
  previousValue: string | null = null,
  newValue: string | null = null,
) {
  store.next.activity += 1;
  store.activity.push({
    id: ACTIVITY(store.next.activity),
    memberId,
    kind,
    summary,
    previousValue,
    newValue,
    actor: { id: actor.record.id, name: actor.name },
    approver: null,
    at: new Date().toISOString(),
  });
}

const permissionKeys = (permissions: TeamPermissions) =>
  TEAM_MODULES.flatMap(({ id }) => (permissions[id] ?? []).map((action) => `${id}.${action}`));

function logPermissionChange(
  actor: Facts,
  memberId: string,
  before: TeamPermissions,
  after: TeamPermissions,
) {
  const old = new Set(permissionKeys(before));
  const now = new Set(permissionKeys(after));
  const granted = [...now].filter((key) => !old.has(key));
  const revoked = [...old].filter((key) => !now.has(key));
  if (granted.length)
    log(
      actor,
      memberId,
      'PERMISSIONS_CHANGED',
      `Permission ${granted.join(', ')} granted`,
      null,
      granted.join(', '),
    );
  if (revoked.length)
    log(
      actor,
      memberId,
      'PERMISSIONS_CHANGED',
      `Permission ${revoked.join(', ')} revoked`,
      revoked.join(', '),
      null,
    );
}

const cleanPermissions = (permissions: TeamPermissions): TeamPermissions => {
  const clean: TeamPermissions = {};
  for (const module of TEAM_MODULES) {
    const actions = [...new Set(permissions[module.id] ?? [])].filter((action) =>
      module.actions.includes(action),
    );
    if (actions.length) clean[module.id] = actions;
  }
  return clean;
};

function findRecord(id: string): StoredMember {
  const record = store.members.find((member) => member.id === id);
  if (!record) throw notFound();
  return record;
}

/** Checks a save against the actor's ceilings. Throws the API's error for the first problem. */
function authorize(
  actor: Facts,
  input: SaveTeamMember,
  current: StoredMember | null,
): { gate: 'direct' | 'approval'; role: TeamRole } {
  const role = roleById(input.roleId);
  if (!role) throw fail(400, 'VALIDATION_FAILED', 'Choose a role in this department');
  const roleChanged = !current || current.roleId !== role.id;
  if (current && current.id === actor.record.id) {
    const same =
      !roleChanged &&
      current.scope === input.scope &&
      current.status === input.status &&
      (current.reportsToId ?? '') === input.reportsToId &&
      samePermissions(current.permissions, input.permissions);
    if (!same) throw fail(403, 'SELF_CHANGE', 'You cannot change your own role, access or status');
    return { gate: 'direct', role };
  }
  if (!assignableDepartments(actor).includes(role.departmentId))
    throw forbidden('This department is outside your authority');
  const gate = roleChanged ? roleGate(actor, role) : 'direct';
  if (gate === 'no') throw fail(403, 'ROLE_CEILING', 'This role is above your authority');
  if (
    !assignableScopes(actor).includes(input.scope as AccessScope) &&
    current?.scope !== input.scope
  )
    throw fail(403, 'SCOPE_CEILING', 'This scope is wider than your own');
  const ceiling = grantable(role.id, actor.record.permissions, actor.level === 1);
  const unchanged = current && samePermissions(current.permissions, input.permissions);
  if (!unchanged && !withinCeiling(input.permissions, ceiling))
    throw fail(403, 'PERMISSION_CEILING', 'These permissions are above your own');
  if (input.reportsToId) {
    const supervisor = store.members.find((member) => member.id === input.reportsToId);
    const valid =
      supervisor &&
      supervisor.id !== current?.id &&
      !(current && reportsOf(current.id).has(supervisor.id)) &&
      supervisorsFor([toPerson(supervisor)], role.departmentId, role.level).length === 1;
    if (!valid) throw fail(400, 'VALIDATION_FAILED', 'Choose a supervisor above this role');
  }
  return { gate, role };
}

const toPerson = (record: StoredMember): FormPerson => {
  const target = facts(record);
  return {
    id: record.id,
    name: target.name,
    roleTitle: target.role.title,
    departmentId: target.departmentId,
    level: target.level,
  };
};

function applyBulk(actor: Facts, record: StoredMember, change: BulkChange): string | null {
  const target = facts(record);
  const allowed = allowedActions(actor, target);
  if (change.kind === 'status') {
    if (!allowed.changeStatus) return 'Outside your authority';
    if (record.status === change.status) return null;
    const previous = MEMBER_STATUSES[record.status];
    record.status = change.status;
    if (change.status !== 'ACTIVE') record.availability = 'OFFLINE';
    record.updatedAt = new Date().toISOString();
    log(
      actor,
      record.id,
      'STATUS_CHANGED',
      'Status changed',
      previous,
      MEMBER_STATUSES[change.status],
    );
    return null;
  }
  if (!allowed.changeRole) return 'Outside your authority';
  const role = roleById(change.roleId);
  if (!role) return 'Unknown role';
  if (change.kind === 'role' && role.departmentId !== target.departmentId)
    return `Not in ${departmentById(role.departmentId)?.name ?? 'this department'}`;
  if (change.kind === 'department' && role.departmentId !== change.departmentId)
    return 'Unknown role';
  if (!assignableDepartments(actor).includes(role.departmentId)) return 'Outside your authority';
  const gate = roleGate(actor, role);
  if (gate === 'no') return 'Role above your authority';
  const before = record.permissions;
  if (target.departmentId !== role.departmentId)
    log(
      actor,
      record.id,
      'DEPARTMENT_CHANGED',
      'Department changed',
      departmentById(target.departmentId)?.name ?? null,
      departmentById(role.departmentId)?.name ?? null,
    );
  if (record.roleId !== role.id)
    log(actor, record.id, 'ROLE_CHANGED', 'Role changed', target.role.title, role.title);
  record.roleId = role.id;
  record.jobTitle = role.title;
  record.permissions = roleTemplate(role.id);
  logPermissionChange(actor, record.id, before, record.permissions);
  if (
    record.teamId &&
    TEAM_UNITS.find((unit) => unit.id === record.teamId)?.departmentId !== role.departmentId
  )
    record.teamId = null;
  const supervisor = store.members.find((member) => member.id === record.reportsToId);
  if (
    supervisor &&
    supervisorsFor([toPerson(supervisor)], role.departmentId, role.level).length === 0
  )
    record.reportsToId = null;
  if (gate === 'approval') record.status = 'PENDING_APPROVAL';
  record.updatedAt = new Date().toISOString();
  return null;
}

function recipientsOf(actor: Facts, input: SendTeamMessage): StoredMember[] {
  const eligible = visibleMembers(actor).filter(
    (member) =>
      member.id !== actor.record.id &&
      member.status !== 'INACTIVE' &&
      member.status !== 'DEACTIVATED',
  );
  if (input.audience === 'COMPANY') return eligible;
  const chosen = new Set<string>();
  for (const target of input.targets) {
    for (const member of eligible) {
      const info = facts(member);
      const hit =
        (target.kind === 'department' && info.departmentId === target.id) ||
        (target.kind === 'location' && member.locationId === target.id) ||
        (target.kind === 'team' && member.teamId === target.id) ||
        (target.kind === 'member' && member.id === target.id) ||
        (target.kind === 'group' &&
          Boolean(
            store.groups.find((group) => group.id === target.id)?.memberIds.includes(member.id),
          ));
      if (hit) chosen.add(member.id);
    }
  }
  return eligible.filter((member) => chosen.has(member.id));
}

const audienceAllowed = (actor: Facts, audience: MessageAudience) =>
  audience === 'COMPANY'
    ? actor.level === 1
    : audience === 'DEPARTMENT'
      ? actor.level <= 5
      : audience === 'LOCATION'
        ? actor.level <= 3
        : true;

const visibleGroups = (actor: Facts) =>
  store.groups.filter(
    (group) =>
      actor.level === 1 ||
      group.createdBy.id === actor.record.id ||
      group.memberIds.includes(actor.record.id),
  );

/** Recipients the actor may message: their messaging scope, active and pending people only. */
function messageOptionsFor(me: Facts): MessageOptions {
  const people = visibleMembers(me).filter(
    (member) =>
      member.id !== me.record.id && member.status !== 'INACTIVE' && member.status !== 'DEACTIVATED',
  );
  const countWhere = (test: (member: StoredMember) => boolean) => people.filter(test).length;
  const departmentIds =
    me.level === 1 || isHr(me)
      ? TEAM_DEPARTMENTS.map((department) => department.id)
      : [me.departmentId];
  const locationIds =
    me.level === 1 ? TEAM_LOCATIONS.map((location) => location.id) : [me.record.locationId ?? ''];
  const caps = capabilities(me);
  const audiences: MessageAudience[] = ['COMPANY', 'DEPARTMENT', 'LOCATION', 'MEMBERS', 'GROUP'];
  return {
    audiences: audiences.map((id) => ({ id, allowed: audienceAllowed(me, id) })),
    departments: TEAM_DEPARTMENTS.filter((department) => departmentIds.includes(department.id)).map(
      (department) => ({
        id: department.id,
        name: department.name,
        memberCount: countWhere((member) => facts(member).departmentId === department.id),
      }),
    ),
    locations: TEAM_LOCATIONS.filter((location) => locationIds.includes(location.id)).map(
      (location) => ({
        ...location,
        memberCount: countWhere((member) => member.locationId === location.id),
      }),
    ),
    teams: TEAM_UNITS.filter((unit) => departmentIds.includes(unit.departmentId)).map((unit) => ({
      id: unit.id,
      name: unit.name,
      departmentName: departmentById(unit.departmentId)?.name ?? '',
      memberCount: countWhere((member) => member.teamId === unit.id),
    })),
    members: people
      .map((member) => {
        const info = facts(member);
        return {
          id: member.id,
          name: info.name,
          jobTitle: member.jobTitle || info.role.title,
          departmentName: departmentById(info.departmentId)?.name ?? '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    groups: visibleGroups(me).map((group) => ({
      ...structuredClone(group),
      memberCount: group.memberIds.length,
    })),
    canAnnounce: caps.announce,
    canCreateGroup: caps.manageGroups,
  };
}

// ---------------------------------------------------------------- client

const actor = () => facts(viewerRecord());
const CREATE_STATUSES: MemberStatus[] = ['PENDING_INVITATION', 'ACTIVE', 'INACTIVE'];
const SETTABLE_STATUSES: MemberStatus[] = ['ACTIVE', 'SUSPENDED', 'INACTIVE', 'DEACTIVATED'];

export const adminTeam = {
  /** The signed-in admin and what they may do in the Team module. */
  viewer: async (): Promise<TeamViewer> => {
    await ready();
    const me = actor();
    return {
      id: me.record.id,
      name: me.name,
      level: me.level,
      departmentId: me.departmentId,
      roleTitle: me.role.title,
      can: capabilities(me),
    };
  },

  summary: async (): Promise<TeamSummary> => {
    await ready();
    const members = visibleMembers(actor());
    const since = NOW - 30 * DAY;
    const count = (test: (member: StoredMember) => boolean) => members.filter(test).length;
    return {
      total: members.length,
      addedLastMonth: count((member) => Date.parse(member.createdAt) >= since),
      admins: count((member) => accessLevelOf(facts(member).level) !== 'STANDARD'),
      standard: count((member) => accessLevelOf(facts(member).level) === 'STANDARD'),
      active: count((member) => member.status === 'ACTIVE'),
      inactive: count((member) => ['SUSPENDED', 'INACTIVE', 'DEACTIVATED'].includes(member.status)),
    };
  },

  /** The filters' values: only what the viewer may see. */
  filterOptions: async (): Promise<TeamFilterOptions> => {
    await ready();
    const me = actor();
    const members = visibleMembers(me).map(facts);
    const departmentIds = new Set(
      me.level === 1 || isHr(me)
        ? TEAM_DEPARTMENTS.map((department) => department.id)
        : members.map((member) => member.departmentId),
    );
    const roles = new Map(members.map((member) => [member.role.id, member.role.title]));
    const supervisorIds = new Set(members.map((member) => member.record.reportsToId));
    return {
      departments: TEAM_DEPARTMENTS.filter((department) => departmentIds.has(department.id)).map(
        ({ id, name }) => ({ id, name }),
      ),
      roles: [...roles]
        .map(([id, title]) => ({ id, title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      statuses: Object.keys(MEMBER_STATUSES) as MemberStatus[],
      locations: structuredClone(TEAM_LOCATIONS),
      teams: TEAM_UNITS.filter((unit) => departmentIds.has(unit.departmentId)),
      accessLevels: ['SUPER_ADMIN', 'ADMIN', 'STANDARD'],
      supervisors: members
        .filter((member) => supervisorIds.has(member.record.id))
        .map((member) => ({ id: member.record.id, name: member.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },

  members: async (query: TeamQuery = {}): Promise<TeamPage> => {
    await ready();
    const me = actor();
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 12)));
    if ((query.search ?? '').length > 100)
      throw fail(400, 'VALIDATION_FAILED', 'Search is 100 characters at most');
    const sort = sortValue[query.sort ?? 'name'];
    const rows = visibleMembers(me)
      .map((record) => toMember(record, me))
      .filter((member) => matches(member, query))
      .sort((a, b) => {
        const left = sort(a);
        const right = sort(b);
        const compared =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right));
        return (compared || a.name.localeCompare(b.name)) * (query.descending ? -1 : 1);
      });
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.floor(query.page ?? 1)));
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  },

  member: async (id: string): Promise<AdminTeamMember> => {
    await ready();
    const me = actor();
    const record = findRecord(id);
    if (!sees(me, facts(record))) throw notFound();
    return toMember(record, me);
  },

  /** The person's audit trail, newest first. */
  activity: async (id: string): Promise<TeamActivity[]> => {
    await ready();
    const me = actor();
    const record = findRecord(id);
    if (!sees(me, facts(record))) throw notFound();
    return structuredClone(
      store.activity
        .filter((entry) => entry.memberId === id)
        .sort((a, b) => b.at.localeCompare(a.at)),
    );
  },

  /** The add form's choices for this viewer, or the edit form's for one person. */
  formOptions: async (memberId?: string): Promise<MemberFormOptions> => {
    await ready();
    const me = actor();
    const current = memberId ? findRecord(memberId) : null;
    const departments = assignableDepartments(me);
    const currentDepartment = current ? roleById(current.roleId)?.departmentId : undefined;
    // Roles above the viewer's ceiling are left out; the person's current role always shows.
    const roles = TEAM_ROLES.flatMap((role): FormRole[] => {
      const gate = current?.roleId === role.id ? 'direct' : roleGate(me, role);
      if (
        gate === 'no' ||
        !(departments.includes(role.departmentId) || current?.roleId === role.id)
      )
        return [];
      return [
        {
          id: role.id,
          departmentId: role.departmentId,
          title: role.title,
          level: role.level,
          needsApproval: gate === 'approval',
        },
      ];
    });
    const below = current ? reportsOf(current.id) : new Set<string>();
    const statuses = current
      ? [...new Set<MemberStatus>([current.status, ...SETTABLE_STATUSES])]
      : CREATE_STATUSES;
    return {
      departments: TEAM_DEPARTMENTS.filter(
        (department) => departments.includes(department.id) || department.id === currentDepartment,
      ).map(({ id, name }) => ({ id, name })),
      departmentLocked: departments.length === 1,
      roles,
      supervisors: store.members
        .filter(
          (member) =>
            member.id !== current?.id &&
            !below.has(member.id) &&
            member.status !== 'DEACTIVATED' &&
            member.status !== 'INACTIVE',
        )
        .map(toPerson)
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      locations: structuredClone(TEAM_LOCATIONS),
      teams: structuredClone(TEAM_UNITS),
      scopes: [...new Set([...assignableScopes(me), ...(current ? [current.scope] : [])])],
      viewerPermissions: structuredClone(me.record.permissions),
      unrestricted: me.level === 1,
      canCustomize: capabilities(me).customizePermissions,
      statuses,
    };
  },

  createMember: async (body: SaveTeamMember): Promise<AdminTeamMember> => {
    await ready();
    const me = actor();
    if (!capabilities(me).add) throw forbidden('You cannot add team members');
    const problem = firstError(checkMember(body, 'create'));
    if (problem) throw fail(400, 'VALIDATION_FAILED', problem);
    if (!CREATE_STATUSES.includes(body.status as MemberStatus))
      throw fail(400, 'VALIDATION_FAILED', 'Choose a status');
    const email = body.email.trim().toLowerCase();
    if (store.members.some((member) => member.email === email))
      throw fail(409, 'EMAIL_TAKEN', 'This email is already on the team');
    const { gate, role } = authorize(me, body, null);
    store.next.member += 1;
    const now = new Date().toISOString();
    const status: MemberStatus =
      gate === 'approval' ? 'PENDING_APPROVAL' : (body.status as MemberStatus);
    const record: StoredMember = {
      id: MEMBER(store.next.member),
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email,
      phone: body.phone.trim() || null,
      jobTitle: body.jobTitle.trim() || role.title,
      roleId: role.id,
      reportsToId: body.reportsToId || null,
      locationId: body.locationId || null,
      teamId: body.teamId || null,
      scope: body.scope as AccessScope,
      permissions: cleanPermissions(body.permissions),
      status,
      availability: 'OFFLINE',
      invitedById: me.record.id,
      approvedById: null,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: null,
    };
    store.members.push(record);
    log(
      me,
      record.id,
      'CREATED',
      gate === 'approval'
        ? `Added as ${role.title}, waiting for the department head's role assignment`
        : `Added to the team as ${role.title}`,
    );
    if (!samePermissions(record.permissions, roleTemplate(role.id)))
      logPermissionChange(me, record.id, roleTemplate(role.id), record.permissions);
    if (gate === 'direct' && (body.invite.email || body.invite.sms))
      log(
        me,
        record.id,
        'INVITED',
        body.invite.email && body.invite.sms
          ? 'Invitation sent by email and text message'
          : body.invite.email
            ? 'Invitation email sent'
            : 'Invitation text message sent',
      );
    return toMember(record, me);
  },

  updateMember: async (id: string, body: SaveTeamMember): Promise<AdminTeamMember> => {
    await ready();
    const me = actor();
    const record = findRecord(id);
    const target = facts(record);
    if (!sees(me, target)) throw notFound();
    const allowed = allowedActions(me, target);
    if (!allowed.edit) throw fail(403, 'PEER_PROTECTED', 'Outside your authority');
    const problem = firstError(checkMember({ ...body, email: record.email }, 'edit'));
    if (problem) throw fail(400, 'VALIDATION_FAILED', problem);
    if (body.status !== record.status && !SETTABLE_STATUSES.includes(body.status as MemberStatus))
      throw fail(400, 'VALIDATION_FAILED', 'Choose a status');
    const { gate, role } = authorize(me, body, record);
    if (record.roleId !== role.id && !allowed.changeRole && record.id !== me.record.id)
      throw fail(403, 'ROLE_CEILING', 'You cannot change roles');
    if (record.status !== body.status && !allowed.changeStatus)
      throw forbidden('You cannot change this status');
    const before = structuredClone(record);
    record.firstName = body.firstName.trim();
    record.lastName = body.lastName.trim();
    record.phone = body.phone.trim() || null;
    record.jobTitle = body.jobTitle.trim() || role.title;
    record.locationId = body.locationId || null;
    record.teamId = body.teamId || null;
    record.reportsToId = body.reportsToId || null;
    record.roleId = role.id;
    record.scope = body.scope as AccessScope;
    record.permissions = cleanPermissions(body.permissions);
    record.status =
      gate === 'approval' && before.roleId !== role.id
        ? 'PENDING_APPROVAL'
        : (body.status as MemberStatus);
    record.updatedAt = new Date().toISOString();
    const profileChanged =
      before.firstName !== record.firstName ||
      before.lastName !== record.lastName ||
      before.phone !== record.phone ||
      before.jobTitle !== record.jobTitle ||
      before.locationId !== record.locationId ||
      before.teamId !== record.teamId ||
      before.reportsToId !== record.reportsToId;
    if (profileChanged) log(me, id, 'PROFILE_UPDATED', 'Profile details updated');
    const oldRole = roleById(before.roleId);
    if (oldRole && oldRole.departmentId !== role.departmentId)
      log(
        me,
        id,
        'DEPARTMENT_CHANGED',
        'Department changed',
        departmentById(oldRole.departmentId)?.name ?? null,
        departmentById(role.departmentId)?.name ?? null,
      );
    if (before.roleId !== role.id)
      log(me, id, 'ROLE_CHANGED', 'Role changed', oldRole?.title ?? null, role.title);
    if (before.scope !== record.scope)
      log(
        me,
        id,
        'SCOPE_CHANGED',
        'Access scope changed',
        ACCESS_SCOPES.find((scope) => scope.id === before.scope)?.label ?? null,
        ACCESS_SCOPES.find((scope) => scope.id === record.scope)?.label ?? null,
      );
    logPermissionChange(me, id, before.permissions, record.permissions);
    if (before.status !== record.status)
      log(
        me,
        id,
        'STATUS_CHANGED',
        'Status changed',
        MEMBER_STATUSES[before.status],
        MEMBER_STATUSES[record.status],
      );
    return toMember(record, me);
  },

  /** Change department, role or status for several people. People out of reach are skipped. */
  bulkUpdate: async (memberIds: string[], change: BulkChange): Promise<BulkResult> => {
    await ready();
    const me = actor();
    if (memberIds.length === 0) throw fail(400, 'VALIDATION_FAILED', 'Choose team members first');
    if (change.kind === 'status' && !SETTABLE_STATUSES.includes(change.status))
      throw fail(400, 'VALIDATION_FAILED', 'Choose a status');
    const result: BulkResult = { updated: 0, skipped: [] };
    for (const id of memberIds) {
      const record = store.members.find((member) => member.id === id);
      if (!record || !sees(me, facts(record))) continue;
      const reason =
        record.id === me.record.id ? "You can't change yourself" : applyBulk(me, record, change);
      if (reason) result.skipped.push({ id, name: facts(record).name, reason });
      else result.updated += 1;
    }
    return result;
  },

  resendInvitation: async (memberIds: string[]): Promise<{ sent: number }> => {
    await ready();
    const me = actor();
    let sent = 0;
    for (const id of memberIds) {
      const record = store.members.find((member) => member.id === id);
      if (!record || !allowedActions(me, facts(record)).resendInvite) continue;
      log(me, id, 'INVITED', 'Invitation email sent again');
      sent += 1;
    }
    return { sent };
  },

  /** The department head (or CEO) finalizes a VP / Director role HR entered. */
  decideApproval: async (id: string, decision: 'APPROVE' | 'REJECT'): Promise<AdminTeamMember> => {
    await ready();
    const me = actor();
    const record = findRecord(id);
    if (!allowedActions(me, facts(record)).approve)
      throw forbidden('Only the department head approves this role');
    record.status = decision === 'APPROVE' ? 'PENDING_INVITATION' : 'INACTIVE';
    record.approvedById = decision === 'APPROVE' ? me.record.id : null;
    record.updatedAt = new Date().toISOString();
    log(
      me,
      id,
      decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      decision === 'APPROVE' ? 'Role approved and invitation sent' : 'Role assignment rejected',
      MEMBER_STATUSES.PENDING_APPROVAL,
      MEMBER_STATUSES[record.status],
    );
    const entry = store.activity.at(-1);
    if (entry) entry.approver = { id: me.record.id, name: me.name };
    return toMember(record, me);
  },

  /** The directory's remembered layout (per signed-in admin). */
  viewPreference: async (): Promise<TeamView> => {
    await ready();
    return store.view;
  },
  setViewPreference: async (view: TeamView): Promise<TeamView> => {
    await ready();
    if (view !== 'card' && view !== 'list') throw fail(400, 'VALIDATION_FAILED', 'Unknown view');
    store.view = view;
    return view;
  },

  messageOptions: async (): Promise<MessageOptions> => {
    await ready();
    return messageOptionsFor(actor());
  },

  createGroup: async (body: CreateTeamGroup): Promise<TeamGroup> => {
    await ready();
    const me = actor();
    if (!capabilities(me).manageGroups) throw forbidden('You cannot create custom groups');
    const name = body.name.trim();
    if (!name) throw fail(400, 'VALIDATION_FAILED', 'Enter a group name');
    if (name.length > 60) throw fail(400, 'VALIDATION_FAILED', 'Use 60 characters or fewer');
    if (body.description.trim().length > 200)
      throw fail(400, 'VALIDATION_FAILED', 'Use 200 characters or fewer for the description');
    if (store.groups.some((group) => group.name.toLowerCase() === name.toLowerCase()))
      throw fail(409, 'CONFLICT', 'A group with this name already exists');
    const allowedIds = new Set(visibleMembers(me).map((member) => member.id));
    const memberIds = [...new Set(body.memberIds)].filter((id) => allowedIds.has(id));
    if (memberIds.length === 0) throw fail(400, 'VALIDATION_FAILED', 'Add at least one member');
    store.next.group += 1;
    const group: TeamGroup = {
      id: uuid('7e02', store.next.group),
      name,
      description: body.description.trim(),
      memberIds,
      createdBy: { id: me.record.id, name: me.name },
    };
    store.groups.push(group);
    return structuredClone(group);
  },

  sendMessage: async (body: SendTeamMessage): Promise<SendMessageResult> => {
    await ready();
    const me = actor();
    const problem = firstError(checkMessage(body));
    if (problem) throw fail(400, 'VALIDATION_FAILED', problem);
    if (!audienceAllowed(me, body.audience))
      throw forbidden('This audience is outside your messaging scope');
    if (body.announcement && !capabilities(me).announce)
      throw forbidden('You cannot create announcements');
    const options = messageOptionsFor(me);
    const allowedTargets: Record<MessageTarget['kind'], string[]> = {
      department: options.departments.map((entry) => entry.id),
      location: options.locations.map((entry) => entry.id),
      team: options.teams.map((entry) => entry.id),
      member: options.members.map((entry) => entry.id),
      group: options.groups.map((entry) => entry.id),
    };
    if (body.targets.some((target) => !allowedTargets[target.kind].includes(target.id)))
      throw forbidden('A recipient is outside your messaging scope');
    const recipients = recipientsOf(me, body);
    if (recipients.length === 0)
      throw fail(400, 'VALIDATION_FAILED', 'No one can receive this message yet');
    const reach: Record<MessageChannel, (member: StoredMember) => boolean> = {
      IN_APP: (member) => member.status === 'ACTIVE',
      EMAIL: () => true,
      SMS: (member) => Boolean(member.phone),
    };
    store.next.message += 1;
    const id = uuid('7e03', store.next.message);
    store.messages.push({
      ...structuredClone(body),
      id,
      senderId: me.record.id,
      recipientIds: recipients.map((member) => member.id),
      sentAt: new Date().toISOString(),
    });
    return {
      id,
      recipients: recipients.length,
      channels: body.channels.map((channel) => {
        const sent = recipients.filter(reach[channel]).length;
        return { channel, sent, unavailable: recipients.length - sent };
      }),
      announcement: body.announcement,
    };
  },
};

/** An empty save body, for the add form. */
export const blankMember = (): SaveTeamMember => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  jobTitle: '',
  departmentId: '',
  roleId: '',
  reportsToId: '',
  locationId: '',
  teamId: '',
  scope: '',
  status: 'PENDING_INVITATION',
  permissions: {},
  invite: { email: true, sms: false },
});

/** The edit form's starting values from a member. */
export const memberToSave = (member: AdminTeamMember): SaveTeamMember => ({
  firstName: member.firstName,
  lastName: member.lastName,
  email: member.email,
  phone: member.phone ?? '',
  jobTitle: member.jobTitle,
  departmentId: member.departmentId,
  roleId: member.roleId,
  reportsToId: member.reportsTo?.id ?? '',
  locationId: member.locationId ?? '',
  teamId: member.teamId ?? '',
  scope: member.scope,
  status: member.status,
  permissions: structuredClone(member.permissions),
  invite: { email: false, sms: false },
});

/** Module ids in the add form's two columns. */
export const MODULE_ORDER: ModuleKey[][] = [
  ['dashboard', 'sales', 'crm', 'pipeline', 'subscriptions', 'billing'],
  ['team', 'support', 'reports', 'notifications', 'audit', 'settings'],
];
