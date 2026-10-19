import type { Prisma, TxClient } from '@firmivra/db';
import {
  SALES_CHANGE_SOURCE_LABELS,
  type SalesFeedEntry,
  type SalesFeedKind,
} from '@firmivra/types';
import { type SalesContext, SUBSCRIPTION_KIND } from './sales-common.js';
import { assignmentFeedKind, stageFeedKind } from './sales-math.js';

// Recent Activity and a record's history, read from the rows B5 keeps (docs/work/R60-sales.md):
// the stage and owner history the database writes, the activities, the follow-ups (their
// completion and cancellation actors from the audit rows this API writes), the notes, and the
// linked subscriptions' trials. Nothing here is stored as a feed.

const STAGE_KINDS: readonly SalesFeedKind[] = [
  'CREATED',
  'STAGE_CHANGED',
  'WON',
  'LOST',
  'UNDER_CONTRACT',
  'CLOSED',
  'TERMINATED',
];
const OWNER_KINDS: readonly SalesFeedKind[] = ['ASSIGNED', 'REASSIGNED', 'UNASSIGNED'];
const FOLLOW_UP_KINDS: readonly SalesFeedKind[] = [
  'FOLLOW_UP_SCHEDULED',
  'FOLLOW_UP_COMPLETED',
  'FOLLOW_UP_CANCELLED',
];

export interface FeedScope {
  /** One record (its history), or every record of a pipeline, or every record. */
  opportunityId?: string | undefined;
  pipelineId?: string | undefined;
  kinds?: readonly SalesFeedKind[] | undefined;
  limit: number;
}

const blank = {
  source: null,
  fromStage: null,
  toStage: null,
  lostReason: null,
  lostNote: null,
  transactionStatus: null,
  fromOwner: null,
  toOwner: null,
  followUp: null,
  communication: null,
} as const;

