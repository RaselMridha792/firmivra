/**
 * The Super Admin Team module's configuration (S05): departments, roles with their authority
 * level, modules and actions, access scopes, locations and teams. It follows "Organizational
 * Hierarchy, Roles & Permissions" (v3, Oct 14, 2026): the CEO at level 1, each department headed
 * by its Chief Officer at level 2, then VP / Director, Manager, Lead / Supervisor and Individual
 * Contributor. A role may exist without anyone holding it. Data-driven so departments and roles
 * can grow without code changes in the pages. No API exists yet: mocks/admin-team.ts serves it.
 */

/** Level 1 is the top. The level is stored apart from the visible job title. */
export type AuthorityLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const AUTHORITY_LEVELS: Record<AuthorityLevel, string> = {
  1: 'CEO / Owner / Super Admin',
  2: 'Chief Officer / C-Suite',
  3: 'Vice President / Director',
  4: 'Manager',
  5: 'Lead / Supervisor',
  6: 'Individual Contributor / Staff',
};

/** The directory's "Permission Level" column, from the authority level. */
export type AccessLevel = 'SUPER_ADMIN' | 'ADMIN' | 'STANDARD';
export const ACCESS_LEVELS: Record<AccessLevel, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  STANDARD: 'Standard',
};
export const accessLevelOf = (level: AuthorityLevel): AccessLevel =>
  level === 1 ? 'SUPER_ADMIN' : level <= 4 ? 'ADMIN' : 'STANDARD';

export type MemberStatus =
  'PENDING_INVITATION' | 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'DEACTIVATED';
export const MEMBER_STATUSES: Record<MemberStatus, string> = {
  PENDING_INVITATION: 'Pending Invitation',
  PENDING_APPROVAL: 'Pending Approval',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INACTIVE: 'Inactive',
  DEACTIVATED: 'Deactivated',
};

export type Availability = 'ONLINE' | 'IN_MEETING' | 'AWAY' | 'OFFLINE';
export const AVAILABILITY: Record<Availability, string> = {
  ONLINE: 'Online',
  IN_MEETING: 'In a meeting',
  AWAY: 'Away',
  OFFLINE: 'Offline',
};

/** Where a permission applies, broadest first (v3 §16, with Location from the Team docx §13). */
export type AccessScope =
  'COMPANY' | 'DEPARTMENT' | 'DIVISION' | 'LOCATION' | 'TEAM' | 'DIRECT_REPORTS' | 'OWN' | 'CUSTOM';
export const ACCESS_SCOPES: { id: AccessScope; label: string; description: string }[] = [
  { id: 'COMPANY', label: 'Entire Company', description: 'All departments, teams and people' },
  { id: 'DEPARTMENT', label: 'Department', description: 'Their own department' },
  { id: 'DIVISION', label: 'Division', description: 'A division inside their department' },
  { id: 'LOCATION', label: 'Location', description: 'Their assigned office' },
  { id: 'TEAM', label: 'Team', description: 'Their assigned team' },
  { id: 'DIRECT_REPORTS', label: 'Direct Reports', description: 'People who report to them' },
  { id: 'OWN', label: 'Own Records Only', description: 'Their own work and profile' },
  { id: 'CUSTOM', label: 'Custom Scope', description: 'Chosen departments, teams or people' },
];
/** 0 is the broadest. Custom scope is set up by the CEO only. */
export const scopeRank = (scope: AccessScope): number =>
  ACCESS_SCOPES.findIndex((option) => option.id === scope);

export const defaultScope = (level: AuthorityLevel): AccessScope =>
  (['COMPANY', 'DEPARTMENT', 'DIVISION', 'TEAM', 'TEAM', 'OWN'] as const)[level - 1] ?? 'OWN';

export type ModuleKey =
  | 'dashboard'
  | 'sales'
  | 'crm'
  | 'pipeline'
  | 'team'
  | 'subscriptions'
  | 'billing'
  | 'support'
  | 'reports'
  | 'notifications'
  | 'audit'
  | 'settings';

export type PermissionAction =
  'view' | 'create' | 'edit' | 'delete' | 'assign' | 'approve' | 'export' | 'manage';

export const PERMISSION_ACTIONS: { id: PermissionAction; label: string }[] = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
  { id: 'assign', label: 'Assign' },
  { id: 'approve', label: 'Approve' },
  { id: 'export', label: 'Export' },
  { id: 'manage', label: 'Manage' },
];

/** Granting an action adds the one it needs (create needs view); removing one drops dependents. */
export const ACTION_REQUIRES: Record<string, string> = {
  create: 'view',
  edit: 'view',
  delete: 'edit',
  assign: 'view',
  approve: 'view',
  export: 'view',
  manage: 'edit',
};

