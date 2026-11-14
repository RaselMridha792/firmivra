import {
  type LeadAgeBucket,
  type LeadFunnelStage,
  type LeadProfile,
  type LeadReport,
  type LeadReportLeads,
  LeadReportLeadsQuery,
  LeadReportQuery,
  parseInput,
} from '@firmivra/types';

// Leads R2 18 on mock data: the funnel and aging report counted from the leads mock's leads, with
// the API's definitions (apps/api/src/leads/lead-reports.service.ts). The mock keeps no status
// history, so a closed lead reached New only and a lead's time in its stage counts from when it
// came in.

const DAY = 86_400_000;
const STAGES: LeadFunnelStage[] = [
  'NEW',
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
  'CONVERTED',
];
const BUCKETS: LeadAgeBucket[] = ['D0_7', 'D8_14', 'D15_30', 'D31_60', 'D61_PLUS'];
const STAGE_OF: Partial<Record<string, LeadFunnelStage>> = {
  SUBMITTED: 'NEW',
  IN_REVIEW: 'NEW',
  CONTACTED: 'CONTACTED',
  IN_FOLLOW_UP: 'IN_FOLLOW_UP',
  APPOINTMENT_SCHEDULED: 'APPOINTMENT_SCHEDULED',
  QUALIFIED: 'QUALIFIED',
  CONVERTED: 'CONVERTED',
};
const day = (at: Date | string) => new Date(at).toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  day(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY));
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY);
const bucketOf = (days: number): LeadAgeBucket =>
  days <= 7
    ? 'D0_7'
    : days <= 14
      ? 'D8_14'
      : days <= 30
        ? 'D15_30'
        : days <= 60
          ? 'D31_60'
          : 'D61_PLUS';

function counted(leads: LeadProfile[], query: LeadReportQuery) {
  const q = parseInput(LeadReportQuery, query);
  const today = day(new Date());
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -89);
  const items = leads
    .filter(
      (l) =>
        (q.archived === 'include' || !l.archivedAt) &&
        (!q.source || l.source === q.source) &&
        (!q.serviceId || l.services.some((s) => s.id === q.serviceId)) &&
        (!q.assignedUserId || l.assignedTo?.userId === q.assignedUserId) &&
        (!q.campaignId || l.campaign?.id === q.campaignId) &&
        day(l.createdAt) >= from &&
        day(l.createdAt) <= to,
    )
    .map((l) => {
      const stage = STAGE_OF[l.stage] ?? null;
      const open = !!stage && stage !== 'CONVERTED';
      return {
        lead: l,
        stage,
        open,
        furthest: stage ? STAGES.indexOf(stage) : 0,
        daysInStage: open ? Math.max(0, daysBetween(day(l.createdAt), today)) : null,
        daysIdle: l.lastContact ? Math.max(0, daysBetween(day(l.lastContact.at), today)) : null,
      };
    });
  return { from, to, today, items };
}

/** `funnelReport` on the given leads (those the member reaches, archived included). */
export function mockFunnelReport(leads: LeadProfile[], query: LeadReportQuery = {}): LeadReport {
  const { from, to, today, items } = counted(leads, query);
  const open = items.filter((i) => i.open);
  return {
    from,
    to,
    today,
    total: items.length,
    funnel: STAGES.map((stage, n) => ({
      stage,
      reached: items.filter((i) => i.furthest >= n).length,
      current: items.filter((i) => i.stage === stage).length,
    })),
    closed: {
      notQualified: items.filter((i) => i.lead.stage === 'DECLINED').length,
      lost: items.filter((i) => i.lead.stage === 'LOST').length,
    },
    conversionRate: items.length
      ? items.filter((i) => i.lead.stage === 'CONVERTED').length / items.length
      : null,
    aging: {
      open: open.length,
      inStage: BUCKETS.map((bucket) => ({
        bucket,
        count: open.filter((i) => bucketOf(i.daysInStage!) === bucket).length,
      })),
      idle: BUCKETS.map((bucket) => ({
        bucket,
        count: open.filter((i) => i.daysIdle !== null && bucketOf(i.daysIdle) === bucket).length,
      })),
      noActivity: open.filter((i) => i.daysIdle === null).length,
      byStage: STAGES.filter((s) => s !== 'CONVERTED').map((stage) => {
        const here = open.filter((i) => i.stage === stage);
        return {
          stage,
          open: here.length,
          averageDays: here.length
            ? Math.round(here.reduce((n, i) => n + i.daysInStage!, 0) / here.length)
            : null,
        };
      }),
    },
  };
}

/** `funnelReportLeads` on the given leads: the leads behind one number. */
export function mockFunnelReportLeads(
  leads: LeadProfile[],
  query: LeadReportLeadsQuery,
): LeadReportLeads {
  const q = parseInput(LeadReportLeadsQuery, query);
  const { metric: _metric, key: _key, ...filters } = q;
  const { items } = counted(leads, filters);
  const stage = STAGES.indexOf(q.key as LeadFunnelStage);
  const picked = items.filter((i) => {
    switch (q.metric) {
      case 'REACHED':
        return i.furthest >= stage;
      case 'CURRENT':
      case 'OPEN_STAGE':
        return i.stage === STAGES[stage];
      case 'CLOSED':
        return i.lead.stage === (q.key === 'LOST' ? 'LOST' : 'DECLINED');
      case 'IN_STAGE':
        return i.open && bucketOf(i.daysInStage!) === q.key;
      case 'IDLE':
        return (
          i.open &&
          (q.key === 'NONE'
            ? i.daysIdle === null
            : i.daysIdle !== null && bucketOf(i.daysIdle) === q.key)
        );
    }
  });
  const sorted = picked.sort(
    (a, b) =>
      (b.daysInStage ?? -1) - (a.daysInStage ?? -1) || (b.daysIdle ?? -1) - (a.daysIdle ?? -1),
  );
  return {
    items: sorted.slice(0, 200).map((i) => ({
      id: i.lead.id,
      name: `${i.lead.firstName} ${i.lead.lastName}`.trim(),
      status: i.lead.stage,
      source: i.lead.source,
      owner: i.lead.assignedTo?.name ?? null,
      createdAt: i.lead.createdAt,
      daysInStage: i.daysInStage,
      daysIdle: i.daysIdle,
    })),
    total: sorted.length,
  };
}
