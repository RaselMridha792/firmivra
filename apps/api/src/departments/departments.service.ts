import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  Department,
  DepartmentDetail,
  DepartmentListResponse,
  DepartmentMembers,
  DepartmentSummary,
  MembershipStatus,
  OrgChart,
  StaffRef,
  StaffTeam,
  StaffTeamDetail,
  StaffTeamList,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { notFound } from '../workspaces/common.js';
import type {
  CreateDepartmentBody,
  CreateTeamBody,
  DepartmentListQ,
  SetDepartmentMembersBody,
  SetTeamMembersBody,
  TeamListQ,
  UpdateDepartmentBody,
  UpdateTeamBody,
} from './departments-input.js';

type Out<S extends z.ZodType> = z.output<S>;

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const invalid = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request is not valid',
    details: [{ path, message }],
  });

const STATUS: Record<string, Prisma.EnumStaffGroupStatusFilter | undefined> = {
  all: undefined,
  active: { equals: 'ACTIVE' },
  inactive: { equals: 'INACTIVE' },
  archived: { equals: 'ARCHIVED' },
};

/** Staff a department lists and takes: everyone but the deactivated. */
const LISTED = ['ACTIVE', 'INVITED', 'LOCKED'] as const satisfies readonly MembershipStatus[];

const memberSelect = {
  id: true,
  userId: true,
  jobTitle: true,
  user: { select: { name: true } },
} satisfies Prisma.MembershipSelect;
type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;
const ref = (m: MemberRow): StaffRef => ({
  id: m.id,
  userId: m.userId,
  name: m.user.name,
  jobTitle: m.jobTitle,
  avatarUrl: null,
});

