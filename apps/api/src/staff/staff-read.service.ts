import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  FIRM_ROLE_LABELS,
  FIRM_SERVICES,
  ROLES_MANAGED_BY,
  type MembershipRole,
  type StaffDetail,
  type StaffFormOptions,
  type StaffListResponse,
  type StaffMfaState,
  type StaffRef,
  type StaffSummary,
} from '@firmivra/types';
import type { z } from 'zod';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { ROLE_DESCRIPTIONS } from '../roles/roles-catalog.js';
import { notFound } from '../workspaces/common.js';
import type { StaffListQ } from './staff-input.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The work schedules the form offers; a firm's own text is allowed too. */
export const WORK_SCHEDULES = [
  'Full-time (Mon-Fri, 9-5)',
  'Part-time (mornings)',
  'Part-time (afternoons)',
  'Seasonal (tax season)',
  'Flexible',
];

const STATUS: Record<string, Prisma.MembershipWhereInput | undefined> = {
  all: undefined,
  active: { status: 'ACTIVE' },
  inactive: { status: 'DEACTIVATED' },
  invited: { status: 'INVITED' },
  locked: { status: 'LOCKED' },
};

const memberSelect = {
  id: true,
  userId: true,
  jobTitle: true,
  user: { select: { name: true } },
} satisfies Prisma.MembershipSelect;
const ref = (m: Prisma.MembershipGetPayload<{ select: typeof memberSelect }>): StaffRef => ({
  id: m.id,
  userId: m.userId,
  name: m.user.name,
  jobTitle: m.jobTitle,
  avatarUrl: null,
});

/**
 * The sign-in method state is not kept in our database (Cognito knows it): until the API asks
 * Cognito, an invited member shows PENDING and the others DISABLED.
 */
const mfaOf = (status: string): StaffMfaState => (status === 'INVITED' ? 'PENDING' : 'DISABLED');

const BOM = String.fromCharCode(0xfeff);

const split = (name: string): { firstName: string; lastName: string } => {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  return { firstName: first, lastName: rest.join(' ') };
};

