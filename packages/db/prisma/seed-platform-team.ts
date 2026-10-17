// R0 stage A seed: Firmivra's own internal org chart (Octavia's hierarchy/permissions and team
// developer instructions, Oct 14 v3). The 13 departments and the full role catalog are reference
// data, like the plan ladder: "roles may exist in the system without being occupied." Only the
// existing SUPER_ADMIN gets an occupied (platform_members) row, mapped to CEO. Safe to run again.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { SEED_USERS } from './seed-data.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const slug = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

type Level =
  | 'CEO'
  | 'CHIEF_OFFICER'
  | 'VP_DIRECTOR'
  | 'MANAGER'
  | 'LEAD_SUPERVISOR'
  | 'INDIVIDUAL_CONTRIBUTOR';
type Scope =
  'COMPANY' | 'DEPARTMENT' | 'DIVISION' | 'TEAM' | 'DIRECT_REPORTS' | 'OWN_RECORDS' | 'CUSTOM';

/** [title, level, reportsToTitle within this department (null = the department head), scope]. */
type RoleRow = readonly [string, Level, string | null, Scope];

interface DeptDef {
  code: string;
  name: string;
  /** The first row is always the department head, reporting to CEO (null). */
  roles: readonly RoleRow[];
}

// Transcribed from Farmivora_Hierarchy_and_Permissions_Developer_Instructions_v3.docx, sections
// 1-13. Each department's first row is its head (reports to CEO); every other row's reportsTo is
// the exact title text of another row in the same department (resolved to a role id below), or
// null to mean "reports to this department's head". A few source rows list more than one
// possible supervisor ("VP/Director or COO"); the first name is used. Ambiguous "Manager / IC" or
// "Senior IC" levels are picked conservatively (the lower of the two) -- see the PR description.
const DEPARTMENTS: readonly DeptDef[] = [
  {
    code: 'EXECUTIVE',
    name: 'Executive',
    roles: [
      ['CEO', 'CEO', null, 'COMPANY'],
      ['Chief of Staff', 'VP_DIRECTOR', 'CEO', 'DIVISION'],
    ],
  },
  {
    code: 'OPERATIONS',
    name: 'Operations',
    roles: [
      ['COO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Operations', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Operations Manager', 'MANAGER', 'VP / Director of Operations', 'TEAM'],
      ['Project / Program Manager', 'MANAGER', 'Operations Manager', 'TEAM'],
      [
        'Business Operations Analyst',
        'INDIVIDUAL_CONTRIBUTOR',
        'Operations Manager',
        'OWN_RECORDS',
      ],
      ['Operations Coordinator', 'LEAD_SUPERVISOR', 'Operations Manager', 'TEAM'],
      [
        'Administrative / Operations Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Operations Manager',
        'OWN_RECORDS',
      ],
    ],
  },
  {
    code: 'FINANCE_ACCOUNTING',
    name: 'Finance & Accounting',
    roles: [
      ['CFO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['Controller / Director of Finance', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Finance Manager', 'MANAGER', 'Controller / Director of Finance', 'TEAM'],
      ['Accounting Manager', 'MANAGER', 'Controller / Director of Finance', 'TEAM'],
      ['Senior Accountant', 'INDIVIDUAL_CONTRIBUTOR', 'Accounting Manager', 'OWN_RECORDS'],
      ['Staff Accountant', 'INDIVIDUAL_CONTRIBUTOR', 'Accounting Manager', 'OWN_RECORDS'],
      [
        'Accounts Payable Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Accounting Manager',
        'OWN_RECORDS',
      ],
      [
        'Accounts Receivable Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Accounting Manager',
        'OWN_RECORDS',
      ],
      ['Payroll Specialist', 'INDIVIDUAL_CONTRIBUTOR', 'Accounting Manager', 'OWN_RECORDS'],
      ['Financial Analyst', 'INDIVIDUAL_CONTRIBUTOR', 'Finance Manager', 'OWN_RECORDS'],
      [
        'Bookkeeper / Accounting Assistant',
        'INDIVIDUAL_CONTRIBUTOR',
        'Accounting Manager',
        'OWN_RECORDS',
      ],
    ],
  },
  {
    code: 'TECHNOLOGY_ENGINEERING',
    name: 'Technology / Engineering',
    roles: [
      ['CTO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Engineering', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Engineering Manager', 'MANAGER', 'VP / Director of Engineering', 'TEAM'],
      ['Lead / Principal Software Engineer', 'LEAD_SUPERVISOR', 'Engineering Manager', 'TEAM'],
      ['Senior Software Engineer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['Software Engineer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['Frontend Developer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['Backend Developer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['Full-Stack Developer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['Mobile Developer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['QA / Test Engineer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['DevOps / Cloud Engineer', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      ['Database Engineer / DBA', 'INDIVIDUAL_CONTRIBUTOR', 'Engineering Manager', 'OWN_RECORDS'],
      [
        'Systems / Infrastructure Engineer',
        'INDIVIDUAL_CONTRIBUTOR',
        'Engineering Manager',
        'OWN_RECORDS',
      ],
    ],
  },
  {
    code: 'PRODUCT',
    name: 'Product',
    roles: [
      ['CPO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Product', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Product Manager', 'MANAGER', 'VP / Director of Product', 'TEAM'],
      ['Product Owner', 'INDIVIDUAL_CONTRIBUTOR', 'Product Manager', 'OWN_RECORDS'],
      ['UX / UI Designer', 'INDIVIDUAL_CONTRIBUTOR', 'Product Manager', 'OWN_RECORDS'],
      ['UX Researcher', 'INDIVIDUAL_CONTRIBUTOR', 'Product Manager', 'OWN_RECORDS'],
      ['Business Analyst', 'INDIVIDUAL_CONTRIBUTOR', 'Product Manager', 'OWN_RECORDS'],
      ['Product Operations', 'INDIVIDUAL_CONTRIBUTOR', 'Product Manager', 'OWN_RECORDS'],
    ],
  },
  {
    code: 'MARKETING',
    name: 'Marketing',
    roles: [
      ['CMO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Marketing', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Marketing Manager', 'MANAGER', 'VP / Director of Marketing', 'TEAM'],
      ['Brand Manager', 'MANAGER', 'Marketing Manager', 'TEAM'],
      ['Digital Marketing Manager', 'MANAGER', 'Marketing Manager', 'TEAM'],
      ['Content Marketing Manager', 'MANAGER', 'Marketing Manager', 'TEAM'],
      ['Product Marketing Manager / Specialist', 'MANAGER', 'Marketing Manager', 'TEAM'],
      ['Social Media Manager', 'MANAGER', 'Marketing Manager', 'TEAM'],
      [
        'SEO / SEM Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Digital Marketing Manager',
        'OWN_RECORDS',
      ],
      [
        'Email Marketing Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Digital Marketing Manager',
        'OWN_RECORDS',
      ],
      ['Graphic Designer', 'INDIVIDUAL_CONTRIBUTOR', 'Marketing Manager', 'OWN_RECORDS'],
      [
        'Copywriter / Content Writer',
        'INDIVIDUAL_CONTRIBUTOR',
        'Content Marketing Manager',
        'OWN_RECORDS',
      ],
      ['Marketing Analyst', 'INDIVIDUAL_CONTRIBUTOR', 'Marketing Manager', 'OWN_RECORDS'],
      [
        'PR / Communications Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Marketing Manager',
        'OWN_RECORDS',
      ],
    ],
  },
  {
    code: 'REVENUE_SALES',
    name: 'Revenue / Sales',
    roles: [
      ['CRO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Sales', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Sales Manager', 'MANAGER', 'VP / Director of Sales', 'TEAM'],
      ['Account Executive', 'INDIVIDUAL_CONTRIBUTOR', 'Sales Manager', 'OWN_RECORDS'],
      [
        'Sales Development Representative (SDR)',
        'INDIVIDUAL_CONTRIBUTOR',
        'Sales Manager',
        'OWN_RECORDS',
      ],
      [
        'Business Development Representative (BDR)',
        'INDIVIDUAL_CONTRIBUTOR',
        'Sales Manager',
        'OWN_RECORDS',
      ],
      ['Inside Sales Representative', 'INDIVIDUAL_CONTRIBUTOR', 'Sales Manager', 'OWN_RECORDS'],
      ['Enterprise Sales Executive', 'INDIVIDUAL_CONTRIBUTOR', 'Sales Manager', 'OWN_RECORDS'],
      ['Partnerships Manager', 'MANAGER', 'CRO', 'TEAM'],
      ['Channel / Affiliate Manager', 'MANAGER', 'CRO', 'TEAM'],
      [
        'Sales Operations / Revenue Operations Analyst',
        'INDIVIDUAL_CONTRIBUTOR',
        'CRO',
        'OWN_RECORDS',
      ],
    ],
  },
  {
    code: 'COMPLIANCE_RISK',
    name: 'Compliance / Risk',
    roles: [
      ['Chief Compliance Officer', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Compliance', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Compliance Manager', 'MANAGER', 'VP / Director of Compliance', 'TEAM'],
      ['Compliance Analyst', 'INDIVIDUAL_CONTRIBUTOR', 'Compliance Manager', 'OWN_RECORDS'],
      ['Risk & Controls Specialist', 'INDIVIDUAL_CONTRIBUTOR', 'Compliance Manager', 'OWN_RECORDS'],
      [
        'Privacy / Data Compliance Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Compliance Manager',
        'OWN_RECORDS',
      ],
      [
        'Policy & Governance Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Compliance Manager',
        'OWN_RECORDS',
      ],
      [
        'Internal Audit / Controls Support',
        'INDIVIDUAL_CONTRIBUTOR',
        'Compliance Manager',
        'OWN_RECORDS',
      ],
    ],
  },
  {
    code: 'INFORMATION_SECURITY',
    name: 'Information Security',
    roles: [
      ['CISO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Information Security', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Security Manager', 'MANAGER', 'VP / Director of Information Security', 'TEAM'],
      ['Security Engineer', 'INDIVIDUAL_CONTRIBUTOR', 'Security Manager', 'OWN_RECORDS'],
      [
        'Application Security Engineer',
        'INDIVIDUAL_CONTRIBUTOR',
        'Security Manager',
        'OWN_RECORDS',
      ],
      ['Cloud Security Engineer', 'INDIVIDUAL_CONTRIBUTOR', 'Security Manager', 'OWN_RECORDS'],
      ['Security Analyst', 'INDIVIDUAL_CONTRIBUTOR', 'Security Manager', 'OWN_RECORDS'],
      [
        'SOC Analyst / Incident Response Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Security Manager',
        'OWN_RECORDS',
      ],
      [
        'Identity & Access Management Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Security Manager',
        'OWN_RECORDS',
      ],
      [
        'Security Compliance / Governance Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Security Manager',
        'OWN_RECORDS',
      ],
      [
        'Vulnerability Management Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Security Manager',
        'OWN_RECORDS',
      ],
    ],
  },
  {
    code: 'IT_BUSINESS_SYSTEMS',
    name: 'Internal IT / Business Systems',
    roles: [
      ['CIO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Information Technology', 'VP_DIRECTOR', null, 'DIVISION'],
      ['IT Manager', 'MANAGER', 'VP / Director of Information Technology', 'TEAM'],
      ['Systems Administrator', 'INDIVIDUAL_CONTRIBUTOR', 'IT Manager', 'OWN_RECORDS'],
      ['Network Administrator / Engineer', 'INDIVIDUAL_CONTRIBUTOR', 'IT Manager', 'OWN_RECORDS'],
      ['Business Systems Analyst', 'INDIVIDUAL_CONTRIBUTOR', 'IT Manager', 'OWN_RECORDS'],
      ['IT Support / Help Desk Specialist', 'INDIVIDUAL_CONTRIBUTOR', 'IT Manager', 'OWN_RECORDS'],
      ['SaaS / Applications Administrator', 'INDIVIDUAL_CONTRIBUTOR', 'IT Manager', 'OWN_RECORDS'],
      [
        'Device & Endpoint Management Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'IT Manager',
        'OWN_RECORDS',
      ],
      ['IT Project Manager', 'MANAGER', 'IT Manager', 'TEAM'],
    ],
  },
  {
    code: 'HR_PEOPLE',
    name: 'Human Resources / People',
    roles: [
      ['CHRO', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Human Resources', 'VP_DIRECTOR', null, 'DIVISION'],
      ['HR Manager', 'MANAGER', 'VP / Director of Human Resources', 'TEAM'],
      [
        'Talent Acquisition / Recruiting Manager',
        'MANAGER',
        'VP / Director of Human Resources',
        'TEAM',
      ],
      [
        'Recruiter',
        'INDIVIDUAL_CONTRIBUTOR',
        'Talent Acquisition / Recruiting Manager',
        'OWN_RECORDS',
      ],
      ['People Operations Manager', 'MANAGER', 'VP / Director of Human Resources', 'TEAM'],
      ['HR Generalist', 'INDIVIDUAL_CONTRIBUTOR', 'HR Manager', 'OWN_RECORDS'],
      ['Learning & Development Manager', 'MANAGER', 'VP / Director of Human Resources', 'TEAM'],
      [
        'Training Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Learning & Development Manager',
        'OWN_RECORDS',
      ],
      ['Compensation & Benefits Specialist', 'INDIVIDUAL_CONTRIBUTOR', 'HR Manager', 'OWN_RECORDS'],
      ['Employee Relations Specialist', 'INDIVIDUAL_CONTRIBUTOR', 'HR Manager', 'OWN_RECORDS'],
      ['HR Coordinator', 'LEAD_SUPERVISOR', 'HR Manager', 'TEAM'],
      ['Authorized HR / People Administrator', 'MANAGER', 'CHRO', 'CUSTOM'],
    ],
  },
  {
    code: 'CUSTOMER_SUCCESS_SUPPORT',
    name: 'Customer Success / Support',
    roles: [
      ['Chief Customer Officer', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['VP / Director of Customer Success', 'VP_DIRECTOR', null, 'DIVISION'],
      ['Customer Success Manager', 'MANAGER', 'VP / Director of Customer Success', 'TEAM'],
      ['Customer Onboarding Manager', 'MANAGER', 'VP / Director of Customer Success', 'TEAM'],
      [
        'Implementation Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Customer Onboarding Manager',
        'OWN_RECORDS',
      ],
      [
        'Customer Success Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Customer Success Manager',
        'OWN_RECORDS',
      ],
      ['Customer Support Manager', 'MANAGER', 'Chief Customer Officer', 'TEAM'],
      [
        'Technical Support Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Customer Support Manager',
        'OWN_RECORDS',
      ],
      [
        'Customer Support Representative',
        'INDIVIDUAL_CONTRIBUTOR',
        'Customer Support Manager',
        'OWN_RECORDS',
      ],
      [
        'Training / Customer Education Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Customer Onboarding Manager',
        'OWN_RECORDS',
      ],
      [
        'Customer Experience Analyst',
        'INDIVIDUAL_CONTRIBUTOR',
        'Customer Success Manager',
        'OWN_RECORDS',
      ],
      ['Retention / Renewals Manager', 'MANAGER', 'Chief Customer Officer', 'TEAM'],
      ['Community Manager', 'MANAGER', 'Chief Customer Officer', 'TEAM'],
    ],
  },
  {
    code: 'LEGAL',
    name: 'Legal',
    roles: [
      ['Chief Legal Officer / General Counsel', 'CHIEF_OFFICER', null, 'DEPARTMENT'],
      ['Deputy General Counsel / Director of Legal', 'VP_DIRECTOR', null, 'DIVISION'],
      [
        'Corporate Counsel',
        'INDIVIDUAL_CONTRIBUTOR',
        'Deputy General Counsel / Director of Legal',
        'OWN_RECORDS',
      ],
      [
        'Commercial / Contracts Counsel',
        'INDIVIDUAL_CONTRIBUTOR',
        'Deputy General Counsel / Director of Legal',
        'OWN_RECORDS',
      ],
      [
        'Privacy Counsel',
        'INDIVIDUAL_CONTRIBUTOR',
        'Deputy General Counsel / Director of Legal',
        'OWN_RECORDS',
      ],
      ['Legal Operations Manager', 'MANAGER', 'Deputy General Counsel / Director of Legal', 'TEAM'],
      [
        'Paralegal / Legal Specialist',
        'INDIVIDUAL_CONTRIBUTOR',
        'Legal Operations Manager',
        'OWN_RECORDS',
      ],
    ],
  },
];

/** The team.* permission template per level (hierarchy doc, section 15). Everything else: DENY. */
const LEVELS: Level[] = [
  'CEO',
  'CHIEF_OFFICER',
  'VP_DIRECTOR',
  'MANAGER',
  'LEAD_SUPERVISOR',
  'INDIVIDUAL_CONTRIBUTOR',
];
// [permissionKey, allowed-at-level...] -- the row order matches LEVELS above.
const ROLE_PERMISSION_TEMPLATE: readonly [string, readonly boolean[]][] = [
  ['team.view', [true, true, true, true, true, true]],
  ['team.view_profile', [true, true, true, true, true, true]],
  ['org.view', [true, true, true, true, true, true]],
  ['team.create', [true, true, false, false, false, false]],
  ['team.edit', [true, true, true, true, false, false]],
  ['team.deactivate', [true, false, false, false, false, false]],
  ['team.assign_department', [true, false, false, false, false, false]],
  ['team.assign_team', [true, true, true, false, false, false]],
  ['team.change_role', [true, true, false, false, false, false]],
  ['team.change_permissions', [true, false, false, false, false, false]],
  ['team.create_group', [true, true, false, false, false, false]],
  ['team.create_role', [true, false, false, false, false, false]],
  ['team.announce_company', [true, false, false, false, false, false]],
  ['team.announce_department', [true, true, false, false, false, false]],
  ['team.message_company', [true, false, false, false, false, false]],
  ['team.message_department', [true, true, false, false, false, false]],
  ['team.message_team', [true, true, true, true, true, false]],
];

/**
 * Firmivra's own org chart: the 13 departments, the 129-role catalog and the team.* permission
 * template. Reference data, not tied to any one admin account -- safe to run on dev, where the
 * SUPER_ADMIN rows are real people, not this repo's synthetic seed users. Returns each
 * department's id by code (the CEO mapping needs EXECUTIVE's). Safe to run again.
 */
export async function seedPlatformTeamCatalog(prisma: Prisma): Promise<Record<string, string>> {
  // Departments and role definitions: platform (identity-layer) reference data, not firm data.
  const deptIds = await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    const ids: Record<string, string> = {};
    for (const d of DEPARTMENTS) {
      const row = await tx.platformDepartment.upsert({
        where: { code: d.code },
        update: { name: d.name },
        create: { code: d.code, name: d.name },
        select: { id: true },
      });
      ids[d.code] = row.id;
    }
    return ids;
  });

  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    const roleIds: Record<string, string> = {}; // "DEPT_CODE::Title" -> id
    for (const d of DEPARTMENTS) {
      const departmentId = deptIds[d.code];
      if (!departmentId) throw new Error(`seedPlatformTeam: no department id for ${d.code}`);
      for (const [title, level, , scope] of d.roles) {
        const code = `${d.code}_${slug(title)}`;
        const row = await tx.platformRoleDefinition.upsert({
          where: { code },
          update: { title, level, departmentId, defaultScopeType: scope },
          create: { code, title, level, departmentId, defaultScopeType: scope },
          select: { id: true },
        });
        roleIds[`${d.code}::${title}`] = row.id;
      }
    }
    const roleId = (deptCode: string, title: string): string => {
      const id = roleIds[`${deptCode}::${title}`];
      if (!id)
        throw new Error(`seedPlatformTeam: no role "${title}" in ${deptCode} (reportsTo typo?)`);
      return id;
    };

    // Second pass: wire up default_reports_to_role_id now that every role has an id. Every
    // department head's reportsTo is null and resolves to the CEO; everyone else names another
    // role in the same department, or "CEO" directly (Chief of Staff).
    for (const d of DEPARTMENTS) {
      for (const [title, , reportsTo] of d.roles) {
        if (title === 'CEO') continue; // the only row with no reports-to at all
        const code = `${d.code}_${slug(title)}`;
        const reportsToId =
          reportsTo === null
            ? roleId('EXECUTIVE', 'CEO') // this row is a department head
            : reportsTo === 'CEO'
              ? roleId('EXECUTIVE', 'CEO')
              : roleId(d.code, reportsTo);
        await tx.platformRoleDefinition.update({
          where: { code },
          data: { defaultReportsToRoleId: reportsToId },
        });
      }
    }
    // The role permission template: ALLOW where the hierarchy doc's section 15 says Yes,
    // DENY everywhere else (an "if enabled" cell is DENY by default: the later Team API grants
    // it as a per-member override, never widens the template itself).
    for (const d of DEPARTMENTS) {
      for (const [title, level] of d.roles) {
        const thisRoleId = roleId(d.code, title);
        const levelIndex = LEVELS.indexOf(level);
        for (const [permissionKey, allowedAtLevel] of ROLE_PERMISSION_TEMPLATE) {
          const allowed = allowedAtLevel[levelIndex] ?? false;
          await tx.platformRolePermission.upsert({
            where: {
              roleDefinitionId_permissionKey: { roleDefinitionId: thisRoleId, permissionKey },
            },
            update: { state: allowed ? 'ALLOW' : 'DENY' },
            create: {
              roleDefinitionId: thisRoleId,
              permissionKey,
              state: allowed ? 'ALLOW' : 'DENY',
            },
          });
        }
      }
    }
  });
  return deptIds;
}

/** The LVP-style seed's own org chart plus the one CEO mapping it needs: the seed's own
 * SEED_USERS.superAdmin. Used only by `pnpm db:seed` (never on dev; see bootstrap-platform-org.ts
 * for a generic, dev-safe version that maps every existing SUPER_ADMIN, not one fixed id). */
export async function seedPlatformTeam(prisma: Prisma): Promise<void> {
  const deptIds = await seedPlatformTeamCatalog(prisma);

  // Map every existing SUPER_ADMIN to the CEO role (Rasel's PART 1, item 1). Runs in admin scope,
  // after the platformAdmin upsert above has committed, so app_is_admin() already sees it.
  const ceoRoleId = await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.platformRoleDefinition
      .findUniqueOrThrow({ where: { code: 'EXECUTIVE_CEO' }, select: { id: true } })
      .then((r) => r.id),
  );
  await runInScope(prisma, { kind: 'admin', adminUserId: SEED_USERS.superAdmin.id }, async (tx) => {
    await tx.platformMember.upsert({
      where: { userId: SEED_USERS.superAdmin.id },
      update: {},
      create: {
        userId: SEED_USERS.superAdmin.id,
        roleDefinitionId: ceoRoleId,
        departmentId: deptIds['EXECUTIVE']!,
        scopeType: 'COMPANY',
        status: 'ACTIVE',
      },
    });
    await tx.auditLog.create({
      data: {
        businessId: null,
        actorUserId: SEED_USERS.superAdmin.id,
        action: 'platform_member.mapped_to_ceo',
        entityType: 'platform_member',
        entityId: SEED_USERS.superAdmin.id,
        metadata: { from: 'seed', note: 'Existing SUPER_ADMIN mapped to CEO (R0 stage A)' },
      },
    });
  });
}
