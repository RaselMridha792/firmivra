import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { SettingsOverview } from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { zonedDate, zonedInstant } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { allowedOf, rowsOf } from '../locations/locations-read.service.js';
import { activityItem, NOT_ACTIVITY, officeNamesOf } from './admin-activity.js';

/** The security events the Overview counts, over this many days. */
export const SECURITY_ALERT_DAYS = 7;
/** Failed sign-ins for one email in one hour that make a burst. */
export const FAILED_SIGN_IN_BURST = 3;

/**
 * Security Alerts: this firm's own security events in its audit log over the last 7 days, each
 * counted once:
 * - `auth.locked`: an account locked after repeated failed sign-ins (SIGN_IN_LIMIT.perAccount,
 *   auth/sign-in.service.ts), one per email and lock;
 * - `auth.sign_in_failed` bursts: 3 or more failed sign-ins (password or MFA code) for one email
 *   (or one sign-in attempt) within one clock hour that did not end in a lock that hour;
 * - `staff.mfa_reset`: a member's MFA was reset (Staff Management).
 * Sign-in events land in the firm's log for its portal's clients; staff sign-ins are the
 * platform's (one login serves several firms), so they are not a firm's to count. Nothing is
 * "resolved": the count is of the window.
 */
export async function securityAlerts(tx: TxClient, businessId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ n: bigint | number }[]>`
    WITH recent AS (
      SELECT action, created_at, metadata FROM audit_logs
      WHERE business_id = ${businessId}::uuid
        AND created_at > now() - make_interval(days => ${SECURITY_ALERT_DAYS}::int)
        AND action IN ('auth.locked', 'auth.sign_in_failed', 'staff.mfa_reset')
    ),
    locks AS (
      SELECT DISTINCT metadata ->> 'emailKey' AS who, metadata ->> 'lockedUntil' AS until,
        date_trunc('hour', created_at) AS hour
      FROM recent WHERE action = 'auth.locked'
    ),
    bursts AS (
      SELECT coalesce(metadata ->> 'emailKey', metadata ->> 'attemptId') AS who,
        date_trunc('hour', created_at) AS hour
      FROM recent WHERE action = 'auth.sign_in_failed'
      GROUP BY 1, 2 HAVING count(*) >= ${FAILED_SIGN_IN_BURST}::int
    )
    SELECT (SELECT count(*) FROM (SELECT DISTINCT who, until FROM locks) l)
      + (SELECT count(*) FROM bursts b WHERE b.who IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM locks l WHERE l.who = b.who AND l.hour = b.hour))
      + (SELECT count(*) FROM recent WHERE action = 'staff.mfa_reset') AS n`;
  return Number(row?.n ?? 0);
}

/** The first instant of this month on the firm's clock. */
export function monthStartOf(timeZone: string, now: number): Date {
  const today = zonedDate(timeZone, now);
  return new Date(zonedInstant(timeZone, `${today.slice(0, 8)}01`, 0));
}

/**
 * Settings > Overview for a firm (R42 contract, R1's location fields): staff, security alerts,
 * the 5 newest administrative events, active locations, the plan's allowance and the first 5
 * locations. The platform-only fields (companies, applications) are left out.
 */
@Injectable()
export class SettingsOverviewService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async overview(businessId: string): Promise<SettingsOverview> {
    const overview = await this.database.withScope(
      { kind: 'business', businessId },
      async (tx): Promise<SettingsOverview> => {
        const monthStart = monthStartOf(await firmTimeZone(tx, businessId), Date.now());
        const [staff, staffNew, alerts, rows, active, activated, allowed, first] =
          await Promise.all([
            tx.membership.count({ where: { businessId, status: { not: 'DEACTIVATED' } } }),
            tx.membership.count({
              where: { businessId, status: { not: 'DEACTIVATED' }, joinedAt: { gte: monthStart } },
            }),
            securityAlerts(tx, businessId),
            tx.auditLog.findMany({
              where: { businessId, ...NOT_ACTIVITY },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 5,
              select: {
                id: true,
                createdAt: true,
                action: true,
                entityType: true,
                entityId: true,
                metadata: true,
              },
            }),
            tx.firmOffice.findMany({
              where: { businessId, archivedAt: null, status: 'ACTIVE' },
              select: { id: true, createdAt: true },
            }),
            tx.auditLog.findMany({
              where: {
                businessId,
                action: 'firm_office.activated',
                entityType: 'firm_office',
                createdAt: { gte: monthStart },
              },
              select: { entityId: true },
            }),
            allowedOf(tx, businessId),
            tx.firmOffice.findMany({
              where: { businessId, archivedAt: null },
              orderBy: [{ isMain: 'desc' }, { name: 'asc' }, { id: 'asc' }],
              take: 5,
            }),
          ]);
        const activatedIds = new Set(activated.map((a) => a.entityId));
        const names = await officeNamesOf(tx, businessId, rows);
        return {
          staffUsers: { value: staff, addedThisMonth: staffNew },
          securityAlerts: alerts,
          recentActivity: rows.map((r) => activityItem(r, names)),
          activeLocations: {
            value: active.length,
            addedThisMonth: active.filter(
              (o) => o.createdAt >= monthStart || activatedIds.has(o.id),
            ).length,
          },
          locationAllowance: { used: active.length, allowed },
          locations: await rowsOf(tx, businessId, first),
        };
      },
    );
    await this.audit.log('settings.overview_viewed', { type: 'business', id: businessId });
    return overview;
  }
}
