import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import {
  FIRM_ROLE_LABELS,
  FIRM_ROLES,
  type FirmUser,
  type FirmUserList,
  type MembershipRole,
  type StaffListItem,
  type UsersSummary,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { csvRow } from '../bookkeeping/bookkeeping.shared.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import type { UsersQ } from './staff-input.js';
import { StaffReadService } from './staff-read.service.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The roles whose name contains the search ("manager" finds the Managers). */
export const rolesMatching = (search: string | undefined): MembershipRole[] => {
  const s = search?.trim().toLowerCase();
  return s ? FIRM_ROLES.filter((r) => FIRM_ROLE_LABELS[r].toLowerCase().includes(s)) : [];
};

const STATUS_TEXT: Record<StaffListItem['status'], string> = {
  ACTIVE: 'Active',
  INVITED: 'Pending',
  LOCKED: 'Locked',
  DEACTIVATED: 'Inactive',
};
const MFA_TEXT: Record<StaffListItem['mfa'], string> = {
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
  PENDING: 'Pending',
};

export const EXPORT_HEADER = csvRow([
  'Name',
  'Email',
  'Role',
  'Company',
  'Status',
  'MFA',
  'Last login',
  'Invited',
]);

/** One export row: basic employee fields only, never a password, code, token or MFA secret. */
export const exportLine = (u: FirmUser): string =>
  csvRow([
    u.name,
    u.email,
    FIRM_ROLE_LABELS[u.role],
    u.company,
    STATUS_TEXT[u.status],
    MFA_TEXT[u.mfa],
    u.lastLoginAt,
    u.invite?.sentAt ?? null,
  ]);

const PAGE = 100;

/**
 * Settings > Users & Roles (R42 contract, packages/types/src/settings/users.ts): the employees
 * with system access, their counters and the CSV export, for Owner and Admin. The rows are the
 * Staff Management directory's, plus the firm's name as the company (a firm has one).
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly staff: StaffReadService,
    private readonly audit: AuditService,
  ) {}

  private company(tenant: TenantContext): Promise<string> {
    return this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) =>
        (
          await tx.business.findUniqueOrThrow({
            where: { id: tenant.businessId },
            select: { name: true },
          })
        ).name,
    );
  }

  async list(tenant: TenantContext, userId: string, q: Out<typeof UsersQ>): Promise<FirmUserList> {
    const [page, company] = await Promise.all([
      this.staff.list(tenant, userId, { ...q, departmentId: undefined }, rolesMatching(q.search)),
      this.company(tenant),
    ]);
    return { ...page, items: page.items.map((u) => ({ ...u, company })) };
  }

  /**
   * Total Users counts accepted accounts (Active, Locked, Inactive); Pending Invitations counts
   * the invited ones on their own (Octavia's review, Oct 18). Roles: the firm's eight roles; no
   * custom role exists yet.
   */
  summary(tenant: TenantContext): Promise<UsersSummary> {
    return this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const businessId = tenant.businessId;
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const [by, added] = await Promise.all([
          tx.membership.groupBy({ by: ['status'], where: { businessId }, _count: { _all: true } }),
          tx.membership.count({
            where: { businessId, status: { not: 'INVITED' }, createdAt: { gte: monthStart } },
          }),
        ]);
        const n = (s: string) => by.find((b) => b.status === s)?._count._all ?? 0;
        return {
          total: n('ACTIVE') + n('LOCKED') + n('DEACTIVATED'),
          addedThisMonth: added,
          active: n('ACTIVE'),
          pendingInvitations: n('INVITED'),
          roles: FIRM_ROLES.length,
        };
      },
    );
  }

  /** Every matching row (all pages) as CSV, audited with the count and the filters used. */
  async export(tenant: TenantContext, userId: string, q: Out<typeof UsersQ>): Promise<string> {
    const lines = [EXPORT_HEADER];
    for (let page = 1; ; page++) {
      const batch = await this.list(tenant, userId, { ...q, page, pageSize: PAGE });
      lines.push(...batch.items.map(exportLine));
      if (page * PAGE >= batch.total || !batch.items.length) break;
    }
    const filters = (['search', 'role', 'status'] as const).filter(
      (k) => q[k] !== undefined && !(k === 'status' && q.status === 'all'),
    );
    await this.audit.log(
      'users.exported',
      { type: 'membership' },
      { count: lines.length - 1, filters },
    );
    return `${lines.join('\r\n')}\r\n`;
  }
}