/** Module access for the sidebar's modules (Team docx §11), with the add form's descriptions. */
export const TEAM_MODULES: {
  id: ModuleKey;
  label: string;
  description: string;
  actions: PermissionAction[];
}[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'View the platform dashboard',
    actions: ['view', 'export'],
  },
  {
    id: 'sales',
    label: 'Sales Center',
    description: 'Access to sales tools and resources',
    actions: PERMISSION_ACTIONS.map((action) => action.id),
  },
  {
    id: 'crm',
    label: 'Leads / CRM',
    description: 'View and manage leads and customer data',
    actions: PERMISSION_ACTIONS.map((action) => action.id),
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Access to pipeline and deal management',
    actions: PERMISSION_ACTIONS.map((action) => action.id),
  },
  {
    id: 'team',
    label: 'Team',
    description: 'View members, add users, edit users, change roles',
    actions: PERMISSION_ACTIONS.map((action) => action.id),
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    description: 'View and manage subscriptions',
    actions: PERMISSION_ACTIONS.map((action) => action.id),
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'Access to billing and invoices',
    actions: PERMISSION_ACTIONS.map((action) => action.id),
  },
  {
    id: 'support',
    label: 'Support',
    description: 'View and manage support records',
    actions: PERMISSION_ACTIONS.map((action) => action.id),
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    description: 'View reports and analytics',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Receive system notifications',
    actions: ['view', 'manage'],
  },
  {
    id: 'audit',
    label: 'Audit & Security',
    description: 'View security logs (limited access)',
    actions: ['view', 'export', 'manage'],
  },
  {
    id: 'settings',
    label: 'System Settings',
    description: 'View and change system configuration',
    actions: ['view', 'edit', 'manage'],
  },
];

/** Granted actions per module. Missing or empty: no access to that module. */
export type TeamPermissions = Partial<Record<ModuleKey, PermissionAction[]>>;

export interface TeamDepartment {
  id: string;
  name: string;
  /** The modules this department works in: its roles' templates start from these. */
  modules: ModuleKey[];
}

export const TEAM_DEPARTMENTS: TeamDepartment[] = [
  {
    id: 'executive',
    name: 'Executive Leadership',
    modules: TEAM_MODULES.map((module) => module.id),
  },
  {
    id: 'operations',
    name: 'Operations',
    modules: ['dashboard', 'subscriptions', 'support', 'reports', 'notifications'],
  },
  {
    id: 'finance',
    name: 'Finance & Accounting',
    modules: ['dashboard', 'billing', 'subscriptions', 'reports', 'notifications'],
  },
  {
    id: 'technology',
    name: 'Technology / Engineering',
    modules: ['dashboard', 'settings', 'audit', 'support', 'notifications'],
  },
  { id: 'product', name: 'Product', modules: ['dashboard', 'reports', 'support', 'notifications'] },
  {
    id: 'marketing',
    name: 'Marketing',
    modules: ['dashboard', 'sales', 'crm', 'reports', 'notifications'],
  },
  {
    id: 'sales',
    name: 'Revenue / Sales',
    modules: ['dashboard', 'sales', 'crm', 'pipeline', 'subscriptions', 'reports', 'notifications'],
  },
  {
    id: 'compliance',
    name: 'Compliance / Risk',
    modules: ['dashboard', 'audit', 'reports', 'notifications'],
  },
  {
    id: 'security',
    name: 'Information Security',
    modules: ['dashboard', 'audit', 'settings', 'notifications'],
  },
  {
    id: 'it',
    name: 'Internal IT / Business Systems',
    modules: ['dashboard', 'settings', 'support', 'notifications'],
  },
  {
    id: 'hr',
    name: 'Human Resources / People',
    modules: ['dashboard', 'team', 'reports', 'notifications'],
  },
  {
    id: 'customer',
    name: 'Customer Success / Support',
    modules: ['dashboard', 'support', 'subscriptions', 'billing', 'crm', 'notifications'],
  },
  { id: 'legal', name: 'Legal', modules: ['dashboard', 'audit', 'reports', 'notifications'] },
];

export interface TeamRole {
  id: string;
  departmentId: string;
  title: string;
  level: AuthorityLevel;
  /** The Authorized HR / People Administrator: adds below-C-suite people in every department. */
  hrOverride?: boolean;
}

