import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { databaseErrorCode, type Prisma, type TxClient } from '@firmivra/db';
import {
  SALES_APPOINTMENT_KINDS,
  SALES_DEFAULT_PIPELINE_KEY,
  SALES_ERRORS,
  SALES_STAGE_ACTION_KEYS,
  SALES_STAGE_REQUIREMENT_KEYS,
  type SalesAttentionSettings,
  type SalesErrorCode,
  type SalesFollowUp,
  type SalesOpportunity,
  type SalesPermissions,
  type SalesPipeline,
  type SalesRep,
  type SalesStage,
  type SalesStageAction,
  type SalesStageRequirement,
  salesStageTone,
} from '@firmivra/types';
import { attentionOf, contactStats } from './sales-math.js';

// What every Sales read and write needs, in the Super Admin's admin scope: the errors, the team,
// the attention settings, the stage and pipeline shapes, and one opportunity view for the board,
// the list, the KPIs and the record (docs/work/R60-sales.md, "Sales API").

type Status = 400 | 403 | 404 | 409 | 422;
export const salesError = (
  status: Status,
  code: SalesErrorCode | 'VALIDATION_FAILED',
  message?: string,
) => {
  const body = {
    code,
    message:
      message ?? (code === 'VALIDATION_FAILED' ? 'The request is not valid' : SALES_ERRORS[code]),
  };
  switch (status) {
    case 400:
      return new BadRequestException(body);
    case 403:
      return new ForbiddenException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    default:
      return new UnprocessableEntityException(body);
  }
};
export const notFound = (what = 'Sales record') =>
  salesError(404, 'NOT_FOUND', `${what} not found`);
export const invalid = (message: string) => salesError(400, 'VALIDATION_FAILED', message);

/** The HTTP status each contract code answers with. */
const STATUS: Readonly<Record<SalesErrorCode, Status>> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  POSSIBLE_DUPLICATE: 409,
  DUPLICATE_NAME: 409,
  INACTIVE_CHOICE: 422,
  STAGE_INACTIVE: 422,
  VALUE_REQUIRED: 422,
  OWNER_REQUIRED: 422,
  PLAN_REQUIRED: 422,
  TRANSACTION_REQUIRED: 422,
  LOST_REASON_REQUIRED: 422,
  LOST_NOTE_REQUIRED: 422,
  LOST_REASON_NOT_ALLOWED: 422,
  TRANSACTION_LOCKED: 422,
  UNLINK_UNDER_CONTRACT: 409,
  TRANSACTION_IN_USE: 409,
  FIRM_MISMATCH: 422,
  SYNC_STAGE_REQUIRED: 422,
  SHIPPED_STAGE: 422,
  STAGE_HAS_RECORDS: 422,
  RETURN_STAGE_INVALID: 422,
  FOLLOW_UP_CLOSED: 409,
  NOT_AUTHOR: 403,
  IN_THE_FUTURE: 422,
  TARGET_EXISTS: 409,
  TARGET_ARCHIVED: 409,
  TEAM_INACTIVE: 422,
  INVALID_TARGET_VALUE: 422,
  NOT_SUPPORTED_YET: 422,
};
/** A contract error with its status and message. */
export const refuse = (code: SalesErrorCode, message?: string) =>
  salesError(STATUS[code], code, message);

/** The database's own message behind a Prisma error (the pg adapter keeps it), or ''. */
function databaseMessage(error: unknown): string {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta
    ?.driverAdapterError?.cause as { originalMessage?: unknown; message?: unknown } | undefined;
  const message = cause?.originalMessage ?? cause?.message;
  return typeof message === 'string' ? message : '';
}

