import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type BookkeepingAlerts,
  type BookkeepingSettings,
  DEFAULT_CLOSE_CHECKLIST,
  type StatusRules,
} from '@firmivra/types';
import { addActivity, iso } from './bookkeeping.mappers.js';
import { day, isoDay, nextReportDue, suggestStatus, toDay } from './bookkeeping.shared.js';

/** The firm's bookkeeping settings, or the defaults when it never saved any. */
export async function readSettings(tx: TxClient, businessId: string): Promise<BookkeepingSettings> {
  const s = await tx.bookkeepingSettings.findUnique({ where: { businessId } });
  return {
    defaultCadence: s?.defaultCadence ?? 'MONTHLY',
    closeTargetDay: s?.closeTargetDay ?? 10,
    upcomingReportDays: s?.upcomingReportDays ?? 14,
    staleSyncHours: s?.staleSyncHours ?? 48,
    reconToleranceCents: s?.reconToleranceCents ?? 0,
    statusRules: (s?.statusRules ?? {}) as StatusRules,
    reminderDefaults: (s?.reminderDefaults ?? []) as BookkeepingSettings['reminderDefaults'],
    reportSchedule: (s?.reportSchedule ?? []) as BookkeepingSettings['reportSchedule'],
    documentChecklist: (s?.documentChecklist ?? []) as BookkeepingSettings['documentChecklist'],
    closeChecklist: (s?.closeChecklist ?? []) as BookkeepingSettings['closeChecklist'],
    updatedAt: iso(s?.updatedAt ?? null),
  };
}

/** What a new period's checklist is made of: the firm's steps, else the standard twelve. */
export const closeChecklistOf = (settings: Pick<BookkeepingSettings, 'closeChecklist'>) =>
  settings.closeChecklist.length > 0 ? settings.closeChecklist : [...DEFAULT_CLOSE_CHECKLIST];

/**
 * Keeps a client's status current from the firm's rules (due dates, outstanding document
 * requests, sync problems, items waiting). A status set by hand, and a paused or archived
 * client, are left alone. A change of status is written to the client's activity history.
 */
@Injectable()
export class BookkeepingStatusService {
  /** The end of the latest period that was closed or whose report was delivered. */
  async lastCompletedEnd(
    tx: TxClient,
    businessId: string,
    engagementId: string,
  ): Promise<string | null> {
    const [closed, delivered] = await Promise.all([
      tx.bookkeepingPeriod.findFirst({
        where: { businessId, engagementId, status: 'CLOSED' },
        orderBy: { periodEnd: 'desc' },
        select: { periodEnd: true },
      }),
      tx.bookkeepingReport.findFirst({
        where: { businessId, engagementId, status: 'DELIVERED', periodId: { not: null } },
        orderBy: { period: { periodEnd: 'desc' } },
        select: { period: { select: { periodEnd: true } } },
      }),
    ]);
    const ends = [closed?.periodEnd, delivered?.period?.periodEnd]
      .filter((d): d is Date => !!d)
      .map((d) => d.getTime());
    return ends.length ? day(new Date(Math.max(...ends))) : null;
  }

  /**
   * After a period closes or a report is delivered: the next report date follows from the cadence
   * and the last completed period, and the status follows the rules.
   */
  async followChange(
    tx: TxClient,
    businessId: string,
    actorUserId: string | null,
    profile: {
      id: string;
      engagementId: string;
      cadence: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM';
      cadenceMonths: number | null;
      closeTargetDay: number | null;
    },
  ): Promise<void> {
    const settings = await readSettings(tx, businessId);
    const due = nextReportDue({
      cadence: profile.cadence,
      cadenceMonths: profile.cadenceMonths,
      closeTargetDay: profile.closeTargetDay ?? settings.closeTargetDay,
      lastCompletedEnd: await this.lastCompletedEnd(tx, businessId, profile.engagementId),
      today: new Date(),
    });
    await tx.bookkeepingProfile.update({
      where: { id: profile.id },
      data: { nextReportDueOn: toDay(due.dueOn) },
    });
    await this.refresh(tx, businessId, profile.engagementId, actorUserId, settings);
  }