/** [id, title, level] per department, in the order of v3 §1 to §13. */
const ROLE_ROWS: Record<string, [string, string, AuthorityLevel][]> = {
  executive: [
    ['ceo', 'CEO — Chief Executive Officer', 1],
    ['chief-of-staff', 'Chief of Staff', 3],
  ],
  operations: [
    ['coo', 'COO — Chief Operating Officer', 2],
    ['operations-director', 'VP / Director of Operations', 3],
    ['operations-manager', 'Operations Manager', 4],
    ['program-manager', 'Project / Program Manager', 4],
    ['business-operations-analyst', 'Business Operations Analyst', 6],
    ['operations-coordinator', 'Operations Coordinator', 6],
    ['operations-specialist', 'Administrative / Operations Specialist', 6],
  ],
  finance: [
    ['cfo', 'CFO — Chief Financial Officer', 2],
    ['controller', 'Controller / Director of Finance', 3],
    ['finance-manager', 'Finance Manager', 4],
    ['accounting-manager', 'Accounting Manager', 4],
    ['senior-accountant', 'Senior Accountant', 6],
    ['staff-accountant', 'Staff Accountant', 6],
    ['accounts-payable', 'Accounts Payable Specialist', 6],
    ['accounts-receivable', 'Accounts Receivable Specialist', 6],
    ['payroll-specialist', 'Payroll Specialist', 6],
    ['financial-analyst', 'Financial Analyst', 6],
    ['bookkeeper', 'Bookkeeper / Accounting Assistant', 6],
  ],
  technology: [
    ['cto', 'CTO — Chief Technology Officer', 2],
    ['engineering-director', 'VP / Director of Engineering', 3],
    ['engineering-manager', 'Engineering Manager', 4],
    ['lead-engineer', 'Lead / Principal Software Engineer', 5],
    ['senior-engineer', 'Senior Software Engineer', 6],
    ['software-engineer', 'Software Engineer', 6],
    ['frontend-developer', 'Frontend Developer', 6],
    ['backend-developer', 'Backend Developer', 6],
    ['full-stack-developer', 'Full-Stack Developer', 6],
    ['mobile-developer', 'Mobile Developer', 6],
    ['qa-engineer', 'QA / Test Engineer', 6],
    ['devops-engineer', 'DevOps / Cloud Engineer', 6],
    ['database-engineer', 'Database Engineer / DBA', 6],
    ['infrastructure-engineer', 'Systems / Infrastructure Engineer', 6],
  ],
  product: [
    ['cpo', 'CPO — Chief Product Officer', 2],
    ['product-director', 'VP / Director of Product', 3],
    ['product-manager', 'Product Manager', 4],
    ['product-owner', 'Product Owner', 6],
    ['ux-designer', 'UX / UI Designer', 6],
    ['ux-researcher', 'UX Researcher', 6],
    ['business-analyst', 'Business Analyst', 6],
    ['product-operations', 'Product Operations', 6],
  ],
  marketing: [
    ['cmo', 'CMO — Chief Marketing Officer', 2],
    ['marketing-director', 'VP / Director of Marketing', 3],
    ['marketing-manager', 'Marketing Manager', 4],
    ['brand-manager', 'Brand Manager', 4],
    ['digital-marketing-manager', 'Digital Marketing Manager', 4],
    ['content-marketing-manager', 'Content Marketing Manager', 4],
    ['product-marketing-manager', 'Product Marketing Manager / Specialist', 4],
    ['social-media-manager', 'Social Media Manager', 4],
    ['seo-specialist', 'SEO / SEM Specialist', 6],
    ['email-marketing-specialist', 'Email Marketing Specialist', 6],
    ['graphic-designer', 'Graphic Designer', 6],
    ['copywriter', 'Copywriter / Content Writer', 6],
    ['marketing-analyst', 'Marketing Analyst', 6],
    ['communications-specialist', 'PR / Communications Specialist', 6],
  ],
  sales: [
    ['cro', 'CRO — Chief Revenue Officer', 2],
    ['sales-director', 'VP / Director of Sales', 3],
    ['sales-manager', 'Sales Manager', 4],
    ['partnerships-manager', 'Partnerships Manager', 4],
    ['channel-manager', 'Channel / Affiliate Manager', 4],
    ['sales-team-lead', 'Sales Team Lead', 5],
    ['enterprise-sales-executive', 'Enterprise Sales Executive', 6],
    ['account-executive', 'Account Executive', 6],
    ['sdr', 'Sales Development Representative (SDR)', 6],
    ['bdr', 'Business Development Representative (BDR)', 6],
    ['inside-sales', 'Inside Sales Representative', 6],
    ['revenue-operations-analyst', 'Sales Operations / Revenue Operations Analyst', 6],
  ],
  compliance: [
    ['cco', 'Chief Compliance Officer', 2],
    ['compliance-director', 'VP / Director of Compliance', 3],
    ['compliance-manager', 'Compliance Manager', 4],
    ['compliance-analyst', 'Compliance Analyst', 6],
    ['risk-specialist', 'Risk & Controls Specialist', 6],
    ['privacy-specialist', 'Privacy / Data Compliance Specialist', 6],
    ['policy-specialist', 'Policy & Governance Specialist', 6],
    ['internal-audit', 'Internal Audit / Controls Support', 6],
  ],
  security: [
    ['ciso', 'CISO — Chief Information Security Officer', 2],
    ['security-director', 'VP / Director of Information Security', 3],
    ['security-manager', 'Security Manager', 4],
    ['security-engineer', 'Security Engineer', 6],
    ['application-security-engineer', 'Application Security Engineer', 6],
    ['cloud-security-engineer', 'Cloud Security Engineer', 6],
    ['security-analyst', 'Security Analyst', 6],
    ['soc-analyst', 'SOC Analyst / Incident Response Specialist', 6],
    ['iam-specialist', 'Identity & Access Management Specialist', 6],
    ['security-governance', 'Security Compliance / Governance Specialist', 6],
    ['vulnerability-specialist', 'Vulnerability Management Specialist', 6],
  ],
  it: [
    ['cio', 'CIO — Chief Information Officer', 2],
    ['it-director', 'VP / Director of Information Technology', 3],
    ['it-manager', 'IT Manager', 4],
    ['it-project-manager', 'IT Project Manager', 4],
    ['systems-administrator', 'Systems Administrator', 6],
    ['network-administrator', 'Network Administrator / Engineer', 6],
    ['business-systems-analyst', 'Business Systems Analyst', 6],
    ['help-desk', 'IT Support / Help Desk Specialist', 6],
    ['applications-administrator', 'SaaS / Applications Administrator', 6],
    ['endpoint-specialist', 'Device & Endpoint Management Specialist', 6],
  ],
  hr: [
    ['chro', 'CHRO / Chief People Officer', 2],
    ['hr-director', 'VP / Director of Human Resources', 3],
    ['hr-manager', 'HR Manager', 4],
    ['hr-administrator', 'Authorized HR / People Administrator', 4],
    ['recruiting-manager', 'Talent Acquisition / Recruiting Manager', 4],
    ['people-operations-manager', 'People Operations Manager', 4],
    ['learning-manager', 'Learning & Development Manager', 4],
    ['recruiter', 'Recruiter', 6],
    ['hr-generalist', 'HR Generalist', 6],
    ['training-specialist', 'Training Specialist', 6],
    ['compensation-specialist', 'Compensation & Benefits Specialist', 6],
    ['employee-relations-specialist', 'Employee Relations Specialist', 6],
    ['hr-coordinator', 'HR Coordinator', 6],
  ],
  customer: [
    ['cxo', 'Chief Customer Officer', 2],
    ['customer-success-director', 'VP / Director of Customer Success', 3],
    ['customer-success-manager', 'Customer Success Manager', 4],
    ['onboarding-manager', 'Customer Onboarding Manager', 4],
    ['support-manager', 'Customer Support Manager', 4],
    ['renewals-manager', 'Retention / Renewals Manager', 4],
    ['community-manager', 'Community Manager', 4],
    ['implementation-specialist', 'Implementation Specialist', 6],
    ['customer-success-specialist', 'Customer Success Specialist', 6],
    ['technical-support-specialist', 'Technical Support Specialist', 6],
    ['support-representative', 'Customer Support Representative', 6],
    ['customer-education-specialist', 'Training / Customer Education Specialist', 6],
    ['customer-experience-analyst', 'Customer Experience Analyst', 6],
  ],
  legal: [
    ['clo', 'Chief Legal Officer / General Counsel', 2],
    ['legal-director', 'Deputy General Counsel / Director of Legal', 3],
    ['legal-operations-manager', 'Legal Operations Manager', 4],
    ['corporate-counsel', 'Corporate Counsel', 6],
    ['contracts-counsel', 'Commercial / Contracts Counsel', 6],
    ['privacy-counsel', 'Privacy Counsel', 6],
    ['paralegal', 'Paralegal / Legal Specialist', 6],
  ],
};