/** B5's and D1's trigger messages (`sales …: …`) and the contract code each one means. */
const TRIGGER_MESSAGES: readonly [string, SalesErrorCode][] = [
  ['needs value', 'VALUE_REQUIRED'],
  ['needs assignee', 'OWNER_REQUIRED'],
  ['needs plan', 'PLAN_REQUIRED'],
  ['needs transaction', 'TRANSACTION_REQUIRED'],
  ['needs lost_note', 'LOST_NOTE_REQUIRED'],
  ['a lost record needs a reason', 'LOST_REASON_REQUIRED'],
  ['OTHER needs a note', 'LOST_NOTE_REQUIRED'],
  ['a lost reason comes with a lost stage', 'LOST_REASON_NOT_ALLOWED'],
  ['is inactive', 'STAGE_INACTIVE'],
  ['is not unlinked', 'UNLINK_UNDER_CONTRACT'],
  ['the stage follows the', 'TRANSACTION_LOCKED'],
  ['Under Contract follows', 'TRANSACTION_LOCKED'],
  ['has no active stage for', 'SYNC_STAGE_REQUIRED'],
  ['no stage to return', 'SYNC_STAGE_REQUIRED'],
  ['returns to an active or converted stage', 'RETURN_STAGE_INVALID'],
  ['a shipped stage', 'SHIPPED_STAGE'],
  ['move the records out', 'STAGE_HAS_RECORDS'],
  ['follow-up never changes', 'FOLLOW_UP_CLOSED'],
  ['in the future', 'IN_THE_FUTURE'],
  ['archived target never changes', 'TARGET_ARCHIVED'],
  ['active department', 'TEAM_INACTIVE'],
];

/**
 * A backstop for a database refusal the checks before it missed: the trigger's rule as its
 * contract code (422 or 409), a unique index as `unique`, a foreign key as `foreignKey`.
 * Anything else is rethrown as it was.
 */
export function asSalesError(
  error: unknown,
  codes: { unique?: SalesErrorCode; foreignKey?: SalesErrorCode } = {},
): unknown {
  const sqlState = databaseErrorCode(error);
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === 'P2002' || sqlState === '23505')
    return refuse(codes.unique ?? 'DUPLICATE_NAME');
  if (prismaCode === 'P2025') return notFound();
  if (sqlState === '23503' || prismaCode === 'P2003')
    return refuse(codes.foreignKey ?? 'INACTIVE_CHOICE');
  if (sqlState === '23514') {
    const message = databaseMessage(error);
    const hit = TRIGGER_MESSAGES.find(([text]) => message.includes(text));
    return hit ? refuse(hit[1]) : invalid('The database refused this change');
  }
  return error;
}

// ---------- The team and the settings ----------

export interface SalesContext {
  now: number;
  me: { id: string; name: string };
  permissions: SalesPermissions;
  /** Everyone who can own records (active first), and former owners with their names. */
  reps: SalesRep[];
  rules: SalesAttentionSettings;
  repOf(userId: string | null): SalesRep | null;
  /** A team member's name by user id ("System" for the platform). */
  nameOf(userId: string | null): string;
}

const ALL: SalesPermissions = {
  managePipelines: true,
  assign: true,
  bulkEdit: true,
  export: true,
  manageTargets: true,
  manageSettings: true,
};

/**
 * The Sales team: every platform admin. Super Admins, team members without an org-chart row yet
 * and ACTIVE members take new records (Scrum thread, Oct 19: any active platform admin can be a
 * rep). Only Super Admins sign in to the console today, so the caller has every sales permission
 * and reaches every record (recordScope COMPANY); no `sales.*` keys are read until there are more
 * platform roles.
 */
