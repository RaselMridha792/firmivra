import {
  ApiRequestError,
  ConfirmStaffDocumentUploadRequest,
  CreateCustomRoleRequest,
  CreateDepartmentRequest,
  CreateStaffDocumentUploadRequest,
  CreateStaffRequest,
  CreateStaffTeamRequest,
  DEFAULT_ROLE_PERMISSIONS,
  type Department,
  DepartmentListQuery,
  type DepartmentsClient,
  FIRM_ROLE_LABELS,
  FIRM_ROLE_ORDER,
  FIRM_ROLES,
  type InvitationOutcome,
  LockStaffRequest,
  type MembershipRole,
  parseInput,
  PermissionCapability,
  type PermissionCell,
  type PermissionGrant,
  PermissionModule,
  type RolesClient,
  ROLES_MANAGED_BY,
  SaveRolePermissionsRequest,
  SaveStaffDraftRequest,
  SetStaffNoteRequest,
  SetStaffOverridesRequest,
  SetStaffPermissionsRequest,
  SetStaffTeamMembersRequest,
  StaffAccessInput,
  type StaffActionResult,
  type StaffActivityItem,
  type StaffClient,
  type StaffCompensation,
  StaffCompensationInput,
  StaffCursorQuery,
  type StaffDetail,
  type StaffDocument,
  type StaffDraft,
  StaffListQuery,
  type StaffListItem,
  type StaffLoginEvent,
  type StaffNote,
  type StaffRef,
  StaffSecurityActionRequest,
  type StaffSecurity,
  type StaffSessionItem,
  type StaffTeam,
  StaffTeamListQuery,
  type TeamMemberKind,
  UpdateCustomRoleRequest,
  UpdateDepartmentRequest,
  UpdateStaffDocumentRequest,
  UpdateStaffRequest,
  UpdateStaffTeamRequest,
  StaffImportPreviewRequest,
  StaffImportRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.staff`, `api.departments` and `api.roles` (R42 contract, Staff Management).
 * Synthetic people only (invented names, @lvp.test emails). One in-memory store behind all three,
 * so a member created in Create Staff shows in the directory, its department's counts and the
 * org chart. It checks input with the contract's schemas and answers the API's error codes:
 * STAFF gets 403 FORBIDDEN everywhere; ADMIN acts only on the roles ROLES_MANAGED_BY gives it;
 * nobody changes themselves; the last active owner is protected; `fail-invite` in an email makes
 * the invitation FAILED (to build the "created, invite failed" state).
 * `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=staff) starts with only the signed-in owner, no
 * departments, teams or drafts: the empty states.
 */

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const uuid = (block: string, n: number) =>
  `0199c0a0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const forbidden = () => fail(403, 'FORBIDDEN', 'This action is not permitted');
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const day = (iso: string) => iso.slice(0, 10);

interface Member {
  detail: StaffDetail;
  security: StaffSecurity;
  compensation: StaffCompensation;
  sessions: StaffSessionItem[];
  logins: StaffLoginEvent[];
  activity: StaffActivityItem[];
  /** Member overrides: `${module}:${capability}` -> granted. */
  overrides: Map<string, boolean>;
  documents: StaffDocument[];
}

/** A firm's own role (Create Custom Role): its whole grid, `${module}:${capability}`. */
interface MockCustomRole {
  id: string;
  name: string;
  description: string | null;
  basedOn: MembershipRole;
  archivedAt: string | null;
  updatedAt: string;
  grid: Map<string, boolean>;
}

interface Store {
  members: Member[];
  customRoles: MockCustomRole[];
  departments: Department[];
  teams: StaffTeam[];
  /** teamId -> membershipId -> kind */
  teamMembers: Map<string, Map<string, TeamMemberKind>>;
  roleOverrides: Map<MembershipRole, Map<string, boolean>>;
  drafts: StaffDraft[];
  created: Map<string, string>;
  uploads: Map<string, { memberId: string; body: CreateStaffDocumentUploadRequest }>;
  imports: Map<string, { create: number; update: number }>;
  next: number;
}

const DEPARTMENTS: [string, string][] = [
  ['Tax', 'Individual and business tax preparation, planning and notices.'],
  ['Bookkeeping', 'Monthly books, reconciliations and reports.'],
  ['Payroll', 'Payroll runs, filings and year-end forms.'],
  ['Client Services', 'Front desk, scheduling and client questions.'],
  ['Administration', 'Firm operations and staff administration.'],
  ['Marketing', 'Campaigns, website and referrals.'],
  ['Human Resources', 'Hiring, onboarding and staff records.'],
];

/** name, role, status, job title, departments (index), access level */
const PEOPLE: [
  string,
  MembershipRole,
  StaffDetail['status'],
  string,
  number[],
  StaffDetail['accessLevel'],
][] = [
  ['Morgan Avery', 'OWNER', 'ACTIVE', 'Owner / CEO', [4], 'ADMINISTRATOR'],
  ['Priya Ramos', 'ADMIN', 'ACTIVE', 'Operations Manager', [4], 'ADMINISTRATOR'],
  ['Daniel Okafor', 'TAX_PREPARER', 'ACTIVE', 'Tax Preparer', [0], 'STANDARD_USER'],
  ['Lena Fischer', 'MANAGER', 'ACTIVE', 'Tax Manager', [0], 'MANAGER'],
  ['Marcus Bell', 'BOOKKEEPER', 'ACTIVE', 'Bookkeeper', [1], 'STANDARD_USER'],
  ['Hana Kim', 'STAFF', 'ACTIVE', 'Payroll & Accounting Specialist', [2, 1], 'STANDARD_USER'],
  ['Theo Grant', 'CLIENT_SUPPORT', 'ACTIVE', 'Client Service Specialist', [3], 'STANDARD_USER'],
  ['Rosa Delgado', 'STAFF', 'ACTIVE', 'Payroll Specialist', [2], 'STANDARD_USER'],
  ['Iris Novak', 'READ_ONLY', 'LOCKED', 'Intern', [0], 'STANDARD_USER'],
  ['Sam Whitley', 'TAX_PREPARER', 'INVITED', 'Tax Preparer', [0], 'STANDARD_USER'],
  ['Victor Lane', 'STAFF', 'DEACTIVATED', 'Marketing Coordinator', [5], 'STANDARD_USER'],
];

const ref = (m: Member): StaffRef => ({
  id: m.detail.id,
  userId: m.detail.userId,
  name: m.detail.name,
  jobTitle: m.detail.jobTitle,
  avatarUrl: null,
});

function baseSecurity(
  status: StaffDetail['status'],
  role: MembershipRole,
  level: StaffDetail['accessLevel'],
): StaffSecurity {
  return {
    status,
    accessLevel: level,
    role,
    lastLogin: null,
    mfaRequired: true,
    mfa: status === 'INVITED' ? 'PENDING' : 'ENABLED',
    passwordChangedAt: null,
    requirePasswordChange: true,
    allowedAuthMethods: ['AUTHENTICATOR_APP', 'SMS', 'EMAIL', 'BACKUP_CODES'],
    restrictDevices: false,
    autoLogoutMinutes: 30,
    disableOn: null,
    accessLocation: 'ANYWHERE',
    allowedIps: [],
    allowedCountries: [],
    maxConcurrentSessions: 1,
    signOutOtherSessions: false,
    allowTrustedDevices: false,
    recoveryEmail: null,
    recoveryEmailVerified: false,
    notices: {
      newDeviceLogin: true,
      failedLogins: true,
      passwordChanges: true,
      securityAlerts: true,
      lockouts: true,
    },
    lockedAt: null,
    lockedReason: null,
  };
}

const emptyComp = (): StaffCompensation => ({
  payType: null,
  rateCents: null,
  payFrequency: null,
  commission: null,
  payrollId: null,
  updatedAt: null,
});

function seed(empty: boolean): Store {
  const s: Store = {
    members: [],
    customRoles: [],
    departments: [],
    teams: [],
    teamMembers: new Map(),
    roleOverrides: new Map(),
    drafts: [],
    created: new Map(),
    uploads: new Map(),
    imports: new Map(),
    next: 100,
  };
  const people = empty ? PEOPLE.slice(0, 1) : PEOPLE;
  const departments = empty ? [] : DEPARTMENTS;
  departments.forEach(([name, description], i) => {
    s.departments.push({
      id: uuid('0d00', i + 1),
      name,
      description,
      head: null,
      teamCount: 0,
      staffCount: 0,
      status: name === 'Human Resources' ? 'INACTIVE' : 'ACTIVE',
      createdAt: '2024-01-12T14:00:00.000Z',
    });
  });

  people.forEach(([name, role, status, jobTitle, depts, level], i) => {
    const n = i + 1;
    const [firstName = name, ...rest] = name.split(' ');
    const joined = `2024-0${(i % 9) + 1}-15T14:00:00.000Z`;
    const lastLoginAt =
      status === 'ACTIVE'
        ? `2026-10-${String(14 - (i % 6)).padStart(2, '0')}T13:${String(10 + i).padStart(2, '0')}:00.000Z`
        : null;
    const security = baseSecurity(status, role, level);
    if (lastLoginAt) {
      security.lastLogin = {
        at: lastLoginAt,
        device: 'Chrome on macOS',
        place: 'Springfield, GA, USA',
      };
      security.passwordChangedAt = '2026-08-12T15:00:00.000Z';
      security.requirePasswordChange = false;
    }
    if (status === 'LOCKED') {
      security.lockedAt = '2026-10-10T16:00:00.000Z';
      security.lockedReason = 'Too many failed sign-in attempts';
    }
    const detail: StaffDetail = {
      id: uuid('0a00', n),
      userId: uuid('0b00', n),
      name,
      firstName,
      lastName: rest.join(' '),
      email: `${firstName.toLowerCase()}.${(rest.at(-1) ?? 'staff').toLowerCase()}@lvp.test`,
      phone: `(555) 010-${String(100 + n).padStart(4, '0')}`,
      avatarUrl: null,
      role,
      status,
      jobTitle,
      departments: depts
        .map((d) => s.departments[d])
        .filter((d): d is Department => d !== undefined)
        .map((d) => ({ id: d.id, name: d.name })),
      serviceAreas: role === 'BOOKKEEPER' ? ['BOOKKEEPING'] : [],
      accessLevel: level,
      accessStartsOn: null,
      memberSince: joined,
      profile: {
        employmentType: i % 4 === 3 ? 'FORM_1099' : 'W2',
        workSchedule: 'Full-Time',
        office: i % 2 ? 'Riverside Office' : 'Main Office',
        hireDate: day(joined),
        endDate: null,
        supervisor: null,
        timeZone: 'America/New_York',
        employeeId: `EMP${String(n).padStart(3, '0')}`,
        primaryTeam: null,
        backupTeam: null,
        primarySpecialty: role === 'TAX_PREPARER' ? 'TAX_PREPARATION' : null,
        maxWorkload: role === 'OWNER' ? null : 40,
        acceptsNewClients: status === 'ACTIVE',
      },
      mfa: security.mfa,
      lastLogin: security.lastLogin,
      invite:
        status === 'INVITED'
          ? { sentAt: '2026-10-12T14:00:00.000Z', expiresAt: '2026-10-19T14:00:00.000Z' }
          : null,
      notes:
        n === 6
          ? {
              text: 'Handles payroll processing and client bookkeeping. Cross-trained on invoicing.',
              updatedAt: '2026-09-20T15:00:00.000Z',
              updatedBy: 'Morgan Avery',
            }
          : null,
      isYou: false,
      version: 'v1',
    };
    s.members.push({
      detail,
      security,
      compensation:
        i === 0
          ? emptyComp()
          : {
              payType: i % 3 === 0 ? 'HOURLY' : 'SALARY',
              rateCents: i % 3 === 0 ? 3_500 : 6_200_000,
              payFrequency: 'BIWEEKLY',
              commission: null,
              payrollId: `PR${String(n).padStart(3, '0')}`,
              updatedAt: joined,
            },
      sessions: lastLoginAt
        ? [
            {
              id: uuid('0c00', n * 10 + 1),
              device: 'MacBook Pro / Chrome',
              place: 'Springfield, GA, USA',
              ip: '203.0.113.12',
              createdAt: lastLoginAt,
              lastActiveAt: lastLoginAt,
              activeNow: n === 1,
            },
            {
              id: uuid('0c00', n * 10 + 2),
              device: 'iPhone / Safari',
              place: 'Springfield, GA, USA',
              ip: '203.0.113.12',
              createdAt: '2026-10-09T21:32:00.000Z',
              lastActiveAt: '2026-10-09T21:32:00.000Z',
              activeNow: false,
            },
          ]
        : [],
      logins: lastLoginAt
        ? [0, 1, 2, 3, 4].map((k) => ({
            at: `2026-10-${String(14 - k).padStart(2, '0')}T13:14:00.000Z`,
            outcome: k === 4 ? ('FAILED' as const) : ('SUCCESS' as const),
            place: k === 2 ? 'Riverton, NC, USA' : 'Springfield, GA, USA',
            ip: k === 2 ? '198.51.100.76' : '203.0.113.12',
            device:
              ['Chrome / Mac', 'Safari / iPhone', 'Edge / Windows', 'Chrome / Mac', 'Chrome / Mac'][
                k
              ] ?? null,
          }))
        : [],
      activity: lastLoginAt
        ? [
            ['auth.signed_in', 'Logged in (Web)'],
            ['client.viewed', 'Viewed client records'],
            ['payroll.entry_created', 'Created payroll entry'],
            ['document.updated', 'Updated client file'],
            ['auth.signed_out', 'Logged out'],
          ].map(([action, label], k) => ({
            id: uuid('0e00', n * 10 + k),
            at: `2026-10-${String(14 - k).padStart(2, '0')}T13:14:00.000Z`,
            action: action ?? '',
            label: label ?? '',
            actorName: null,
          }))
        : [],
      overrides: new Map(),
      documents:
        n === 6
          ? (
              [
                ['EMPLOYMENT_AGREEMENT', 'Hana_Kim_Agreement.pdf'],
                ['W4', 'Hana_Kim_W4.pdf'],
                ['DIRECT_DEPOSIT', 'Hana_Kim_DD.pdf'],
                ['OTHER', 'Training_Certificate.pdf'],
              ] as const
            ).map(([type, fileName], k) => ({
              id: uuid('0f00', k + 1),
              type,
              fileName,
              contentType: 'application/pdf',
              sizeBytes: 182_000 + k * 1000,
              scanStatus: 'CLEAN' as const,
              uploadedBy: 'Morgan Avery',
              createdAt: '2026-09-29T14:00:00.000Z',
              archivedAt: null,
            }))
          : [],
    });
  });

  // Supervisors: everyone reports to the owner; department staff to their manager.
  const owner = s.members[0];
  for (const m of s.members.slice(1)) {
    const boss =
      m.detail.departments[0]?.name === 'Tax' && m.detail.role !== 'MANAGER' ? s.members[3] : owner;
    m.detail.profile.supervisor = boss ? ref(boss) : null;
  }

  // Heads and teams.
  const heads = [3, 4, 5, 6, 0, 10, 1];
  s.departments.forEach((d, i) => {
    const head = s.members[heads[i] ?? 0];
    d.head = head ? ref(head) : null;
  });
  const TEAMS: [string, number][] = [
    ['Individual Tax', 0],
    ['Business Tax', 0],
    ['Tax Advisory', 0],
    ['Monthly Books', 1],
    ['Cleanup Projects', 1],
    ['Payroll Runs', 2],
    ['Year-End Forms', 2],
    ['Front Desk', 3],
    ['Scheduling', 3],
    ['Operations', 4],
    ['Campaigns', 5],
  ];
  TEAMS.forEach(([name, d], i) => {
    const dept = s.departments[d];
    if (!dept) return;
    s.teams.push({
      id: uuid('0d10', i + 1),
      name,
      description: null,
      department: { id: dept.id, name: dept.name },
      lead: dept.head,
      memberCount: 0,
      status: 'ACTIVE',
      createdAt: '2024-01-12T14:00:00.000Z',
    });
    s.teamMembers.set(uuid('0d10', i + 1), new Map());
  });
  // Primary team: the first team of the member's first department.
  for (const m of s.members) {
    const dept = m.detail.departments[0];
    const team = s.teams.find((t) => t.department.id === dept?.id);
    if (!team) continue;
    s.teamMembers.get(team.id)?.set(m.detail.id, 'PRIMARY');
    m.detail.profile.primaryTeam = { id: team.id, name: team.name };
  }
  if (!empty) {
    s.drafts.push({
      id: uuid('0d20', 1),
      step: 2,
      data: { account: { firstName: 'Nora', lastName: 'Ellison', email: 'nora.ellison@lvp.test' } },
      createdBy: 'Morgan Avery',
      createdAt: '2026-10-13T15:00:00.000Z',
      updatedAt: '2026-10-13T15:20:00.000Z',
    });
  }
  return s;
}

let stores: Map<string, Store> | undefined;
/** One store per (role, empty), shared by api.staff, api.departments and api.roles. */
function storeFor(options: Options): Store {
  const key = `${options.role ?? 'OWNER'}:${options.empty ? 'empty' : 'full'}`;
  stores ??= new Map();
  let s = stores.get(key);
  if (!s) {
    s = seed(options.empty ?? false);
    const youIndex = options.role === 'ADMIN' ? 1 : options.role === 'STAFF' ? 2 : 0;
    const you = s.members[youIndex] ?? s.members[0];
    if (you) you.detail.isYou = true;
    stores.set(key, s);
  }
  return s;
}

/** Counts that follow the rows: department staff and team counts, team member counts. */
function recount(s: Store) {
  for (const d of s.departments) {
    d.staffCount = s.members.filter(
      (m) => m.detail.status !== 'DEACTIVATED' && m.detail.departments.some((x) => x.id === d.id),
    ).length;
    d.teamCount = s.teams.filter((t) => t.department.id === d.id && t.status !== 'ARCHIVED').length;
  }
  for (const t of s.teams) t.memberCount = s.teamMembers.get(t.id)?.size ?? 0;
}

const key = (module: string, capability: string) => `${module}:${capability}`;

function cellsFor(s: Store, role: MembershipRole, member?: Member): PermissionCell[] {
  // A custom role's whole grid stands in for the role's (as the API reads it).
  const custom = s.customRoles.find((c) => c.id === member?.detail.customRole?.id);
  const roleRows = custom?.grid ?? s.roleOverrides.get(role);
  const cells: PermissionCell[] = [];
  for (const mod of PermissionModule.options) {
    for (const capability of PermissionCapability.options) {
      const k = key(mod, capability);
      let granted = DEFAULT_ROLE_PERMISSIONS[role][mod]?.includes(capability) ?? false;
      let source: PermissionCell['source'] = 'ROLE_DEFAULT';
      if (roleRows?.has(k)) {
        granted = roleRows.get(k) ?? granted;
        source = 'FIRM_ROLE';
      }
      if (member?.overrides.has(k)) {
        granted = member.overrides.get(k) ?? granted;
        source = 'MEMBER';
      }
      cells.push({ module: mod, capability, granted, source });
    }
  }
  return cells;
}

/** Edit and the others need View; Owner is locked. */
function checkGrants(grants: readonly PermissionGrant[]) {
  const on = new Set(grants.filter((g) => g.granted).map((g) => key(g.module, g.capability)));
  for (const g of grants) {
    if (g.granted && g.capability !== 'VIEW' && !on.has(key(g.module, 'VIEW'))) {
      throw fail(400, 'PERMISSION_NEEDS_VIEW', 'Give View first in this module');
    }
  }
}

function toListItem(m: Member): StaffListItem {
  const d = m.detail;
  return {
    id: d.id,
    userId: d.userId,
    name: d.name,
    email: d.email,
    avatarUrl: null,
    jobTitle: d.jobTitle,
    departments: d.departments,
    role: d.role,
    customRole: d.customRole ?? null,
    accessLevel: d.accessLevel,
    status: d.status,
    lastLoginAt: d.lastLogin?.at ?? null,
    mfa: d.mfa,
    invite: d.invite,
    isYou: d.isYou,
  };
}

const STATUS_OF = {
  active: 'ACTIVE',
  inactive: 'DEACTIVATED',
  invited: 'INVITED',
  locked: 'LOCKED',
} as const;

/** Shared by api.staff and api.users (Settings > Users & Roles): filter, sort, page. */
export function listStaffRows(
  options: Options,
  q: {
    search?: string;
    status?: string;
    role?: MembershipRole;
    customRoleId?: string;
    departmentId?: string;
  },
): StaffListItem[] {
  const s = storeFor(options);
  const search = q.search?.toLowerCase() ?? '';
  return s.members
    .filter((m) => {
      const d = m.detail;
      if (
        search &&
        ![
          d.name,
          d.email,
          d.jobTitle ?? '',
          FIRM_ROLE_LABELS[d.role],
          d.customRole?.name ?? '',
        ].some((t) => t.toLowerCase().includes(search))
      ) {
        return false;
      }
      if (q.customRoleId && d.customRole?.id !== q.customRoleId) return false;
      if (
        q.status &&
        q.status !== 'all' &&
        d.status !== STATUS_OF[q.status as keyof typeof STATUS_OF]
      )
        return false;
      if (q.role && d.role !== q.role) return false;
      if (q.departmentId && !d.departments.some((x) => x.id === q.departmentId)) return false;
      return true;
    })
    .sort(
      (a, b) =>
        FIRM_ROLE_ORDER[a.detail.role] - FIRM_ROLE_ORDER[b.detail.role] ||
        a.detail.name.localeCompare(b.detail.name),
    )
    .map(toListItem);
}

/** The firm's live custom roles (Users & Roles' Roles count). */
export function liveCustomRoles(options: Options): number {
  return storeFor(options).customRoles.filter((c) => !c.archivedAt).length;
}

/** Counts for Settings > Users & Roles. */
export function staffCounts(options: Options) {
  const s = storeFor(options);
  const month = now().slice(0, 7);
  return {
    total: s.members.filter((m) => m.detail.status !== 'DEACTIVATED').length,
    addedThisMonth: s.members.filter((m) =>
      (m.detail.invite?.sentAt ?? m.detail.memberSince).startsWith(month),
    ).length,
    active: s.members.filter((m) => m.detail.status === 'ACTIVE').length,
    invited: s.members.filter((m) => m.detail.status === 'INVITED').length,
    roles: new Set(s.members.map((m) => m.detail.role)).size,
  };
}

/** Adds an invited member (Invite User in Settings uses the same rows). */
export function addInvitedMember(
  options: Options,
  input: {
    name: string;
    email: string;
    role: MembershipRole;
    departmentIds?: string[];
    jobTitle?: string | null;
  },
): { member: StaffDetail; invitation: InvitationOutcome } {
  const s = storeFor(options);
  const email = input.email.toLowerCase();
  if (
    s.members.some(
      (m) => m.detail.email.toLowerCase() === email && m.detail.status !== 'DEACTIVATED',
    )
  ) {
    throw fail(409, 'DUPLICATE_EMAIL', 'Someone at this firm already uses this email');
  }
  const n = s.next++;
  const [firstName = input.name, ...rest] = input.name.split(' ');
  const sentAt = now();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const failed = email.includes('fail-invite');
  const detail: StaffDetail = {
    id: uuid('0a00', n),
    userId: uuid('0b00', n),
    name: input.name,
    firstName,
    lastName: rest.join(' '),
    email,
    phone: null,
    avatarUrl: null,
    role: input.role,
    status: 'INVITED',
    jobTitle: input.jobTitle ?? null,
    departments: s.departments
      .filter((d) => input.departmentIds?.includes(d.id))
      .map((d) => ({ id: d.id, name: d.name })),
    serviceAreas: [],
    accessLevel: 'STANDARD_USER',
    accessStartsOn: null,
    memberSince: sentAt,
    profile: {
      employmentType: null,
      workSchedule: null,
      office: null,
      hireDate: null,
      endDate: null,
      supervisor: null,
      timeZone: 'America/New_York',
      employeeId: null,
      primaryTeam: null,
      backupTeam: null,
      primarySpecialty: null,
      maxWorkload: null,
      acceptsNewClients: true,
    },
    mfa: 'PENDING',
    lastLogin: null,
    invite: failed ? null : { sentAt, expiresAt },
    notes: null,
    isYou: false,
    version: 'v1',
  };
  s.members.push({
    detail,
    security: baseSecurity('INVITED', input.role, 'STANDARD_USER'),
    compensation: emptyComp(),
    sessions: [],
    logins: [],
    activity: [],
    overrides: new Map(),
    documents: [],
  });
  recount(s);
  return {
    member: copy(detail),
    invitation: failed
      ? { status: 'FAILED', sentAt: null, expiresAt: null }
      : { status: 'SENT', sentAt, expiresAt },
  };
}

function guard(options: Options) {
  const role = options.role ?? 'OWNER';
  const s = storeFor(options);
  const allowed = async () => {
    await mockDelay();
    if (role === 'STAFF') throw forbidden();
  };
  const find = (id: string) => {
    const m = s.members.find((x) => x.detail.id === id);
    if (!m) throw notFound();
    return m;
  };
  /** The actor manages the target's role, and is not the target. */
  const manageable = (m: Member) => {
    if (m.detail.isYou) throw fail(409, 'CANNOT_CHANGE_SELF', 'You cannot change your own access');
    if (!ROLES_MANAGED_BY[role].includes(m.detail.role)) throw forbidden();
  };
  const keepsAnOwner = (m: Member) => {
    const others = s.members.filter(
      (x) => x !== m && x.detail.role === 'OWNER' && x.detail.status === 'ACTIVE',
    );
    if (m.detail.role === 'OWNER' && m.detail.status === 'ACTIVE' && others.length === 0) {
      throw fail(409, 'LAST_ACTIVE_OWNER', 'The firm needs at least one active owner');
    }
  };
  const bump = (m: Member) => {
    m.detail.version = `v${Number(m.detail.version.slice(1)) + 1}`;
  };
  const setStatus = (m: Member, status: StaffDetail['status']) => {
    m.detail.status = status;
    m.security.status = status;
    bump(m);
  };
  const result = (
    m: Member,
    sessionsRevoked = 0,
    invitation: StaffActionResult['invitation'] = null,
  ): StaffActionResult => ({
    ok: true,
    status: m.detail.status,
    sessionsRevoked,
    invitation,
  });
  const signOut = (m: Member) => {
    const n = m.sessions.length;
    m.sessions = [];
    return n;
  };
  return { role, s, allowed, find, manageable, keepsAnOwner, bump, setStatus, result, signOut };
}

/** `api.staff` in mock mode. */
export function createStaffMock(options: Options = {}): StaffClient {
  const g = guard(options);
  const { s } = g;
  const ownerOrAdmin = () => {
    if (g.role !== 'OWNER' && g.role !== 'ADMIN') throw forbidden();
  };

  return {
    list: async (query = {}) => {
      await g.allowed();
      const q = parseInput(StaffListQuery, query);
      const rows = listStaffRows(options, q);
      const start = (q.page - 1) * q.pageSize;
      return {
        items: rows.slice(start, start + q.pageSize),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    summary: async () => {
      await g.allowed();
      const c = staffCounts(options);
      return {
        total: s.members.length,
        addedThisMonth: c.addedThisMonth,
        active: c.active,
        inactive: s.members.filter((m) => m.detail.status === 'DEACTIVATED').length,
        invited: c.invited,
        locked: s.members.filter((m) => m.detail.status === 'LOCKED').length,
        departments: s.departments.filter((d) => d.status === 'ACTIVE').length,
      };
    },
    options: async () => {
      await g.allowed();
      return {
        departments: s.departments
          .filter((d) => d.status === 'ACTIVE')
          .map((d) => ({ id: d.id, name: d.name })),
        teams: s.teams
          .filter((t) => t.status === 'ACTIVE')
          .map((t) => ({ id: t.id, name: t.name, departmentId: t.department.id })),
        managers: s.members.filter((m) => m.detail.status === 'ACTIVE').map(ref),
        roles: ROLES_MANAGED_BY[g.role].map((r) => ({
          role: r,
          label: FIRM_ROLE_LABELS[r],
          description: ROLE_DESCRIPTIONS[r],
        })),
        customRoles: s.customRoles
          .filter((c) => !c.archivedAt && ROLES_MANAGED_BY[g.role].includes(c.basedOn))
          .map((c) => ({ id: c.id, name: c.name, basedOn: c.basedOn, description: c.description })),
        jobTitles: [
          ...new Set(s.members.map((m) => m.detail.jobTitle).filter((t): t is string => !!t)),
        ].sort(),
        offices: ['Main Office', 'Riverside Office'],
        workSchedules: ['Full-Time', 'Part-Time', 'Mon-Thu', 'Seasonal'],
        serviceAreas: [
          { code: 'TAX_PREPARATION', label: 'Tax Preparation' },
          { code: 'TAX_PLANNING', label: 'Tax Planning' },
          { code: 'BOOKKEEPING', label: 'Bookkeeping' },
          { code: 'PAYROLL', label: 'Payroll' },
          { code: 'BUSINESS_ADVISORY', label: 'Business Advisory' },
        ],
      };
    },

    get: async (id) => {
      await g.allowed();
      const m = g.find(id);
      return copy({
        ...m.detail,
        notes: g.role === 'OWNER' || g.role === 'ADMIN' ? m.detail.notes : null,
      });
    },
    create: async (body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(CreateStaffRequest, body);
      const seen = s.created.get(input.idempotencyKey);
      if (seen) {
        const m = g.find(seen);
        return {
          staff: copy(m.detail),
          invitation: {
            status: 'SENT',
            sentAt: m.detail.invite?.sentAt ?? null,
            expiresAt: m.detail.invite?.expiresAt ?? null,
          },
        };
      }
      if (!ROLES_MANAGED_BY[g.role].includes(input.account.role))
        throw fail(403, 'CANNOT_GRANT', 'You cannot give this role');
      if (input.permissions) checkGrants(input.permissions);
      const { member, invitation } = addInvitedMember(options, {
        name: `${input.account.firstName} ${input.account.lastName}`,
        email: input.account.email,
        role: input.account.role,
        departmentIds: input.account.departmentIds,
        jobTitle: input.account.jobTitle,
      });
      const m = g.find(member.id);
      m.detail.phone = input.account.phone ?? null;
      m.detail.serviceAreas = input.account.serviceAreas ?? [];
      m.detail.accessLevel = input.account.accessLevel ?? 'STANDARD_USER';
      if (input.details?.employmentType !== undefined)
        m.detail.profile.employmentType = input.details.employmentType;
      if (input.details?.hireDate !== undefined) m.detail.profile.hireDate = input.details.hireDate;
      if (input.details?.office !== undefined) m.detail.profile.office = input.details.office;
      if (input.compensation)
        Object.assign(m.compensation, input.compensation, { updatedAt: now() });
      if (!input.sendWelcomeEmail) m.detail.invite = null;
      for (const p of input.permissions ?? [])
        m.overrides.set(key(p.module, p.capability), p.granted);
      s.created.set(input.idempotencyKey, m.detail.id);
      if (input.draftId) s.drafts = s.drafts.filter((d) => d.id !== input.draftId);
      return {
        staff: copy(m.detail),
        invitation: input.sendWelcomeEmail
          ? invitation
          : { status: 'NOT_SENT', sentAt: null, expiresAt: null },
      };
    },
    update: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(UpdateStaffRequest, body);
      const m = g.find(id);
      g.manageable(m);
      if (input.version !== m.detail.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this member first');
      const a = input.account;
      // A custom role brings the role it is based on; a new role alone takes it away (as the API).
      const custom = a?.customRoleId
        ? s.customRoles.find((c) => c.id === a.customRoleId)
        : undefined;
      if (a?.customRoleId && !custom) throw notFound();
      if (custom?.archivedAt)
        throw fail(409, 'CUSTOM_ROLE_ARCHIVED', 'This role is archived and can no longer be given');
      if (custom && a?.role && a.role !== custom.basedOn)
        throw fail(400, 'CUSTOM_ROLE_MISMATCH', 'The role must be the one it is based on');
      const before = m.detail.role;
      const role = custom?.basedOn ?? a?.role ?? before;
      if (role !== before || (custom && custom.id !== m.detail.customRole?.id)) {
        if (!ROLES_MANAGED_BY[g.role].includes(role))
          throw fail(403, 'CANNOT_GRANT', 'You cannot give this role');
      }
      if (role !== before) {
        if (role !== 'OWNER') g.keepsAnOwner(m);
        m.detail.role = role;
      }
      if (custom) m.detail.customRole = { id: custom.id, name: custom.name };
      else if (a?.customRoleId === null || role !== before) m.detail.customRole = null;
      if (a?.firstName || a?.lastName) {
        m.detail.firstName = a.firstName ?? m.detail.firstName;
        m.detail.lastName = a.lastName ?? m.detail.lastName;
        m.detail.name = `${m.detail.firstName} ${m.detail.lastName}`.trim();
      }
      if (a?.email) m.detail.email = a.email;
      if (a?.phone !== undefined) m.detail.phone = a.phone;
      if (a?.jobTitle) m.detail.jobTitle = a.jobTitle;
      if (a?.serviceAreas) m.detail.serviceAreas = a.serviceAreas;
      if (a?.accessLevel) m.detail.accessLevel = a.accessLevel;
      if (a?.accessStartsOn !== undefined) m.detail.accessStartsOn = a.accessStartsOn;
      if (a?.departmentIds) {
        m.detail.departments = s.departments
          .filter((d) => a.departmentIds?.includes(d.id))
          .map((d) => ({ id: d.id, name: d.name }));
      }
      const d = input.details;
      if (d) {
        const p = m.detail.profile;
        if (d.employmentType !== undefined) p.employmentType = d.employmentType;
        if (d.workSchedule !== undefined) p.workSchedule = d.workSchedule;
        if (d.office !== undefined) p.office = d.office;
        if (d.hireDate !== undefined) p.hireDate = d.hireDate;
        if (d.endDate !== undefined) p.endDate = d.endDate;
        if (d.timeZone !== undefined) p.timeZone = d.timeZone;
        if (d.employeeId !== undefined) p.employeeId = d.employeeId;
        if (d.primarySpecialty !== undefined) p.primarySpecialty = d.primarySpecialty;
        if (d.maxWorkload !== undefined) p.maxWorkload = d.maxWorkload;
        if (d.acceptsNewClients !== undefined) p.acceptsNewClients = d.acceptsNewClients;
        if (d.supervisorId !== undefined) {
          const boss = d.supervisorId ? g.find(d.supervisorId) : null;
          p.supervisor = boss ? ref(boss) : null;
        }
        for (const [field, kind] of [
          ['primaryTeamId', 'primaryTeam'],
          ['backupTeamId', 'backupTeam'],
        ] as const) {
          const teamId = d[field];
          if (teamId === undefined) continue;
          const team = teamId ? s.teams.find((t) => t.id === teamId) : null;
          if (teamId && !team) throw notFound();
          p[kind] = team ? { id: team.id, name: team.name } : null;
        }
      }
      g.bump(m);
      recount(s);
      return copy(m.detail);
    },

    security: async (id) => {
      await g.allowed();
      return copy(g.find(id).security);
    },
    updateSecurity: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(StaffAccessInput, body);
      const m = g.find(id);
      g.manageable(m);
      const { notices, recoveryEmail, ...rest } = input;
      Object.assign(m.security, rest);
      if (notices) m.security.notices = notices;
      if (recoveryEmail !== undefined) {
        m.security.recoveryEmail = recoveryEmail;
        m.security.recoveryEmailVerified = false;
      }
      return copy(m.security);
    },
    sessions: async (id) => {
      await g.allowed();
      return copy(g.find(id).sessions);
    },
    revokeSession: async (id, sessionId) => {
      await g.allowed();
      ownerOrAdmin();
      const m = g.find(id);
      g.manageable(m);
      const before = m.sessions.length;
      m.sessions = m.sessions.filter((x) => x.id !== sessionId);
      if (m.sessions.length === before) throw notFound();
      return g.result(m, 1);
    },
    signOutAll: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      parseInput(StaffSecurityActionRequest, body);
      const m = g.find(id);
      g.manageable(m);
      return g.result(m, g.signOut(m));
    },
    loginHistory: async (id, query = {}) => {
      await g.allowed();
      const q = parseInput(StaffCursorQuery, query);
      return { items: copy(g.find(id).logins.slice(0, q.limit)), nextCursor: null };
    },
    activity: async (id, query = {}) => {
      await g.allowed();
      const q = parseInput(StaffCursorQuery, query);
      return { items: copy(g.find(id).activity.slice(0, q.limit)), nextCursor: null };
    },
    resetPassword: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      parseInput(StaffSecurityActionRequest, body);
      const m = g.find(id);
      g.manageable(m);
      m.security.requirePasswordChange = true;
      return g.result(m, g.signOut(m));
    },
    resetMfa: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      parseInput(StaffSecurityActionRequest, body);
      const m = g.find(id);
      g.manageable(m);
      m.security.mfa = 'PENDING';
      m.detail.mfa = 'PENDING';
      return g.result(m, g.signOut(m));
    },
    lock: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const { reason } = parseInput(LockStaffRequest, body);
      const m = g.find(id);
      g.manageable(m);
      g.keepsAnOwner(m);
      g.setStatus(m, 'LOCKED');
      m.security.lockedAt = now();
      m.security.lockedReason = reason;
      return g.result(m, g.signOut(m));
    },
    unlock: async (id) => {
      await g.allowed();
      ownerOrAdmin();
      const m = g.find(id);
      g.manageable(m);
      if (m.detail.status !== 'LOCKED') throw fail(409, 'NOT_LOCKED', 'This account is not locked');
      g.setStatus(m, 'ACTIVE');
      m.security.lockedAt = null;
      m.security.lockedReason = null;
      return g.result(m);
    },
    deactivate: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      parseInput(StaffSecurityActionRequest, body);
      const m = g.find(id);
      g.manageable(m);
      if (m.detail.status === 'DEACTIVATED') return g.result(m);
      g.keepsAnOwner(m);
      g.setStatus(m, 'DEACTIVATED');
      m.detail.invite = null;
      recount(s);
      return g.result(m, g.signOut(m));
    },
    reactivate: async (id) => {
      await g.allowed();
      ownerOrAdmin();
      const m = g.find(id);
      g.manageable(m);
      if (m.detail.status !== 'DEACTIVATED')
        throw fail(409, 'NOT_DEACTIVATED', 'This account is not deactivated');
      g.setStatus(m, m.detail.lastLogin ? 'ACTIVE' : 'INVITED');
      recount(s);
      return g.result(m);
    },
    resendInvite: async (id) => {
      await g.allowed();
      ownerOrAdmin();
      const m = g.find(id);
      g.manageable(m);
      if (m.detail.status !== 'INVITED')
        throw fail(409, 'NOT_INVITED', 'This person has no open invite');
      const sentAt = now();
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      m.detail.invite = { sentAt, expiresAt };
      return g.result(m, 0, { status: 'SENT', sentAt, expiresAt });
    },
    revokeInvite: async (id) => {
      await g.allowed();
      ownerOrAdmin();
      const m = g.find(id);
      g.manageable(m);
      if (m.detail.status !== 'INVITED')
        throw fail(409, 'NOT_INVITED', 'This person has no open invite');
      m.detail.invite = null;
      g.setStatus(m, 'DEACTIVATED');
      recount(s);
      return g.result(m);
    },

    permissions: async (id) => {
      await g.allowed();
      const m = g.find(id);
      return {
        role: m.detail.role,
        customRole: m.detail.customRole ?? null,
        cells: cellsFor(s, m.detail.role, m),
        updatedAt: null,
      };
    },
    setPermissions: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(SetStaffPermissionsRequest, body);
      const m = g.find(id);
      g.manageable(m);
      checkGrants(input.grants);
      const base = cellsFor(s, m.detail.role);
      const escalates = input.grants.some(
        (gr) =>
          gr.granted &&
          !base.find((c) => c.module === gr.module && c.capability === gr.capability)?.granted,
      );
      if (escalates && !input.acknowledgeEscalation) {
        throw fail(
          409,
          'PERMISSION_ESCALATION',
          'This gives more than the role allows. Confirm to continue.',
        );
      }
      m.overrides.clear();
      for (const gr of input.grants) {
        const def = base.find(
          (c) => c.module === gr.module && c.capability === gr.capability,
        )?.granted;
        if (def !== gr.granted) m.overrides.set(key(gr.module, gr.capability), gr.granted);
      }
      return { role: m.detail.role, cells: cellsFor(s, m.detail.role, m), updatedAt: now() };
    },
    // Inherit, Allow or Deny per cell, as the API does: an Allow is kept even when the role has it.
    setOverrides: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(SetStaffOverridesRequest, body);
      const m = g.find(id);
      g.manageable(m);
      const base = cellsFor(s, m.detail.role);
      const roleHas = (module: string, capability: string) =>
        base.find((c) => c.module === module && c.capability === capability)?.granted ?? false;
      const next = new Map(m.overrides);
      for (const o of input.overrides) {
        const k = key(o.module, o.capability);
        if (o.mode === 'INHERIT') next.delete(k);
        else next.set(k, o.mode === 'ALLOW');
      }
      const has = (module: string, capability: string) =>
        next.get(key(module, capability)) ?? roleHas(module, capability);
      for (const mod of new Set(input.overrides.map((o) => o.module)))
        if (
          PermissionCapability.options.some((c) => c !== 'VIEW' && has(mod, c)) &&
          !has(mod, 'VIEW')
        )
          throw fail(400, 'PERMISSION_NEEDS_VIEW', 'Give View before the other capabilities');
      const escalates = input.overrides.some(
        (o) => o.mode === 'ALLOW' && !roleHas(o.module, o.capability),
      );
      if (escalates && !input.acknowledgeEscalation)
        throw fail(
          409,
          'PERMISSION_ESCALATION',
          'This gives more than the role allows. Confirm to continue.',
        );
      m.overrides.clear();
      for (const [k, v] of next) m.overrides.set(k, v);
      return { role: m.detail.role, cells: cellsFor(s, m.detail.role, m), updatedAt: now() };
    },
    copyPermissions: async (id, fromId) => {
      await g.allowed();
      ownerOrAdmin();
      const m = g.find(id);
      const from = g.find(fromId);
      g.manageable(m);
      m.overrides = new Map(from.overrides);
      return { role: m.detail.role, cells: cellsFor(s, m.detail.role, m), updatedAt: now() };
    },

    note: async (id) => {
      await g.allowed();
      ownerOrAdmin();
      return copy(g.find(id).detail.notes);
    },
    setNote: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const { text } = parseInput(SetStaffNoteRequest, body);
      const m = g.find(id);
      const note: StaffNote | null = text ? { text, updatedAt: now(), updatedBy: 'You' } : null;
      m.detail.notes = note;
      return copy(note);
    },
    compensation: async (id) => {
      await g.allowed();
      ownerOrAdmin();
      return copy(g.find(id).compensation);
    },
    setCompensation: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(StaffCompensationInput, body);
      const m = g.find(id);
      Object.assign(m.compensation, input, { updatedAt: now() });
      return copy(m.compensation);
    },

    documents: async (id) => {
      await g.allowed();
      ownerOrAdmin();
      return copy(g.find(id).documents.filter((d) => !d.archivedAt));
    },
    createDocumentUpload: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(CreateStaffDocumentUploadRequest, body);
      g.find(id);
      const n = s.next++;
      s.uploads.set(`mock-upload-${n}`, { memberId: id, body: input });
      return {
        uploadToken: `mock-upload-${n}`,
        url: `mock:upload/${n}`,
        method: 'PUT',
        headers: { 'content-type': input.contentType },
        expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
      };
    },
    confirmDocumentUpload: async (id, body) => {
      await g.allowed();
      ownerOrAdmin();
      const { uploadToken } = parseInput(ConfirmStaffDocumentUploadRequest, body);
      const pending = s.uploads.get(uploadToken);
      if (!pending || pending.memberId !== id)
        throw fail(400, 'VALIDATION_FAILED', 'Upload the file again');
      s.uploads.delete(uploadToken);
      const m = g.find(id);
      const at = now();
      if (pending.body.replacesId) {
        const old = m.documents.find((d) => d.id === pending.body.replacesId);
        if (old) old.archivedAt = at;
      }
      const doc: StaffDocument = {
        id: uuid('0f00', s.next++),
        type: pending.body.type,
        fileName: pending.body.fileName,
        contentType: pending.body.contentType,
        sizeBytes: pending.body.sizeBytes,
        scanStatus: 'CLEAN',
        uploadedBy: 'You',
        createdAt: at,
        archivedAt: null,
      };
      m.documents.push(doc);
      return copy(doc);
    },
    documentLink: async (id, docId) => {
      await g.allowed();
      ownerOrAdmin();
      const doc = g.find(id).documents.find((d) => d.id === docId);
      if (!doc) throw notFound();
      return {
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(`Mock file: ${doc.fileName}`)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    },
    reclassifyDocument: async (id, docId, body) => {
      await g.allowed();
      ownerOrAdmin();
      const { type } = parseInput(UpdateStaffDocumentRequest, body);
      const doc = g.find(id).documents.find((d) => d.id === docId);
      if (!doc) throw notFound();
      doc.type = type;
      return copy(doc);
    },
    archiveDocument: async (id, docId) => {
      await g.allowed();
      ownerOrAdmin();
      const doc = g.find(id).documents.find((d) => d.id === docId);
      if (!doc) throw notFound();
      doc.archivedAt ??= now();
      return copy(doc);
    },

    drafts: async () => {
      await g.allowed();
      ownerOrAdmin();
      return copy(s.drafts);
    },
    draft: async (draftId) => {
      await g.allowed();
      ownerOrAdmin();
      const d = s.drafts.find((x) => x.id === draftId);
      if (!d) throw notFound();
      return copy(d);
    },
    createDraft: async (body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(SaveStaffDraftRequest, body);
      const at = now();
      const d: StaffDraft = {
        id: uuid('0d20', s.next++),
        step: input.step,
        data: copy(input.data) as Record<string, unknown>,
        createdBy: 'You',
        createdAt: at,
        updatedAt: at,
      };
      s.drafts.push(d);
      return copy(d);
    },
    saveDraft: async (draftId, body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(SaveStaffDraftRequest, body);
      const d = s.drafts.find((x) => x.id === draftId);
      if (!d) throw notFound();
      d.step = input.step;
      d.data = copy(input.data) as Record<string, unknown>;
      d.updatedAt = now();
      return copy(d);
    },
    deleteDraft: async (draftId) => {
      await g.allowed();
      ownerOrAdmin();
      s.drafts = s.drafts.filter((d) => d.id !== draftId);
      return { ok: true };
    },

    importTemplateUrl: () =>
      `data:text/csv;charset=utf-8,${encodeURIComponent('First Name,Last Name,Work Email,Phone,Job Title,Role,Department\n')}`,
    previewImport: async (body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(StaffImportPreviewRequest, body);
      const emailColumn = Object.entries(input.columnMap).find(([, f]) => f === 'email')?.[0];
      const errors = input.rows.flatMap((row, i) => {
        const email = emailColumn ? row[emailColumn] : undefined;
        return email && email.includes('@')
          ? []
          : [{ row: i + 1, field: 'email' as const, message: 'Enter a valid work email' }];
      });
      const existing = new Set(s.members.map((m) => m.detail.email.toLowerCase()));
      const valid = input.rows.filter((_, i) => !errors.some((e) => e.row === i + 1));
      const toUpdate = valid.filter(
        (r) => emailColumn && existing.has((r[emailColumn] ?? '').toLowerCase()),
      ).length;
      const token = `mock-import-${s.next++}`;
      s.imports.set(token, { create: valid.length - toUpdate, update: toUpdate });
      return {
        previewToken: token,
        toCreate: valid.length - toUpdate,
        toUpdate,
        invalid: errors.length,
        errors,
      };
    },
    import: async (body) => {
      await g.allowed();
      ownerOrAdmin();
      const input = parseInput(StaffImportRequest, body);
      const preview = s.imports.get(input.previewToken);
      if (!preview) throw fail(400, 'IMPORT_PREVIEW_EXPIRED', 'Upload the file again');
      s.imports.delete(input.previewToken);
      return {
        created: preview.create,
        updated: preview.update,
        failed: 0,
        invitationsSent: input.sendInvitations ? preview.create : 0,
        errorFileUrl: null,
      };
    },
  };
}

const ROLE_DESCRIPTIONS: Record<MembershipRole, string> = {
  OWNER: 'Full access to everything, including billing, settings and ownership.',
  ADMIN: 'Manages staff, settings and every module except ownership.',
  MANAGER: 'Runs day-to-day work and sees the business modules.',
  STAFF: 'Works on clients, returns, documents and appointments.',
  BOOKKEEPER: 'Keeps the books with the clients and files they need.',
  TAX_PREPARER:
    'Can prepare and manage tax returns, access client information, and view related documents. Limited access to financial and administrative settings.',
  CLIENT_SUPPORT: 'Answers clients, books appointments and handles messages.',
  BUSINESS_CONSULTANT: 'Advises their clients: Business Advisory plus the work Staff does.',
  READ_ONLY: 'Can look at clients, appointments and tasks, and change nothing.',
};

/** `api.departments` in mock mode. */
export function createDepartmentsMock(options: Options = {}): DepartmentsClient {
  const g = guard(options);
  const { s } = g;
  const change = () => {
    if (g.role !== 'OWNER' && g.role !== 'ADMIN') throw forbidden();
  };
  const dept = (id: string) => {
    const d = s.departments.find((x) => x.id === id);
    if (!d) throw notFound();
    return d;
  };
  const team = (id: string) => {
    const t = s.teams.find((x) => x.id === id);
    if (!t) throw notFound();
    return t;
  };
  const uniqueName = (
    name: string,
    list: { id: string; name: string; status: string }[],
    self?: string,
  ) => {
    if (
      list.some(
        (x) =>
          x.id !== self && x.status !== 'ARCHIVED' && x.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw fail(409, 'DUPLICATE_NAME', 'This name is already used');
    }
  };
  const headRef = (id: string | null | undefined) => {
    if (!id) return null;
    const m = g.find(id);
    if (m.detail.status !== 'ACTIVE')
      throw fail(409, 'MEMBER_NOT_ACTIVE', 'Choose an active member');
    return ref(m);
  };
  const teamDetail = (t: StaffTeam) => ({
    ...copy(t),
    members: [...(s.teamMembers.get(t.id) ?? new Map<string, TeamMemberKind>())].map(
      ([id, kind]) => ({ ...ref(g.find(id)), kind }),
    ),
  });

  return {
    list: async (query = {}) => {
      await g.allowed();
      const q = parseInput(DepartmentListQuery, query);
      recount(s);
      const search = q.search?.toLowerCase() ?? '';
      const rows = s.departments.filter(
        (d) =>
          (!search || d.name.toLowerCase().includes(search)) &&
          (q.status === 'all' || d.status === q.status.toUpperCase()),
      );
      const start = (q.page - 1) * q.pageSize;
      return {
        items: copy(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    summary: async () => {
      await g.allowed();
      const live = s.members.filter((m) => m.detail.status !== 'DEACTIVATED');
      return {
        departments: s.departments.filter((d) => d.status !== 'ARCHIVED').length,
        teams: s.teams.filter((t) => t.status !== 'ARCHIVED').length,
        staff: live.length,
        activeStaff: live.filter((m) => m.detail.status === 'ACTIVE').length,
      };
    },
    get: async (id) => {
      await g.allowed();
      recount(s);
      const d = dept(id);
      return { ...copy(d), teams: copy(s.teams.filter((t) => t.department.id === id)) };
    },
    create: async (body) => {
      await g.allowed();
      change();
      const input = parseInput(CreateDepartmentRequest, body);
      uniqueName(input.name, s.departments);
      const d: Department = {
        id: uuid('0d00', s.next++),
        name: input.name,
        description: input.description ?? null,
        head: headRef(input.headMembershipId),
        teamCount: 0,
        staffCount: 0,
        status: 'ACTIVE',
        createdAt: now(),
      };
      s.departments.push(d);
      return copy(d);
    },
    update: async (id, body) => {
      await g.allowed();
      change();
      const input = parseInput(UpdateDepartmentRequest, body);
      const d = dept(id);
      if (input.name) uniqueName(input.name, s.departments, id);
      recount(s);
      if (input.status && input.status !== 'ACTIVE' && d.staffCount > 0) {
        if (!input.moveTo)
          throw fail(409, 'GROUP_IN_USE', 'Move the people in this department first');
        const target = dept(input.moveTo);
        for (const m of s.members) {
          m.detail.departments = m.detail.departments.map((x) =>
            x.id === id ? { id: target.id, name: target.name } : x,
          );
        }
      }
      if (input.name) d.name = input.name;
      if (input.description !== undefined) d.description = input.description;
      if (input.headMembershipId !== undefined) d.head = headRef(input.headMembershipId);
      if (input.status) d.status = input.status;
      recount(s);
      return copy(d);
    },
    teams: async (query = {}) => {
      await g.allowed();
      const q = parseInput(StaffTeamListQuery, query);
      recount(s);
      const search = q.search?.toLowerCase() ?? '';
      return copy(
        s.teams.filter(
          (t) =>
            (!search || t.name.toLowerCase().includes(search)) &&
            (!q.departmentId || t.department.id === q.departmentId) &&
            (q.status === 'all' || t.status === q.status.toUpperCase()),
        ),
      );
    },
    team: async (id) => {
      await g.allowed();
      recount(s);
      return teamDetail(team(id));
    },
    createTeam: async (body) => {
      await g.allowed();
      change();
      const input = parseInput(CreateStaffTeamRequest, body);
      const d = dept(input.departmentId);
      if (d.status !== 'ACTIVE') throw fail(409, 'GROUP_INACTIVE', 'This department is not active');
      uniqueName(input.name, s.teams);
      const t: StaffTeam = {
        id: uuid('0d10', s.next++),
        name: input.name,
        description: input.description ?? null,
        department: { id: d.id, name: d.name },
        lead: headRef(input.leadMembershipId),
        memberCount: 0,
        status: 'ACTIVE',
        createdAt: now(),
      };
      s.teams.push(t);
      s.teamMembers.set(t.id, new Map());
      recount(s);
      return copy(t);
    },
    updateTeam: async (id, body) => {
      await g.allowed();
      change();
      const input = parseInput(UpdateStaffTeamRequest, body);
      const t = team(id);
      if (input.name) {
        uniqueName(input.name, s.teams, id);
        t.name = input.name;
      }
      if (input.description !== undefined) t.description = input.description;
      if (input.leadMembershipId !== undefined) t.lead = headRef(input.leadMembershipId);
      if (input.departmentId) {
        const d = dept(input.departmentId);
        t.department = { id: d.id, name: d.name };
      }
      if (input.status) t.status = input.status;
      recount(s);
      return copy(t);
    },
    setTeamMembers: async (id, body) => {
      await g.allowed();
      change();
      const input = parseInput(SetStaffTeamMembersRequest, body);
      const t = team(id);
      if (t.status !== 'ACTIVE') throw fail(409, 'GROUP_INACTIVE', 'This team is not active');
      s.teamMembers.set(
        id,
        new Map(input.members.map((m) => [g.find(m.membershipId).detail.id, m.kind])),
      );
      recount(s);
      return teamDetail(t);
    },
    orgChart: async () => {
      await g.allowed();
      return {
        nodes: s.members
          .filter((m) => m.detail.status === 'ACTIVE')
          .map((m) => ({
            ...ref(m),
            supervisorId: m.detail.profile.supervisor?.id ?? null,
            departments: copy(m.detail.departments),
            heads: s.departments
              .filter((d) => d.head?.id === m.detail.id)
              .map((d) => ({ id: d.id, name: d.name })),
          })),
      };
    },
  };
}

const MODULE_INFO: Record<PermissionModule, [string, string]> = {
  DASHBOARD: ['Dashboard', 'See the firm dashboard and its numbers.'],
  CLIENTS: ['Clients', 'View, create, edit, and manage client information, notes, and tags.'],
  LEADS: ['Leads / Prospects', 'Work the lead inbox and convert leads to clients.'],
  APPOINTMENTS: ['Appointments', 'See and book appointments and manage availability.'],
  INTAKE_FORMS: ['Intake Forms', 'Build, send and review intake forms.'],
  DOCUMENTS: ['Documents', 'Upload, request and share client documents.'],
  CLIENT_PORTAL: ['Client Portal', 'Manage what clients see in their portal.'],
  TASKS: ['Tasks', 'Create and work tasks and workflows.'],
  TAX_RETURNS: ['Tax Returns', 'Prepare, review and file tax returns.'],
  BOOKKEEPING: ['Bookkeeping', 'Keep client books and close periods.'],
  PAYROLL: ['Payroll', 'Run and approve client payroll.'],
  TAX_PLANNING: ['Tax Planning & Strategy', 'Build and present tax plans.'],
  BUSINESS_ADVISORY: ['Business Advisory & Development', 'Advisory plans and growth work.'],
  INVOICES_PAYMENTS: ['Invoices & Payments', 'Bill clients and record payments.'],
  MESSAGES: ['Messages', 'Message clients from the workspace.'],
  COMMUNICATIONS: ['Communications', 'Send campaigns and bulk messages.'],
  AUTOMATIONS: ['Automations', 'Set up automatic rules.'],
  COMPLIANCE: ['Compliance & Deadlines', 'Track filing deadlines.'],
  REPORTS: ['Reports', 'Run and export reports.'],
  TEMPLATES: ['Templates', 'Manage document and message templates.'],
  SERVICES_PRICING: ['Services & Pricing', 'Set services, packages and prices.'],
  STAFF_MANAGEMENT: ['Staff Management', 'Add staff and manage their access.'],
  INTEGRATIONS: ['Integrations', 'Connect other apps.'],
  SETTINGS: ['Settings', 'Firm-wide settings and branding.'],
};

/** `api.roles` in mock mode. Shares the staff store (role changes show in Access Summary). */
export function createRolesMock(options: Options = {}): RolesClient {
  const g = guard(options);
  const { s } = g;
  const manage = (r: MembershipRole) => {
    if (g.role !== 'OWNER' && g.role !== 'ADMIN') throw forbidden();
    if (r === 'OWNER') throw fail(403, 'FORBIDDEN', "The owner's permissions cannot be changed");
    // Owner and Admin change every other role's grid, the Admin role too (as the API does).
  };
  const view = (r: MembershipRole) => ({
    role: r,
    cells: cellsFor(s, r),
    updatedAt: s.roleOverrides.get(r)?.size ? now() : null,
    updatedBy: s.roleOverrides.get(r)?.size ? 'You' : null,
  });
  /** A built-in role's grid in this firm. */
  const gridOf = (r: MembershipRole) =>
    new Map(cellsFor(s, r).map((c) => [key(c.module, c.capability), c.granted]));
  const peopleWith = (id: string) =>
    s.members.filter((m) => m.detail.customRole?.id === id && m.detail.status !== 'DEACTIVATED')
      .length;
  const toCustom = (c: MockCustomRole) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    basedOn: c.basedOn,
    memberCount: peopleWith(c.id),
    archivedAt: c.archivedAt,
    updatedAt: c.updatedAt,
  });
  const detailOf = (c: MockCustomRole) => ({
    role: toCustom(c),
    cells: PermissionModule.options.flatMap((module) =>
      PermissionCapability.options.map((capability) => ({
        module,
        capability,
        granted: c.grid.get(key(module, capability)) ?? false,
        source: 'FIRM_ROLE' as const,
      })),
    ),
    updatedBy: 'You',
  });
  const findCustom = (id: string) => {
    const c = s.customRoles.find((r) => r.id === id);
    if (!c) throw notFound();
    return c;
  };
  const nameFree = (name: string, except?: string) => {
    const wanted = name.toLowerCase();
    if (
      FIRM_ROLES.some((r) => FIRM_ROLE_LABELS[r].toLowerCase() === wanted) ||
      s.customRoles.some((c) => !c.archivedAt && c.id !== except && c.name.toLowerCase() === wanted)
    )
      throw fail(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists');
  };
  const viewFirst = (grid: Map<string, boolean>) => {
    for (const m of PermissionModule.options)
      if (
        PermissionCapability.options.some((c) => c !== 'VIEW' && grid.get(key(m, c))) &&
        !grid.get(key(m, 'VIEW'))
      )
        throw fail(400, 'PERMISSION_NEEDS_VIEW', 'Give View first in this module');
  };
  return {
    list: async () => {
      await g.allowed();
      return {
        items: FIRM_ROLES.map((r) => ({
          role: r,
          label: FIRM_ROLE_LABELS[r],
          description: ROLE_DESCRIPTIONS[r],
          memberCount: s.members.filter(
            (m) => m.detail.role === r && m.detail.status !== 'DEACTIVATED',
          ).length,
          customized: (s.roleOverrides.get(r)?.size ?? 0) > 0,
          locked: r === 'OWNER',
        })),
        custom: s.customRoles
          .filter((c) => !c.archivedAt)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(toCustom),
      };
    },
    permissions: async (r) => {
      await g.allowed();
      return view(r);
    },
    savePermissions: async (r, body) => {
      await g.allowed();
      manage(r);
      const input = parseInput(SaveRolePermissionsRequest, body);
      checkGrants(input.grants);
      // An Admin cannot close Roles & Permissions to every Admin; the Owner can.
      if (
        g.role === 'ADMIN' &&
        r === 'ADMIN' &&
        input.grants.some(
          (gr) =>
            gr.module === 'STAFF_MANAGEMENT' &&
            ['VIEW', 'EDIT', 'DELETE'].includes(gr.capability) &&
            !gr.granted,
        )
      )
        throw fail(
          409,
          'ADMIN_LOCKOUT',
          'Admins would lose Roles & Permissions; only the Owner can take it away',
        );
      const escalates = input.grants.some(
        (gr) =>
          gr.granted && !(DEFAULT_ROLE_PERMISSIONS[r][gr.module]?.includes(gr.capability) ?? false),
      );
      if (escalates && !input.acknowledgeEscalation) {
        throw fail(
          409,
          'PERMISSION_ESCALATION',
          'This gives the role more than its default. Confirm to continue.',
        );
      }
      const rows = new Map<string, boolean>();
      for (const gr of input.grants) {
        const def = DEFAULT_ROLE_PERMISSIONS[r][gr.module]?.includes(gr.capability) ?? false;
        if (def !== gr.granted) rows.set(key(gr.module, gr.capability), gr.granted);
      }
      s.roleOverrides.set(r, rows);
      return view(r);
    },
    resetPermissions: async (r) => {
      await g.allowed();
      manage(r);
      s.roleOverrides.delete(r);
      return view(r);
    },
    modules: async () => {
      await g.allowed();
      return {
        modules: PermissionModule.options.map((m) => ({
          module: m,
          label: MODULE_INFO[m][0],
          description: MODULE_INFO[m][1],
          capabilities: [...PermissionCapability.options],
        })),
        capabilities: [
          { capability: 'VIEW', label: 'View', description: 'Read and list records.' },
          { capability: 'CREATE', label: 'Create', description: 'Create new records.' },
          { capability: 'EDIT', label: 'Edit', description: 'Change records.' },
          {
            capability: 'DELETE',
            label: 'Delete',
            description: 'Delete, where the module allows it.',
          },
          { capability: 'APPROVE', label: 'Approve', description: 'Review and approve.' },
          {
            capability: 'MANAGE',
            label: 'Manage',
            description: "Configure the module and its access (Users & Roles' Admin).",
          },
          { capability: 'EXPORT', label: 'Export', description: 'Download data.' },
        ],
      };
    },
    // Custom roles, as the API keeps them: the role and its whole grid saved together.
    createCustom: async (body) => {
      await g.allowed();
      if (g.role !== 'OWNER' && g.role !== 'ADMIN') throw forbidden();
      const input = parseInput(CreateCustomRoleRequest, body);
      nameFree(input.name);
      const base = gridOf(input.basedOn);
      const grid = new Map(base);
      for (const gr of input.grants ?? []) grid.set(key(gr.module, gr.capability), gr.granted);
      viewFirst(grid);
      if (
        (input.grants ?? []).some((gr) => gr.granted && !base.get(key(gr.module, gr.capability))) &&
        !input.acknowledgeEscalation
      )
        throw fail(409, 'PERMISSION_ESCALATION', 'This gives the role more; confirm to continue');
      const role: MockCustomRole = {
        id: `00000000-0000-4000-8000-${String(++s.next).padStart(12, '0')}`,
        name: input.name,
        description: input.description ?? null,
        basedOn: input.basedOn,
        archivedAt: null,
        updatedAt: now(),
        grid,
      };
      s.customRoles.push(role);
      return toCustom(role);
    },
    customRole: async (id) => {
      await g.allowed();
      return detailOf(findCustom(id));
    },
    updateCustom: async (id, body) => {
      await g.allowed();
      if (g.role !== 'OWNER' && g.role !== 'ADMIN') throw forbidden();
      const input = parseInput(UpdateCustomRoleRequest, body);
      const role = findCustom(id);
      if (role.archivedAt)
        throw fail(409, 'CUSTOM_ROLE_ARCHIVED', 'This role is archived and cannot be changed');
      if (input.name !== undefined && input.name.toLowerCase() !== role.name.toLowerCase())
        nameFree(input.name, id);
      if (input.grants?.length) {
        const base = gridOf(role.basedOn);
        const grid = new Map(role.grid);
        for (const gr of input.grants) grid.set(key(gr.module, gr.capability), gr.granted);
        viewFirst(grid);
        if (
          input.grants.some((gr) => {
            const k = key(gr.module, gr.capability);
            return gr.granted && !role.grid.get(k) && !base.get(k);
          }) &&
          !input.acknowledgeEscalation
        )
          throw fail(409, 'PERMISSION_ESCALATION', 'This gives the role more; confirm to continue');
        role.grid = grid;
      }
      if (input.name !== undefined) {
        role.name = input.name;
        for (const m of s.members)
          if (m.detail.customRole?.id === id) m.detail.customRole = { id, name: input.name };
      }
      if (input.description !== undefined) role.description = input.description ?? null;
      role.updatedAt = now();
      return detailOf(role);
    },
    archiveCustom: async (id) => {
      await g.allowed();
      if (g.role !== 'OWNER' && g.role !== 'ADMIN') throw forbidden();
      const role = findCustom(id);
      const inUse = peopleWith(id);
      if (inUse)
        throw fail(
          409,
          'CUSTOM_ROLE_IN_USE',
          `${inUse} ${inUse === 1 ? 'person has' : 'people have'} this role`,
        );
      role.archivedAt ??= now();
      return toCustom(role);
    },
  };
}