export const TEAM_ROLES: TeamRole[] = Object.entries(ROLE_ROWS).flatMap(([departmentId, rows]) =>
  rows.map(([id, title, level]) => ({
    id,
    departmentId,
    title,
    level,
    ...(id === 'hr-administrator' ? { hrOverride: true } : {}),
  })),
);

export const roleById = (id: string): TeamRole | undefined =>
  TEAM_ROLES.find((role) => role.id === id);
export const departmentById = (id: string): TeamDepartment | undefined =>
  TEAM_DEPARTMENTS.find((department) => department.id === id);

/** What a level does in its department's modules by default (v3 §14 and §15). */
const LEVEL_ACTIONS: Record<AuthorityLevel, PermissionAction[]> = {
  1: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  2: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  3: ['view', 'create', 'edit', 'assign', 'approve', 'export'],
  4: ['view', 'create', 'edit', 'assign', 'export'],
  5: ['view', 'create', 'edit', 'assign'],
  6: ['view', 'create', 'edit'],
};

/** The Team module by level: who may add, edit and change roles by default. */
const TEAM_ACTIONS: Record<AuthorityLevel, PermissionAction[]> = {
  1: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  2: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  3: ['view', 'create', 'edit', 'assign', 'approve'],
  4: ['view', 'edit'],
  5: ['view'],
  6: ['view'],
};