  /** Works out one client's status in the caller's transaction; true when it changed. */
  async refresh(
    tx: TxClient,
    businessId: string,
    engagementId: string,
    actorUserId: string | null,
    settingsIn?: BookkeepingSettings,
    now = new Date(),
  ): Promise<boolean> {
    const profile = await tx.bookkeepingProfile.findFirst({
      where: {
        businessId,
        engagementId,
        archivedAt: null,
        pausedAt: null,
        statusSource: 'AUTOMATIC',
      },
      select: {
        id: true,
        status: true,
        statusReason: true,
        nextReportDueOn: true,
        alerts: true,
      },
    });
    if (!profile) return false;
    const settings = settingsIn ?? (await readSettings(tx, businessId));
    const today = isoDay(now);
    const missingCutoff = new Date(
      now.getTime() - (settings.statusRules.missingDocumentsAfterDays ?? 0) * 86_400_000,
    );
    const [periods, reports, connections, requests] = await Promise.all([
      tx.bookkeepingPeriod.findMany({
        where: { businessId, engagementId },
        select: { status: true, closeByOn: true, uncategorizedCount: true, periodStart: true },
        orderBy: { periodStart: 'desc' },
      }),
      tx.bookkeepingReport.findMany({
        where: { businessId, engagementId },
        select: { status: true, dueOn: true },
      }),
      tx.bookkeepingConnection.findMany({
        where: { businessId, engagementId, status: { not: 'DISCONNECTED' } },
        select: { status: true, lastSuccessfulSyncAt: true },
      }),
      tx.documentRequest.count({
        where: {
          businessId,
          engagementId,
          status: { in: ['REQUESTED', 'REJECTED'] },
          createdAt: { lte: missingCutoff },
        },
      }),
    ]);
    const earliest = (days: (string | null)[]) =>
      days.filter((d): d is string => d !== null).sort()[0] ?? null;
    const staleCutoff = now.getTime() - settings.staleSyncHours * 3_600_000;
    const suggested = suggestStatus({
      today,
      rules: settings.statusRules,
      alerts: profile.alerts as BookkeepingAlerts,
      started:
        periods.some((p) => p.status !== 'NOT_STARTED') ||
        reports.some((r) => r.status !== 'NOT_STARTED'),
      overdueClose: earliest(
        periods.filter((p) => p.status !== 'CLOSED').map((p) => day(p.closeByOn)),
      ),
      overdueReport: earliest([
        ...reports.filter((r) => r.status !== 'DELIVERED').map((r) => day(r.dueOn)),
        day(profile.nextReportDueOn),
      ]),
      outstandingRequests: requests,
      failedConnection: connections.some((c) => c.status === 'ERROR' || c.status === 'EXPIRED'),
      staleConnection: connections.some(
        (c) =>
          c.status === 'CONNECTED' &&
          c.lastSuccessfulSyncAt !== null &&
          c.lastSuccessfulSyncAt.getTime() < staleCutoff,
      ),
      uncategorized: periods[0]?.uncategorizedCount ?? null,
      readyForReview: periods.some((p) => p.status === 'READY_FOR_REVIEW'),
    });
    if (suggested.status === profile.status && suggested.reason === profile.statusReason) {
      return false;
    }
    const data: Prisma.BookkeepingProfileUncheckedUpdateInput = {
      status: suggested.status,
      statusReason: suggested.reason,
    };
    await tx.bookkeepingProfile.update({ where: { id: profile.id }, data });
    if (suggested.status !== profile.status) {
      await addActivity(
        tx,
        businessId,
        engagementId,
        actorUserId,
        'STATUS_CHANGE',
        `Status changed from ${profile.status} to ${suggested.status}`,
        { from: profile.status, to: suggested.status, source: 'AUTOMATIC' },
      );
    }
    return true;
  }
}