export async function loadContext(
  tx: TxClient,
  adminUserId: string,
  now = Date.now(),
): Promise<SalesContext> {
  const [admins, settings] = await Promise.all([
    tx.platformAdmin.findMany({
      select: {
        userId: true,
        role: true,
        member: { select: { status: true, roleDefinition: { select: { title: true } } } },
      },
    }),
    tx.salesAttentionSettings.findUnique({ where: { id: 1 } }),
  ]);
  const users = await tx.user.findMany({
    where: { id: { in: admins.map((a) => a.userId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const reps: SalesRep[] = [];
  for (const a of admins) {
    const name = names.get(a.userId);
    if (!name) continue;
    const superAdmin = a.role === 'SUPER_ADMIN';
    reps.push({
      id: a.userId,
      name,
      role: a.member?.roleDefinition.title ?? (superAdmin ? 'Super Admin' : 'Team member'),
      active: superAdmin || !a.member || a.member.status === 'ACTIVE',
    });
  }
  reps.sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name));
  const everyone = new Map(reps.map((rep) => [rep.id, rep]));
  const me = admins.find((a) => a.userId === adminUserId);
  if (!me || me.role !== 'SUPER_ADMIN')
    throw salesError(403, 'FORBIDDEN', 'Your sales role does not allow this');
  const rules: SalesAttentionSettings = {
    noContactHours: settings?.noContactHours ?? 24,
    followUpDueHours: settings?.followUpDueHours ?? 24,
    noResponseAttempts: settings?.noResponseAttempts ?? 3,
    noActivityDays: settings?.noActivityDays ?? 14,
    ownerRequired: settings?.ownerRequired ?? true,
    lostOtherNoteRequired: settings?.lostOtherNoteRequired ?? true,
    updatedAt: (settings?.updatedAt ?? new Date(now)).toISOString(),
    updatedBy: settings?.updatedByUserId ? (names.get(settings.updatedByUserId) ?? null) : null,
  };
  return {
    now,
    me: { id: adminUserId, name: names.get(adminUserId) ?? 'Super Admin' },
    permissions: ALL,
    reps,
    rules,
    repOf: (userId) =>
      userId
        ? (everyone.get(userId) ?? {
            id: userId,
            name: 'Former team member',
            role: '',
            active: false,
          })
        : null,
    nameOf: (userId) => (userId ? (names.get(userId) ?? 'Former team member') : 'System'),
  };
}

/** 422 INACTIVE_CHOICE unless the user may take new records. */
export function activeRep(ctx: SalesContext, userId: string): SalesRep {
  const rep = ctx.reps.find((r) => r.id === userId);
  if (!rep?.active)
    throw refuse('INACTIVE_CHOICE', 'That team member cannot take new sales records.');
  return rep;
}

// ---------- Stages and pipelines ----------

const REQUIREMENT_BY_KEY = new Map(
  Object.entries(SALES_STAGE_REQUIREMENT_KEYS).map(([k, v]) => [v, k as SalesStageRequirement]),
);
const ACTION_BY_KEY = new Map(
  Object.entries(SALES_STAGE_ACTION_KEYS).map(([k, v]) => [v, k as SalesStageAction]),
);
export const requirementsOf = (keys: readonly string[]) =>
  keys.flatMap((k) => {
    const r = REQUIREMENT_BY_KEY.get(k);
    return r ? [r] : [];
  });
export const actionsOf = (keys: readonly string[]) =>
  keys.flatMap((k) => {
    const a = ACTION_BY_KEY.get(k);
    return a ? [a] : [];
  });

export const stageSelect = {
  id: true,
  pipelineId: true,
  name: true,
  systemKey: true,
  stageType: true,
  position: true,
  isActive: true,
  requiredFields: true,
  onEnterActions: true,
  updatedAt: true,
} satisfies Prisma.SalesPipelineStageSelect;
export type StageRow = Prisma.SalesPipelineStageGetPayload<{ select: typeof stageSelect }>;

export const stageOrder = (a: StageRow, b: StageRow) =>
  a.position - b.position || a.id.localeCompare(b.id);

export const stageView = (s: StageRow, records: number): SalesStage => ({
  id: s.id,
  name: s.name,
  systemKey: s.systemKey,
  type: s.stageType,
  tone: salesStageTone({ systemKey: s.systemKey, type: s.stageType }),
  position: s.position,
  active: s.isActive,
  requires: requirementsOf(s.requiredFields),
  onEnter: actionsOf(s.onEnterActions),
  records,
});

/** The stage a stage's rules see (entryProblem). */
export const entryStage = (s: StageRow) => ({
  type: s.stageType,
  active: s.isActive,
  requires: requirementsOf(s.requiredFields),
});

/** The default pipeline: the shipped one, else the first active one. */
export async function defaultPipelineId(tx: TxClient): Promise<string> {
  const shipped = await tx.salesPipeline.findFirst({
    where: { systemKey: SALES_DEFAULT_PIPELINE_KEY },
    select: { id: true },
  });
  if (shipped) return shipped.id;
  const any = await tx.salesPipeline.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!any) throw notFound('Pipeline');
  return any.id;
}

/** A pipeline with its stages in board order and each stage's record count. */
export async function loadPipelines(
  tx: TxClient,
  where: Prisma.SalesPipelineWhereInput = {},
): Promise<SalesPipeline[]> {
  const pipelines = await tx.salesPipeline.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { stages: { select: stageSelect } },
  });
  const counts = await tx.salesOpportunity.groupBy({
    by: ['stageId'],
    where: { pipelineId: { in: pipelines.map((p) => p.id) } },
    _count: { _all: true },
  });
  const count = new Map(counts.map((c) => [c.stageId, c._count._all]));
  return pipelines
    .map((p) => {
      const stages = [...p.stages].sort(stageOrder);
      const updated = Math.max(p.updatedAt.getTime(), ...stages.map((s) => s.updatedAt.getTime()));
      return {
        id: p.id,
        name: p.name,
        description: p.description ?? '',
        systemKey: p.systemKey,
        isDefault: p.systemKey === SALES_DEFAULT_PIPELINE_KEY,
        active: p.isActive,
        terminatedReturnStageId: p.terminatedReturnStageId,
        stages: stages.map((s) => stageView(s, count.get(s.id) ?? 0)),
        createdAt: p.createdAt.toISOString(),
        updatedAt: new Date(updated).toISOString(),
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** The pipeline's stages in board order. */
export async function stagesOf(tx: TxClient, pipelineIds: readonly string[]) {
  const rows = await tx.salesPipelineStage.findMany({
    where: { pipelineId: { in: [...pipelineIds] } },
    select: stageSelect,
  });
  const by = new Map<string, StageRow[]>();
  for (const s of rows.sort(stageOrder)) by.set(s.pipelineId, [...(by.get(s.pipelineId) ?? []), s]);
  return by;
}

/** The pipeline's New Lead stage: the shipped `new_lead`, else its first stage. */
export const newLeadOf = (stages: readonly StageRow[]) =>
  (stages.find((s) => s.systemKey === 'new_lead') ?? stages[0])?.id ?? null;

// ---------- Opportunities ----------

export const opportunitySelect = {
  id: true,
  pipelineId: true,
  stageId: true,
  contactId: true,
  title: true,
  companyName: true,
  source: true,
  planId: true,
  valueCents: true,
  assignedToUserId: true,
  lostReason: true,
  lostNote: true,
  lostAt: true,
  convertedAt: true,
  stageEnteredAt: true,
  firmApplicationId: true,
  linkedBusinessId: true,
  transactionKind: true,
  transactionId: true,
  transactionStatus: true,
  transactionSyncedAt: true,
  createdAt: true,
  updatedAt: true,
  contact: { select: { name: true, email: true, phone: true } },
  plan: { select: { id: true, code: true, name: true, basePriceCents: true, billingCycle: true } },
  tags: { select: { tag: { select: { id: true, name: true, colorKey: true } } } },
  linkedBusiness: { select: { id: true, name: true } },
  firmApplication: { select: { id: true, status: true } },
} satisfies Prisma.SalesOpportunitySelect;
export type OpportunityRow = Prisma.SalesOpportunityGetPayload<{
  select: typeof opportunitySelect;
}>;

export const SUBSCRIPTION_KIND = 'platform_subscription';

/** A record with its view and what the filters and KPIs read beside it. */
export interface Built {
  row: OpportunityRow;
  view: SalesOpportunity;
  stage: StageRow;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The board's view of each record, from the record and its activity, history and follow-ups. */
export async function buildViews(
  tx: TxClient,
  ctx: SalesContext,
  rows: readonly OpportunityRow[],
): Promise<Built[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const subscriptionIds = rows.flatMap((r) =>
    r.transactionKind === SUBSCRIPTION_KIND && r.transactionId ? [r.transactionId] : [],
  );
  const [stages, activities, stageMoves, ownerMoves, scheduled, subscriptions] = await Promise.all([
    stagesOf(tx, [...new Set(rows.map((r) => r.pipelineId))]),
    tx.salesActivity.findMany({
      where: { opportunityId: { in: ids } },
      select: { opportunityId: true, direction: true, outcome: true, occurredAt: true },
    }),
    tx.salesStageHistory.groupBy({
      by: ['opportunityId'],
      where: { opportunityId: { in: ids } },
      _max: { createdAt: true },
    }),
    tx.salesAssignmentHistory.groupBy({
      by: ['opportunityId'],
      where: { opportunityId: { in: ids } },
      _max: { createdAt: true },
    }),
    tx.salesFollowUp.findMany({
      where: { opportunityId: { in: ids }, status: 'SCHEDULED' },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { id: true, opportunityId: true, kind: true, title: true, dueAt: true },
    }),
    subscriptionIds.length
      ? tx.platformFirmSubscription.findMany({
          where: { id: { in: subscriptionIds } },
          select: {
            id: true,
            status: true,
            trialStartedAt: true,
            trialEndsAt: true,
            business: { select: { id: true, name: true } },
            plan: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const group = <T extends { opportunityId: string }>(list: readonly T[]) => {
    const by = new Map<string, T[]>();
    for (const item of list)
      by.set(item.opportunityId, [...(by.get(item.opportunityId) ?? []), item]);
    return by;
  };
  const actsOf = group(activities);
  const dueOf = group(scheduled);
  const lastStage = new Map(stageMoves.map((m) => [m.opportunityId, m._max.createdAt]));
  const lastOwner = new Map(ownerMoves.map((m) => [m.opportunityId, m._max.createdAt]));
  const subOf = new Map(subscriptions.map((s) => [s.id, s]));
  const built: Built[] = [];
  for (const row of rows) {
    const list = stages.get(row.pipelineId) ?? [];
    const order = list.findIndex((s) => s.id === row.stageId);
    const stage = list[order];
    if (!stage) continue;
    const stats = contactStats(actsOf.get(row.id) ?? []);
    const last = Math.max(
      row.createdAt.getTime(),
      stats.lastAt?.getTime() ?? 0,
      lastStage.get(row.id)?.getTime() ?? 0,
      lastOwner.get(row.id)?.getTime() ?? 0,
    );
    const due = dueOf.get(row.id) ?? [];
    const next = due[0];
    const appointment = due.find(
      (f) => SALES_APPOINTMENT_KINDS.includes(f.kind) && f.dueAt.getTime() >= ctx.now,
    );
    const sub =
      row.transactionKind === SUBSCRIPTION_KIND && row.transactionId
        ? subOf.get(row.transactionId)
        : undefined;
    const followUp = (f: (typeof due)[number] | undefined) =>
      f ? { id: f.id, kind: f.kind, title: f.title, dueAt: f.dueAt.toISOString() } : null;
    const view: SalesOpportunity = {
      id: row.id,
      pipelineId: row.pipelineId,
      stageId: row.stageId,
      stageName: stage.name,
      stageType: stage.stageType,
      stageTone: salesStageTone({ systemKey: stage.systemKey, type: stage.stageType }),
      stageOrder: order,
      firmName: row.title,
      contactId: row.contactId,
      contactName: row.contact.name,
      email: row.contact.email,
      phone: row.contact.phone,
      valueCents: row.valueCents,
      plan: row.plan
        ? {
            id: row.plan.id,
            code: row.plan.code,
            name: row.plan.name,
            priceCents: row.plan.basePriceCents,
            billingCycle: row.plan.billingCycle,
          }
        : null,
      source: row.source,
      owner: ctx.repOf(row.assignedToUserId),
      tags: row.tags
        .map((t) => t.tag)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.id, name: t.name, colorKey: t.colorKey })),
      createdAt: row.createdAt.toISOString(),
      stageEnteredAt: row.stageEnteredAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastActivityAt: new Date(last).toISOString(),
      attempts: stats.attempts,
      contactedAt: iso(stats.contactedAt),
      nextFollowUp: followUp(next),
      nextAppointment: followUp(appointment),
      convertedAt: iso(row.convertedAt),
      closedAt: stage.stageType === 'CLOSED' ? row.stageEnteredAt.toISOString() : null,
      lostAt: iso(row.lostAt),
      lostReason: row.lostReason,
      lostNote: row.lostNote,
      transaction:
        row.transactionKind === SUBSCRIPTION_KIND && row.transactionId && row.transactionStatus
          ? {
              kind: 'PLATFORM_SUBSCRIPTION',
              id: row.transactionId,
              status: row.transactionStatus,
              syncedAt: iso(row.transactionSyncedAt),
              subscription: sub ? { firm: sub.business, plan: sub.plan, status: sub.status } : null,
            }
          : null,
      trial: sub?.trialStartedAt
        ? {
            startedAt: sub.trialStartedAt.toISOString(),
            endsAt: iso(sub.trialEndsAt),
            active:
              sub.status === 'TRIAL' &&
              sub.trialStartedAt.getTime() <= ctx.now &&
              (sub.trialEndsAt === null || sub.trialEndsAt.getTime() > ctx.now),
          }
        : null,
      firm: row.linkedBusiness,
      firmApplication: row.firmApplication,
      attention: attentionOf(
        {
          stageType: stage.stageType,
          inNewLead: newLeadOf(list) === stage.id,
          ownerId: row.assignedToUserId,
          createdAt: row.createdAt.getTime(),
          lastActivityAt: last,
          outbound: stats.outbound,
          attempts: stats.attempts,
          scheduledDue: due.map((f) => f.dueAt.getTime()),
        },
        ctx.rules,
        ctx.now,
      ),
    };
    built.push({ row, view, stage });
  }
  return built;
}

/** One record's view, or 404. */
export async function viewOf(tx: TxClient, ctx: SalesContext, id: string): Promise<Built> {
  const row = await tx.salesOpportunity.findUnique({ where: { id }, select: opportunitySelect });
  if (!row) throw notFound();
  const [built] = await buildViews(tx, ctx, [row]);
  if (!built) throw notFound();
  return built;
}

export const followUpSelect = {
  id: true,
  opportunityId: true,
  kind: true,
  title: true,
  dueAt: true,
  endsAt: true,
  location: true,
  status: true,
  assignedToUserId: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  opportunity: { select: { title: true, contact: { select: { name: true } } } },
} satisfies Prisma.SalesFollowUpSelect;
export type FollowUpRow = Prisma.SalesFollowUpGetPayload<{ select: typeof followUpSelect }>;

export const followUpView = (ctx: SalesContext, f: FollowUpRow): SalesFollowUp => ({
  id: f.id,
  opportunityId: f.opportunityId,
  firmName: f.opportunity.title,
  contactName: f.opportunity.contact.name,
  kind: f.kind,
  title: f.title,
  dueAt: f.dueAt.toISOString(),
  endsAt: iso(f.endsAt),
  location: f.location,
  status: f.status,
  assignee: f.assignedToUserId
    ? { id: f.assignedToUserId, name: ctx.nameOf(f.assignedToUserId) }
    : null,
  completedAt: iso(f.completedAt),
  cancelledAt: iso(f.cancelledAt),
  createdAt: f.createdAt.toISOString(),
  overdue: f.status === 'SCHEDULED' && f.dueAt.getTime() < ctx.now,
});

/** '' to null, for the optional text columns. */
export const orNull = (value: string | null | undefined) => (value ? value : null);