const allowedFor = (module: ModuleKey, actions: PermissionAction[]) => {
  const available = TEAM_MODULES.find((entry) => entry.id === module)?.actions ?? [];
  return actions.filter((action) => available.includes(action));
};

/**
 * A role's standard permission template: its department's modules at its level's actions, the
 * Team module by level, and notifications for everyone. The CEO gets every action everywhere.
 */
export function roleTemplate(roleId: string): TeamPermissions {
  const role = roleById(roleId);
  if (!role) return {};
  const department = departmentById(role.departmentId);
  const template: TeamPermissions = {};
  for (const module of TEAM_MODULES) {
    let actions: PermissionAction[] = [];
    if (role.level === 1) actions = module.actions;
    else if (module.id === 'team')
      actions = role.hrOverride
        ? ['view', 'create', 'edit', 'assign']
        : department?.modules.includes('team')
          ? LEVEL_ACTIONS[role.level]
          : TEAM_ACTIONS[role.level];
    else if (module.id === 'notifications') actions = ['view'];
    else if (department?.modules.includes(module.id)) actions = LEVEL_ACTIONS[role.level];
    const granted = allowedFor(module.id, actions);
    if (granted.length) template[module.id] = granted;
  }
  return template;
}

/** True when both grant the same actions on every module. */
export function samePermissions(a: TeamPermissions, b: TeamPermissions): boolean {
  return TEAM_MODULES.every(({ id }) => {
    const left = [...(a[id] ?? [])].sort();
    const right = [...(b[id] ?? [])].sort();
    return left.length === right.length && left.every((action, index) => action === right[index]);
  });
}

export interface TeamLocation {
  id: string;
  name: string;
}
export const TEAM_LOCATIONS: TeamLocation[] = [
  { id: '0199d1a0-7e05-7000-8000-000000000001', name: 'Atlanta, GA' },
  { id: '0199d1a0-7e05-7000-8000-000000000002', name: 'Charlotte, NC' },
  { id: '0199d1a0-7e05-7000-8000-000000000003', name: 'Austin, TX' },
  { id: '0199d1a0-7e05-7000-8000-000000000004', name: 'Remote' },
];

export interface TeamUnit {
  id: string;
  departmentId: string;
  name: string;
}
export const TEAM_UNITS: TeamUnit[] = [
  { id: '0199d1a0-7e06-7000-8000-000000000001', departmentId: 'executive', name: 'Leadership' },
  {
    id: '0199d1a0-7e06-7000-8000-000000000002',
    departmentId: 'sales',
    name: 'Enterprise Sales',
  },
  { id: '0199d1a0-7e06-7000-8000-000000000003', departmentId: 'sales', name: 'Growth Sales' },
  { id: '0199d1a0-7e06-7000-8000-000000000004', departmentId: 'technology', name: 'Platform' },
  {
    id: '0199d1a0-7e06-7000-8000-000000000005',
    departmentId: 'technology',
    name: 'Integrations',
  },
  { id: '0199d1a0-7e06-7000-8000-000000000006', departmentId: 'hr', name: 'People Operations' },
  {
    id: '0199d1a0-7e06-7000-8000-000000000007',
    departmentId: 'customer',
    name: 'Onboarding',
  },
  {
    id: '0199d1a0-7e06-7000-8000-000000000008',
    departmentId: 'customer',
    name: 'Support Desk',
  },
  { id: '0199d1a0-7e06-7000-8000-000000000009', departmentId: 'marketing', name: 'Brand' },
  {
    id: '0199d1a0-7e06-7000-8000-000000000010',
    departmentId: 'finance',
    name: 'Controllership',
  },
];