/** The feed, newest first: the latest rows of each source, merged. */
export async function feedOf(
  tx: TxClient,
  ctx: SalesContext,
  scope: FeedScope,
): Promise<SalesFeedEntry[]> {
  const want = (list: readonly SalesFeedKind[]) =>
    !scope.kinds?.length || list.some((k) => scope.kinds!.includes(k));
  const record: Prisma.SalesOpportunityWhereInput = {
    ...(scope.opportunityId ? { id: scope.opportunityId } : {}),
    ...(scope.pipelineId ? { pipelineId: scope.pipelineId } : {}),
  };
  const take = Math.max(scope.limit, 50) * 4;
  const opp = { select: { title: true, valueCents: true, convertedAt: true } } as const;
  const actor = (userId: string | null, fallback: string) =>
    userId
      ? { kind: 'USER' as const, name: ctx.nameOf(userId) }
      : { kind: 'SYSTEM' as const, name: fallback };
  const entries: SalesFeedEntry[] = [];

  const [stages, owners, followUps, activities, notes, linked] = await Promise.all([
    want(STAGE_KINDS)
      ? tx.salesStageHistory.findMany({
          where: { opportunity: record },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          include: { opportunity: opp },
        })
      : Promise.resolve([]),
    want(OWNER_KINDS)
      ? tx.salesAssignmentHistory.findMany({
          where: { opportunity: record },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          include: { opportunity: opp },
        })
      : Promise.resolve([]),
    want(FOLLOW_UP_KINDS)
      ? tx.salesFollowUp.findMany({
          where: { opportunity: record },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take,
          include: { opportunity: opp },
        })
      : Promise.resolve([]),
    want(['COMMUNICATION'])
      ? tx.salesActivity.findMany({
          where: { opportunity: record },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take,
          include: { opportunity: opp },
        })
      : Promise.resolve([]),
    want(['NOTE_ADDED'])
      ? tx.salesNote.findMany({
          where: { opportunity: record },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          include: { opportunity: opp },
        })
      : Promise.resolve([]),
    want(['TRIAL_STARTED'])
      ? tx.salesOpportunity.findMany({
          where: { ...record, transactionKind: SUBSCRIPTION_KIND, transactionId: { not: null } },
          select: { id: true, title: true, valueCents: true, transactionId: true },
        })
      : Promise.resolve([]),
  ]);

  for (const h of stages) {
    const kind = stageFeedKind(h, h.opportunity.convertedAt);
    entries.push({
      ...blank,
      id: h.id,
      kind,
      at: h.createdAt.toISOString(),
      opportunityId: h.opportunityId,
      firmName: h.opportunity.title,
      actor: actor(h.actorUserId, SALES_CHANGE_SOURCE_LABELS[h.source]),
      source: h.source,
      fromStage: h.fromStageName,
      toStage: h.toStageName,
      lostReason: h.lostReason,
      lostNote: h.lostNote,
      transactionStatus: h.transactionStatus,
      valueCents: h.opportunity.valueCents,
    });
  }
  for (const h of owners) {
    entries.push({
      ...blank,
      id: h.id,
      kind: assignmentFeedKind(h.fromUserId, h.toUserId),
      at: h.createdAt.toISOString(),
      opportunityId: h.opportunityId,
      firmName: h.opportunity.title,
      actor: actor(h.actorUserId, SALES_CHANGE_SOURCE_LABELS[h.source]),
      source: h.source,
      fromOwner: h.fromUserId ? ctx.nameOf(h.fromUserId) : null,
      toOwner: h.toUserId ? ctx.nameOf(h.toUserId) : null,
      valueCents: h.opportunity.valueCents,
    });
  }
  // Who completed or cancelled a follow-up: the audit row this API wrote with the change.
  const ended = followUps.filter((f) => f.status !== 'SCHEDULED').map((f) => f.id);
  const endedBy = new Map<string, string | null>();
  if (ended.length) {
    const rows = await tx.auditLog.findMany({
      where: {
        businessId: null,
        entityType: 'sales_follow_up',
        entityId: { in: ended },
        action: { in: ['sales_follow_up.completed', 'sales_follow_up.cancelled'] },
      },
      select: { entityId: true, actorUserId: true },
    });
    for (const r of rows) if (r.entityId) endedBy.set(r.entityId, r.actorUserId);
  }
  for (const f of followUps) {
    const base = {
      ...blank,
      id: f.id,
      opportunityId: f.opportunityId,
      firmName: f.opportunity.title,
      followUp: { kind: f.kind, title: f.title, dueAt: f.dueAt.toISOString() },
      valueCents: f.opportunity.valueCents,
    };
    entries.push({
      ...base,
      kind: 'FOLLOW_UP_SCHEDULED',
      at: f.createdAt.toISOString(),
      actor: actor(f.createdByUserId, 'System'),
    });
    const done = f.completedAt ?? f.cancelledAt;
    if (done)
      entries.push({
        ...base,
        kind: f.completedAt ? 'FOLLOW_UP_COMPLETED' : 'FOLLOW_UP_CANCELLED',
        at: done.toISOString(),
        actor: actor(endedBy.get(f.id) ?? null, 'Sales team'),
      });
  }
  for (const a of activities) {
    entries.push({
      ...blank,
      id: a.id,
      kind: 'COMMUNICATION',
      at: a.occurredAt.toISOString(),
      opportunityId: a.opportunityId,
      firmName: a.opportunity.title,
      actor: actor(a.actorUserId, 'System'),
      communication: {
        kind: a.kind,
        direction: a.direction,
        outcome: a.outcome,
        summary: a.summary,
      },
      valueCents: a.opportunity.valueCents,
    });
  }
  for (const n of notes) {
    entries.push({
      ...blank,
      id: n.id,
      kind: 'NOTE_ADDED',
      at: n.createdAt.toISOString(),
      opportunityId: n.opportunityId,
      firmName: n.opportunity.title,
      actor: actor(n.authorUserId, 'System'),
      valueCents: n.opportunity.valueCents,
    });
  }
  if (linked.length) {
    const subs = await tx.platformFirmSubscription.findMany({
      where: {
        id: { in: linked.flatMap((o) => (o.transactionId ? [o.transactionId] : [])) },
        trialStartedAt: { not: null },
      },
      select: { id: true, trialStartedAt: true },
    });
    const started = new Map(subs.map((s) => [s.id, s.trialStartedAt]));
    for (const o of linked) {
      const at = o.transactionId ? started.get(o.transactionId) : null;
      if (!at || !o.transactionId) continue;
      entries.push({
        ...blank,
        id: o.transactionId,
        kind: 'TRIAL_STARTED',
        at: at.toISOString(),
        opportunityId: o.id,
        firmName: o.title,
        actor: { kind: 'SYSTEM', name: 'Billing' },
        valueCents: o.valueCents,
      });
    }
  }
  return entries
    .filter((e) => !scope.kinds?.length || scope.kinds.includes(e.kind))
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    .slice(0, scope.limit);
}
