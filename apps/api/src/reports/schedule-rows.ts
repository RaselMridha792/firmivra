import type { Prisma, TxClient } from '@firmivra/db';
import type { ReportScheduleRow } from '@firmivra/types';
import { memberNames } from '../workspaces/common.js';
import { SYSTEM_REPORTS } from './reports.common.js';
import { describeSchedule } from './schedule-math.js';

export const scheduleInclude = {
  definition: { select: { id: true, name: true, category: true } },
  recipients: { select: { userId: true, email: true } },
} satisfies Prisma.ReportScheduleInclude;
export type ScheduleShape = Prisma.ReportScheduleGetPayload<{ include: typeof scheduleInclude }>;

const time = (d: Date) => d.toISOString().slice(11, 16);

/** The rows of the dashboard's Scheduled Reports and the schedules list. */
export async function toScheduleRows(
  tx: TxClient,
  businessId: string,
  rows: ScheduleShape[],
): Promise<ReportScheduleRow[]> {
  const names = await memberNames(
    tx,
    businessId,
    rows.map((r) => r.ownerUserId),
  );
  return rows.map((r) => {
    const sys = r.systemKey ? SYSTEM_REPORTS.find((s) => s.key === r.systemKey) : undefined;
    return {
      id: r.id,
      name: r.name,
      reportName: r.definition?.name ?? sys?.name ?? 'Report',
      category: r.definition?.category ?? sys?.category ?? 'FINANCIAL',
      frequency: r.frequency,
      description: describeSchedule({
        frequency: r.frequency,
        weekday: r.weekday,
        dayOfMonth: r.dayOfMonth,
        monthOfYear: r.monthOfYear,
        runTime: time(r.runTime),
      }),
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastStatus: r.lastStatus,
      recipientCount: r.recipients.length,
      formats: r.formats,
      owner: { userId: r.ownerUserId, name: names.get(r.ownerUserId) ?? 'Former member' },
      active: r.active,
    };
  });
}