/**
 * Teams & Departments and the org chart (contract in packages/types/src/staff/departments.ts).
 * Everyone with the grid's Staff Management view reads; Owner and Admin change (the controller
 * closes the writes to the others). Nothing is deleted: INACTIVE or ARCHIVED instead. Audited with
 * ids and field names only.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
  ) {}

  /**
   * Owner and Admin read and change. Staff (let in by `@Roles`, not by the grid) reads only when
   * the firm's grid gives the role Staff Management view; the other roles went through the grid
   * already.
   */
  private async inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    if (
      tenant.role === 'STAFF' &&
      !(await this.grants.canTenant(tenant, 'STAFF_MANAGEMENT', 'VIEW'))
    )
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this action',
      });
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  // ---------- Shared pieces ----------

  /** A member who may lead or head a group: active in this firm. */
  private async activeMember(tx: TxClient, businessId: string, id: string, path: string) {
    const m = await tx.membership.findFirst({
      where: { businessId, id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!m) {
      throw new ConflictException({
        code: 'MEMBER_NOT_ACTIVE',
        message: 'The person must be an active member',
        details: [{ path }],
      });
    }
  }

  /** A department or team name must be free among the firm's groups that are not archived. */
  private async nameFree(tx: TxClient, businessId: string, name: string, except?: string) {
    const norm = name.trim();
    const [d, t] = await Promise.all([
      tx.department.findFirst({
        where: {
          businessId,
          status: { not: 'ARCHIVED' },
          name: { equals: norm, mode: 'insensitive' },
          ...(except ? { id: { not: except } } : {}),
        },
        select: { id: true },
      }),
      tx.team.findFirst({
        where: {
          businessId,
          status: { not: 'ARCHIVED' },
          name: { equals: norm, mode: 'insensitive' },
          ...(except ? { id: { not: except } } : {}),
        },
        select: { id: true },
      }),
    ]);
    if (d || t) throw conflict('DUPLICATE_NAME', 'A department or team with this name exists');
  }

  private async heads(tx: TxClient, businessId: string, ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => x !== null))];
    if (!list.length) return new Map<string, StaffRef>();
    const rows = await tx.membership.findMany({
      where: { businessId, id: { in: list } },
      select: memberSelect,
    });
    return new Map(rows.map((m) => [m.id, ref(m)]));
  }

  private async departmentRows(
    tx: TxClient,
    businessId: string,
    rows: Prisma.DepartmentGetPayload<object>[],
  ): Promise<Department[]> {
    const ids = rows.map((r) => r.id);
    const [heads, teams, staff] = await Promise.all([
      this.heads(
        tx,
        businessId,
        rows.map((r) => r.headMembershipId),
      ),
      tx.team.groupBy({
        by: ['departmentId'],
        where: { businessId, departmentId: { in: ids }, status: { not: 'ARCHIVED' } },
        _count: { _all: true },
      }),
      tx.memberDepartment.groupBy({
        by: ['departmentId'],
        where: { businessId, departmentId: { in: ids }, membership: { status: 'ACTIVE' } },
        _count: { _all: true },
      }),
    ]);
    const tc = new Map(teams.map((t) => [t.departmentId, t._count._all]));
    const sc = new Map(staff.map((s) => [s.departmentId, s._count._all]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      head: r.headMembershipId ? (heads.get(r.headMembershipId) ?? null) : null,
      teamCount: tc.get(r.id) ?? 0,
      staffCount: sc.get(r.id) ?? 0,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async teamRows(
    tx: TxClient,
    businessId: string,
    rows: Prisma.TeamGetPayload<{
      include: { department: { select: { id: true; name: true } } };
    }>[],
  ): Promise<StaffTeam[]> {
    const [leads, counts] = await Promise.all([
      this.heads(
        tx,
        businessId,
        rows.map((r) => r.leadMembershipId),
      ),
      tx.teamMember.groupBy({
        by: ['teamId'],
        where: {
          businessId,
          teamId: { in: rows.map((r) => r.id) },
          membership: { status: 'ACTIVE' },
        },
        _count: { _all: true },
      }),
    ]);
    const mc = new Map(counts.map((c) => [c.teamId, c._count._all]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      department: { id: r.department.id, name: r.department.name },
      lead: r.leadMembershipId ? (leads.get(r.leadMembershipId) ?? null) : null,
      memberCount: mc.get(r.id) ?? 0,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async loadDepartment(tx: TxClient, businessId: string, id: string) {
    const d = await tx.department.findFirst({ where: { businessId, id } });
    if (!d) throw notFound();
    return d;
  }

  private async loadTeam(tx: TxClient, businessId: string, id: string) {
    const t = await tx.team.findFirst({
      where: { businessId, id },
      include: { department: { select: { id: true, name: true } } },
    });
    if (!t) throw notFound();
    return t;
  }

  // ---------- Departments ----------

  list(tenant: TenantContext, q: Out<typeof DepartmentListQ>): Promise<DepartmentListResponse> {
    return this.inFirm(tenant, async (tx) => {
      const where: Prisma.DepartmentWhereInput = {
        businessId: tenant.businessId,
        ...(STATUS[q.status] ? { status: STATUS[q.status] } : {}),
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.department.count({ where }),
        tx.department.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: await this.departmentRows(tx, tenant.businessId, rows),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  summary(tenant: TenantContext): Promise<DepartmentSummary> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const [departments, teams, staff, activeStaff] = await Promise.all([
        tx.department.count({ where: { businessId, status: { not: 'ARCHIVED' } } }),
        tx.team.count({ where: { businessId, status: { not: 'ARCHIVED' } } }),
        tx.membership.count({ where: { businessId, status: { not: 'DEACTIVATED' } } }),
        tx.membership.count({ where: { businessId, status: 'ACTIVE' } }),
      ]);
      return { departments, teams, staff, activeStaff };
    });
  }

  get(tenant: TenantContext, id: string): Promise<DepartmentDetail> {
    return this.inFirm(tenant, async (tx) => {
      const d = await this.loadDepartment(tx, tenant.businessId, id);
      const [row] = await this.departmentRows(tx, tenant.businessId, [d]);
      const teams = await tx.team.findMany({
        where: { businessId: tenant.businessId, departmentId: d.id, status: { not: 'ARCHIVED' } },
        include: { department: { select: { id: true, name: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      return {
        ...(row as Department),
        teams: await this.teamRows(tx, tenant.businessId, teams),
      };
    });
  }

  create(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateDepartmentBody>,
  ): Promise<Department> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      await this.nameFree(tx, businessId, body.name);
      if (body.headMembershipId)
        await this.activeMember(tx, businessId, body.headMembershipId, 'headMembershipId');
      const d = await tx.department.create({
        data: {
          businessId,
          name: body.name.trim(),
          description: body.description ?? null,
          headMembershipId: body.headMembershipId ?? null,
        },
      });
      await this.audit.logIn(
        tx,
        'department.created',
        { type: 'department', id: d.id },
        { departmentId: d.id, hasHead: d.headMembershipId !== null, actorUserId: userId },
      );
      return (await this.departmentRows(tx, businessId, [d]))[0] as Department;
    });
  }

  update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateDepartmentBody>,
  ): Promise<Department> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const d = await this.loadDepartment(tx, businessId, id);
      if (body.name !== undefined && body.name.trim().toLowerCase() !== d.name.toLowerCase())
        await this.nameFree(tx, businessId, body.name, d.id);
      if (body.headMembershipId)
        await this.activeMember(tx, businessId, body.headMembershipId, 'headMembershipId');
      // A department named to move people to is the firm's own, whether or not it is needed.
      if (body.moveTo) await this.loadDepartment(tx, businessId, body.moveTo);
      const leaving =
        body.status !== undefined && body.status !== 'ACTIVE' && d.status === 'ACTIVE';
      if (leaving) {
        const [people, teams] = await Promise.all([
          tx.memberDepartment.findMany({
            where: { businessId, departmentId: d.id, membership: { status: 'ACTIVE' } },
            select: { membershipId: true },
          }),
          tx.team.findMany({
            where: { businessId, departmentId: d.id, status: 'ACTIVE' },
            select: { id: true },
          }),
        ]);
        if (people.length || teams.length) {
          if (!body.moveTo)
            throw conflict('GROUP_IN_USE', 'Active staff or teams are in this department');
          if (body.moveTo === d.id) throw invalid('moveTo', 'Choose another department');
          const target = await tx.department.findFirst({
            where: { businessId, id: body.moveTo, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!target) throw invalid('moveTo', 'Choose an active department');
          const already = await tx.memberDepartment.findMany({
            where: { businessId, departmentId: target.id },
            select: { membershipId: true },
          });
          const there = new Set(already.map((a) => a.membershipId));
          await tx.memberDepartment.deleteMany({
            where: {
              businessId,
              departmentId: d.id,
              membershipId: { in: people.map((p) => p.membershipId) },
            },
          });
          await tx.memberDepartment.createMany({
            data: people
              .filter((p) => !there.has(p.membershipId))
              .map((p) => ({ businessId, membershipId: p.membershipId, departmentId: target.id })),
          });
          await tx.team.updateMany({
            where: { businessId, id: { in: teams.map((t) => t.id) } },
            data: { departmentId: target.id },
          });
        }
      }
      const saved = await tx.department.update({
        where: { id: d.id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.headMembershipId !== undefined
            ? { headMembershipId: body.headMembershipId }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'department.updated',
        { type: 'department', id: d.id },
        {
          departmentId: d.id,
          fields: Object.keys(body).filter((k) => k !== 'moveTo'),
          moved: leaving && body.moveTo !== undefined,
          actorUserId: userId,
        },
      );
      return (await this.departmentRows(tx, businessId, [saved]))[0] as Department;
    });
  }

  // ---------- Teams ----------

  teams(tenant: TenantContext, q: Out<typeof TeamListQ>): Promise<StaffTeamList> {
    return this.inFirm(tenant, async (tx) => {
      const rows = await tx.team.findMany({
        where: {
          businessId: tenant.businessId,
          ...(STATUS[q.status] ? { status: STATUS[q.status] } : {}),
          ...(q.departmentId ? { departmentId: q.departmentId } : {}),
          ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
        },
        include: { department: { select: { id: true, name: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 500,
      });
      return { items: await this.teamRows(tx, tenant.businessId, rows) };
    });
  }

  private async teamDetail(tx: TxClient, businessId: string, id: string): Promise<StaffTeamDetail> {
    const t = await this.loadTeam(tx, businessId, id);
    const [row] = await this.teamRows(tx, businessId, [t]);
    const members = await tx.teamMember.findMany({
      where: { businessId, teamId: t.id },
      include: { membership: { select: memberSelect } },
      orderBy: [{ createdAt: 'asc' }, { membershipId: 'asc' }],
    });
    return {
      ...(row as StaffTeam),
      members: members.map((m) => ({ ...ref(m.membership), kind: m.kind })),
    };
  }

  team(tenant: TenantContext, id: string): Promise<StaffTeamDetail> {
    return this.inFirm(tenant, (tx) => this.teamDetail(tx, tenant.businessId, id));
  }

  createTeam(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateTeamBody>,
  ): Promise<StaffTeam> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const dept = await this.loadDepartment(tx, businessId, body.departmentId);
      if (dept.status !== 'ACTIVE') throw invalid('departmentId', 'Choose an active department');
      await this.nameFree(tx, businessId, body.name);
      if (body.leadMembershipId)
        await this.activeMember(tx, businessId, body.leadMembershipId, 'leadMembershipId');
      const t = await tx.team.create({
        data: {
          businessId,
          departmentId: dept.id,
          name: body.name.trim(),
          description: body.description ?? null,
          leadMembershipId: body.leadMembershipId ?? null,
        },
        include: { department: { select: { id: true, name: true } } },
      });
      await this.audit.logIn(
        tx,
        'team.created',
        { type: 'team', id: t.id },
        { teamId: t.id, departmentId: dept.id, actorUserId: userId },
      );
      return (await this.teamRows(tx, businessId, [t]))[0] as StaffTeam;
    });
  }

  updateTeam(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateTeamBody>,
  ): Promise<StaffTeam> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const t = await this.loadTeam(tx, businessId, id);
      if (body.name !== undefined && body.name.trim().toLowerCase() !== t.name.toLowerCase())
        await this.nameFree(tx, businessId, body.name, t.id);
      if (body.leadMembershipId)
        await this.activeMember(tx, businessId, body.leadMembershipId, 'leadMembershipId');
      if (body.departmentId && body.departmentId !== t.departmentId) {
        const dept = await this.loadDepartment(tx, businessId, body.departmentId);
        if (dept.status !== 'ACTIVE') throw invalid('departmentId', 'Choose an active department');
      }
      if (body.status !== undefined && body.status !== 'ACTIVE' && t.status === 'ACTIVE') {
        const people = await tx.teamMember.count({
          where: { businessId, teamId: t.id, membership: { status: 'ACTIVE' } },
        });
        if (people) throw conflict('GROUP_IN_USE', 'Active staff are in this team');
      }
      const saved = await tx.team.update({
        where: { id: t.id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.leadMembershipId !== undefined
            ? { leadMembershipId: body.leadMembershipId }
            : {}),
          ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        include: { department: { select: { id: true, name: true } } },
      });
      await this.audit.logIn(
        tx,
        'team.updated',
        { type: 'team', id: t.id },
        { teamId: t.id, fields: Object.keys(body), actorUserId: userId },
      );
      return (await this.teamRows(tx, businessId, [saved]))[0] as StaffTeam;
    });
  }

  setTeamMembers(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SetTeamMembersBody>,
  ): Promise<StaffTeamDetail> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const t = await this.loadTeam(tx, businessId, id);
      if (t.status !== 'ACTIVE') throw invalid('members', 'Members join an active team');
      const ids = body.members.map((m) => m.membershipId);
      const active = ids.length
        ? await tx.membership.findMany({
            where: { businessId, id: { in: ids }, status: 'ACTIVE' },
            select: { id: true },
          })
        : [];
      const ok = new Set(active.map((m) => m.id));
      const bad = ids.findIndex((x) => !ok.has(x));
      if (bad >= 0)
        throw new ConflictException({
          code: 'MEMBER_NOT_ACTIVE',
          message: 'Every member must be an active member of the firm',
          details: [{ path: `members[${bad}]` }],
        });
      // One primary and one backup team per person.
      for (const kind of ['PRIMARY', 'BACKUP'] as const) {
        const mine = body.members.filter((m) => m.kind === kind).map((m) => m.membershipId);
        if (!mine.length) continue;
        const other = await tx.teamMember.findFirst({
          where: { businessId, kind, membershipId: { in: mine }, teamId: { not: t.id } },
          select: { membershipId: true },
        });
        if (other)
          throw invalid(
            `members[${body.members.findIndex((m) => m.membershipId === other.membershipId)}].kind`,
            `Already the ${kind.toLowerCase()} team of another team`,
          );
      }
      await tx.teamMember.deleteMany({ where: { businessId, teamId: t.id } });
      await tx.teamMember.createMany({
        data: body.members.map((m) => ({
          businessId,
          teamId: t.id,
          membershipId: m.membershipId,
          kind: m.kind,
        })),
      });
      await this.audit.logIn(
        tx,
        'team.members_set',
        { type: 'team', id: t.id },
        { teamId: t.id, count: body.members.length, actorUserId: userId },
      );
      return this.teamDetail(tx, businessId, t.id);
    });
  }

  // ---------- Department members (Octavia's SM13) ----------

  /** The staff assigned straight to the department, whatever their teams; never the deactivated. */
  private async departmentPeople(tx: TxClient, businessId: string, departmentId: string) {
    const rows = await tx.membership.findMany({
      where: { businessId, status: { in: [...LISTED] }, departments: { some: { departmentId } } },
      select: memberSelect,
      orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
    });
    return rows.map(ref);
  }

  /** GET .../departments/{id}/members: Manage Members, read as the department is. */
  departmentMembers(tenant: TenantContext, id: string): Promise<DepartmentMembers> {
    return this.inFirm(tenant, async (tx) => {
      const d = await this.loadDepartment(tx, tenant.businessId, id);
      return { members: await this.departmentPeople(tx, tenant.businessId, d.id) };
    });
  }

  /**
   * PUT .../departments/{id}/members: the department's whole list, with no team needed. Adds and
   * removes only member_departments rows of this department; a deactivated member keeps theirs.
   * Taking someone out of their only department is 409 LAST_DEPARTMENT, naming them.
   */
  setDepartmentMembers(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SetDepartmentMembersBody>,
  ): Promise<DepartmentMembers> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const d = await this.loadDepartment(tx, businessId, id);
      if (d.status !== 'ACTIVE')
        throw invalid('membershipIds', 'Members join an active department');
      const wanted = new Set(body.membershipIds);
      const live = wanted.size
        ? await tx.membership.findMany({
            where: { businessId, id: { in: [...wanted] }, status: { in: [...LISTED] } },
            select: { id: true },
          })
        : [];
      const ok = new Set(live.map((m) => m.id));
      const bad = body.membershipIds.findIndex((x) => !ok.has(x));
      if (bad >= 0)
        throw new ConflictException({
          code: 'MEMBER_NOT_ACTIVE',
          message: 'Every member must be an active, invited or locked member of the firm',
          details: [{ path: `membershipIds[${bad}]` }],
        });
      const current = await tx.memberDepartment.findMany({
        where: { businessId, departmentId: d.id, membership: { status: { in: [...LISTED] } } },
        select: {
          membershipId: true,
          membership: { select: { user: { select: { name: true } } } },
        },
      });
      const have = new Set(current.map((c) => c.membershipId));
      const removing = current.filter((c) => !wanted.has(c.membershipId));
      const adding = body.membershipIds.filter((m) => !have.has(m));
      if (removing.length) {
        const elsewhere = await tx.memberDepartment.findMany({
          where: {
            businessId,
            membershipId: { in: removing.map((r) => r.membershipId) },
            departmentId: { not: d.id },
            department: { status: { not: 'ARCHIVED' } },
          },
          select: { membershipId: true },
        });
        const kept = new Set(elsewhere.map((e) => e.membershipId));
        const alone = removing.filter((r) => !kept.has(r.membershipId));
        if (alone.length)
          throw new ConflictException({
            code: 'LAST_DEPARTMENT',
            message: 'Everyone keeps at least one department',
            details: alone.map((a) => ({
              path: 'membershipIds',
              message: `${a.membership.user.name} has no other department. Add one first.`,
            })),
          });
        await tx.memberDepartment.deleteMany({
          where: {
            businessId,
            departmentId: d.id,
            membershipId: { in: removing.map((r) => r.membershipId) },
          },
        });
      }
      if (adding.length)
        await tx.memberDepartment.createMany({
          data: adding.map((membershipId) => ({ businessId, membershipId, departmentId: d.id })),
        });
      await this.audit.logIn(
        tx,
        'department.members_set',
        { type: 'department', id: d.id },
        { departmentId: d.id, added: adding.length, removed: removing.length, actorUserId: userId },
      );
      return { members: await this.departmentPeople(tx, businessId, d.id) };
    });
  }

  // ---------- Org chart ----------

  orgChart(tenant: TenantContext): Promise<OrgChart> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const members = await tx.membership.findMany({
        where: { businessId, status: 'ACTIVE' },
        select: {
          ...memberSelect,
          staffProfile: { select: { supervisorId: true } },
          departments: {
            select: { department: { select: { id: true, name: true, status: true } } },
          },
          departmentsHeaded: { select: { id: true, name: true, status: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const live = (s: string) => s !== 'ARCHIVED';
      return {
        nodes: members.map((m) => ({
          ...ref(m),
          supervisorId: m.staffProfile?.supervisorId ?? null,
          departments: m.departments
            .filter((d) => live(d.department.status))
            .map((d) => ({ id: d.department.id, name: d.department.name })),
          heads: m.departmentsHeaded
            .filter((d) => live(d.status))
            .map((d) => ({ id: d.id, name: d.name })),
        })),
      };
    });
  }
}