/** The Staff Management directory: list, summary, form options and one member's details. */
@Injectable()
export class StaffReadService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly grants: PermissionGrantsService,
  ) {}

  /**
   * Owner and Admin read. Staff (a role whose routes the guard lets in by `@Roles`) reads only when
   * the firm's grid gives the role Staff Management view; the other roles went through the grid
   * already.
   */
  private async inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    if (
      tenant.role === 'STAFF' &&
      !(await this.grants.can(tenant.businessId, 'STAFF', 'STAFF_MANAGEMENT', 'VIEW'))
    )
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this action',
      });
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private async openInvites(tx: TxClient, businessId: string, ids: string[]) {
    if (!ids.length) return new Map<string, { sentAt: string; expiresAt: string }>();
    const rows = await tx.invite.findMany({
      where: {
        businessId,
        membershipId: { in: ids },
        acceptedAt: null,
        revokedAt: null,
      },
      select: { membershipId: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const out = new Map<string, { sentAt: string; expiresAt: string }>();
    for (const r of rows)
      if (r.membershipId && !out.has(r.membershipId))
        out.set(r.membershipId, {
          sentAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
        });
    return out;
  }

  list(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof StaffListQ>,
  ): Promise<StaffListResponse> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const and: Prisma.MembershipWhereInput[] = [{ businessId }];
      const st = STATUS[q.status];
      if (st) and.push(st);
      if (q.role) and.push({ role: q.role });
      if (q.departmentId) and.push({ departments: { some: { departmentId: q.departmentId } } });
      if (q.search)
        and.push({
          OR: [
            { user: { name: { contains: q.search, mode: 'insensitive' } } },
            { user: { email: { contains: q.search, mode: 'insensitive' } } },
            { jobTitle: { contains: q.search, mode: 'insensitive' } },
          ],
        });
      const where: Prisma.MembershipWhereInput = { AND: and };
      const [total, rows] = await Promise.all([
        tx.membership.count({ where }),
        tx.membership.findMany({
          where,
          include: {
            user: { select: { name: true, email: true } },
            staffProfile: { select: { accessLevel: true } },
            departments: {
              select: { department: { select: { id: true, name: true, status: true } } },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const [invites, logins] = await Promise.all([
        this.openInvites(
          tx,
          businessId,
          rows.filter((r) => r.status === 'INVITED').map((r) => r.id),
        ),
        tx.staffSecuritySettings.findMany({
          where: { businessId, membershipId: { in: rows.map((r) => r.id) } },
          select: { membershipId: true, lastLoginAt: true },
        }),
      ]);
      const login = new Map(logins.map((l) => [l.membershipId, l.lastLoginAt]));
      return {
        items: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          name: r.user.name,
          email: r.user.email,
          avatarUrl: null,
          jobTitle: r.jobTitle,
          departments: r.departments
            .filter((d) => d.department.status !== 'ARCHIVED')
            .map((d) => ({ id: d.department.id, name: d.department.name })),
          role: r.role,
          accessLevel: r.staffProfile?.accessLevel ?? 'STANDARD_USER',
          status: r.status,
          lastLoginAt: login.get(r.id)?.toISOString() ?? null,
          mfa: mfaOf(r.status),
          invite: r.status === 'INVITED' ? (invites.get(r.id) ?? null) : null,
          isYou: r.userId === userId,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  summary(tenant: TenantContext): Promise<StaffSummary> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const by = await tx.membership.groupBy({
        by: ['status'],
        where: { businessId },
        _count: { _all: true },
      });
      const n = (s: string) => by.find((b) => b.status === s)?._count._all ?? 0;
      const [added, departments] = await Promise.all([
        tx.membership.count({ where: { businessId, createdAt: { gte: monthStart } } }),
        tx.department.count({ where: { businessId, status: { not: 'ARCHIVED' } } }),
      ]);
      return {
        total: by.reduce((a, b) => a + b._count._all, 0),
        addedThisMonth: added,
        active: n('ACTIVE'),
        inactive: n('DEACTIVATED'),
        invited: n('INVITED'),
        locked: n('LOCKED'),
        departments,
      };
    });
  }

  options(tenant: TenantContext): Promise<StaffFormOptions> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const [departments, teams, managers, titles, offices] = await Promise.all([
        tx.department.findMany({
          where: { businessId, status: 'ACTIVE' },
          select: { id: true, name: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        tx.team.findMany({
          where: { businessId, status: 'ACTIVE' },
          select: { id: true, name: true, departmentId: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        tx.membership.findMany({
          where: { businessId, status: 'ACTIVE' },
          select: memberSelect,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        tx.membership.findMany({
          where: { businessId, jobTitle: { not: null } },
          select: { jobTitle: true },
          distinct: ['jobTitle'],
          orderBy: { jobTitle: 'asc' },
          take: 200,
        }),
        tx.staffProfile.findMany({
          where: { businessId, office: { not: null } },
          select: { office: true },
          distinct: ['office'],
          orderBy: { office: 'asc' },
          take: 100,
        }),
      ]);
      const actor = tenant.role as MembershipRole;
      const roles = (ROLES_MANAGED_BY[actor] ?? []).map((role) => ({
        role,
        label: FIRM_ROLE_LABELS[role],
        description: ROLE_DESCRIPTIONS[role],
      }));
      return {
        departments,
        teams,
        managers: managers.map(ref),
        roles,
        jobTitles: titles.flatMap((t) => (t.jobTitle ? [t.jobTitle] : [])),
        offices: offices.flatMap((o) => (o.office ? [o.office] : [])),
        workSchedules: WORK_SCHEDULES,
        serviceAreas: Object.entries(FIRM_SERVICES).map(([code, label]) => ({ code, label })),
      };
    });
  }

  get(tenant: TenantContext, userId: string, id: string): Promise<StaffDetail> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const m = await tx.membership.findFirst({
        where: { businessId, id },
        include: {
          user: { select: { name: true, email: true, phone: true } },
          staffProfile: {
            include: {
              supervisor: { select: memberSelect },
              notesUpdatedBy: { select: { user: { select: { name: true } } } },
            },
          },
          departments: {
            select: { department: { select: { id: true, name: true, status: true } } },
          },
          teamMemberships: {
            select: { kind: true, team: { select: { id: true, name: true, status: true } } },
          },
        },
      });
      if (!m) throw notFound();
      const [invites, security] = await Promise.all([
        m.status === 'INVITED' ? this.openInvites(tx, businessId, [m.id]) : new Map(),
        tx.staffSecuritySettings.findUnique({
          where: { businessId_membershipId: { businessId, membershipId: m.id } },
          select: { lastLoginAt: true },
        }),
      ]);
      const p = m.staffProfile;
      const team = (kind: 'PRIMARY' | 'BACKUP') => {
        const t = m.teamMemberships.find((x) => x.kind === kind && x.team.status !== 'ARCHIVED');
        return t ? { id: t.team.id, name: t.team.name } : null;
      };
      const { firstName, lastName } = split(m.user.name);
      const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;
      return {
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        firstName,
        lastName,
        email: m.user.email,
        phone: m.user.phone,
        avatarUrl: null,
        role: m.role,
        status: m.status,
        jobTitle: m.jobTitle,
        departments: m.departments
          .filter((d) => d.department.status !== 'ARCHIVED')
          .map((d) => ({ id: d.department.id, name: d.department.name })),
        serviceAreas: p?.serviceAreas ?? [],
        accessLevel: p?.accessLevel ?? 'STANDARD_USER',
        accessStartsOn: day(p?.accessStartsOn),
        memberSince: (m.joinedAt ?? m.createdAt).toISOString(),
        profile: {
          employmentType: p?.employmentType ?? null,
          workSchedule: p?.workSchedule ?? null,
          office: p?.office ?? null,
          hireDate: day(p?.hireDate),
          endDate: day(p?.endDate),
          supervisor: p?.supervisor ? ref(p.supervisor) : null,
          timeZone: p?.timeZone ?? null,
          employeeId: p?.employeeId ?? null,
          primaryTeam: team('PRIMARY'),
          backupTeam: team('BACKUP'),
          primarySpecialty: p?.primarySpecialty ?? null,
          maxWorkload: p?.maxWorkload ?? null,
          acceptsNewClients: p?.acceptsNewClients ?? true,
        },
        mfa: mfaOf(m.status),
        lastLogin: security?.lastLoginAt
          ? { at: security.lastLoginAt.toISOString(), device: null, place: null }
          : null,
        invite: m.status === 'INVITED' ? (invites.get(m.id) ?? null) : null,
        notes:
          p?.notes && p.notesUpdatedAt
            ? {
                text: p.notes,
                updatedAt: p.notesUpdatedAt.toISOString(),
                updatedBy: p.notesUpdatedBy?.user.name ?? null,
              }
            : null,
        isYou: m.userId === userId,
        version: (p && p.updatedAt > m.updatedAt ? p.updatedAt : m.updatedAt).toISOString(),
      };
    });
  }

  /** The CSV a firm fills in to import staff: the columns the import maps, and one made-up row. */
  importTemplate(): string {
    const head = [
      'firstName',
      'lastName',
      'email',
      'phone',
      'jobTitle',
      'role',
      'department',
      'employmentType',
      'office',
      'hireDate',
      'employeeId',
    ];
    const sample = [
      'Alex',
      'Sample',
      'alex.sample@example.com',
      '(555) 010-2030',
      'Tax Preparer',
      'TAX_PREPARER',
      'Tax Services',
      'FULL_TIME',
      'Main Office',
      '2026-01-15',
      'E-1001',
    ];
    return `${BOM}${head.join(',')}\r\n${sample.join(',')}\r\n`;
  }
}
