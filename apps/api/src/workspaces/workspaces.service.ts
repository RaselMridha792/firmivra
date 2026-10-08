import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, ServiceKind, TxClient } from '@firmivra/db';
import type { Workspace, WorkspaceKind, WorkspaceList, WorkspaceListItem } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type ClientsActor, likeEscape } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { assignee, day, notFound, sentFields } from './common.js';
import type { WorkspacesQuery } from './input.js';
import { decodeTimeCursor, encodeTimeCursor } from './paging.js';

type ListQuery = z.output<typeof WorkspacesQuery>;

/** The services that have a workspace: Bookkeeping and Tax Planning (WorkspaceKind). */
export const WORKSPACE_SERVICE_KINDS = [
  'BOOKKEEPING',
  'TAX_PLANNING',
] as const satisfies readonly (ServiceKind & WorkspaceKind)[];

/** The workspace kind of a service, or null when the service has no workspace. */
export function workspaceKindOf(kind: ServiceKind): WorkspaceKind | null {
  return (WORKSPACE_SERVICE_KINDS as readonly string[]).includes(kind)
    ? (kind as WorkspaceKind)
    : null;
}

/**
 * The engagements whose workspace the actor sees: this firm's Bookkeeping and Tax Planning
 * engagements; for Staff only those of clients assigned to them (R10's rule for client records).
 */
export function visibleWorkspaces(
  businessId: string,
  actor: ClientsActor,
): Prisma.EngagementWhereInput {
  return {
    AND: [
      { businessId, service: { kind: { in: [...WORKSPACE_SERVICE_KINDS] } } },
      actor.role === 'STAFF' ? { client: { assignedUserId: actor.userId } } : {},
    ],
  };
}

/** A workspace the actor sees, as the reports service needs it. */
export interface WorkspaceRef {
  id: string;
  clientId: string;
  kind: WorkspaceKind;
  status: string;
}

/** The workspace of `engagementId` if the actor sees it; else 404. */
export async function findWorkspace(
  tx: TxClient,
  businessId: string,
  actor: ClientsActor,
  engagementId: string,
): Promise<WorkspaceRef> {
  const row = await tx.engagement.findFirst({
    where: { AND: [{ id: engagementId }, visibleWorkspaces(businessId, actor)] },
    select: { id: true, clientId: true, status: true, service: { select: { kind: true } } },
  });
  const kind = row ? workspaceKindOf(row.service.kind) : null;
  if (!row || !kind) throw notFound();
  return { id: row.id, clientId: row.clientId, kind, status: row.status };
}

const select = {
  id: true,
  title: true,
  status: true,
  stage: true,
  taxYear: true,
  periodStart: true,
  periodEnd: true,
  updatedAt: true,
  client: { select: { id: true, displayName: true } },
  service: { select: { name: true, kind: true, stages: true } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.EngagementSelect;
type Row = Prisma.EngagementGetPayload<{ select: typeof select }>;
type TaskStats = Map<string, { open: number; nextDueOn: string | null }>;

/** Rows of workspace engagements only (the queries filter on the service kind). */
function kindOf(row: Row): WorkspaceKind {
  const kind = workspaceKindOf(row.service.kind);
  if (!kind) throw notFound();
  return kind;
}

function toItem(row: Row, stats: TaskStats): WorkspaceListItem {
  const tasks = stats.get(row.id);
  return {
    engagementId: row.id,
    kind: kindOf(row),
    title: row.title,
    client: { id: row.client.id, displayName: row.client.displayName },
    serviceName: row.service.name,
    status: row.status,
    stage: row.stage,
    assignedTo: assignee(row.assignedMember),
    taxYear: row.taxYear,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    openTasks: tasks?.open ?? 0,
    nextDueOn: tasks?.nextDueOn ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Open tasks per engagement and the soonest due date among them. */
async function openTaskStats(
  tx: TxClient,
  businessId: string,
  engagementIds: string[],
): Promise<TaskStats> {
  if (engagementIds.length === 0) return new Map();
  const groups = await tx.task.groupBy({
    by: ['engagementId'],
    where: { businessId, status: 'OPEN', engagementId: { in: engagementIds } },
    _count: { _all: true },
    _min: { dueOn: true },
  });
  return new Map(
    groups.flatMap((g) =>
      g.engagementId
        ? [[g.engagementId, { open: g._count._all, nextDueOn: day(g._min.dueOn) }] as const]
        : [],
    ),
  );
}

const LIST_FILTERS = ['kind', 'status', 'assignedUserId', 'search'] as const;

/**
 * Service workspaces (R12 step 6; contract in packages/types/src/workspaces): the firm's
 * Bookkeeping and Tax Planning engagements with their open tasks. Owner and Admin see every
 * workspace, Staff those of clients assigned to them (others are 404). Status and stage change
 * through R10's engagements API; tasks, reports, notes and documents come from their own lists.
 * Audited with ids, counts and filter names only.
 */
@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** By kind, status (ACTIVE by default), assignee and title or client; newest activity first. */
  async list(businessId: string, actor: ClientsActor, q: ListQuery): Promise<WorkspaceList> {
    const after = q.cursor ? decodeTimeCursor(q.cursor) : undefined;
    const term = q.search ? likeEscape(q.search) : undefined;
    const where: Prisma.EngagementWhereInput = {
      AND: [
        visibleWorkspaces(businessId, actor),
        { status: q.status },
        q.kind ? { service: { kind: q.kind } } : {},
        q.assignedUserId ? { assignedUserId: q.assignedUserId } : {},
        term
          ? {
              OR: [
                { title: { contains: term, mode: 'insensitive' } },
                { client: { displayName: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {},
        after
          ? {
              OR: [{ updatedAt: { lt: after.at } }, { updatedAt: after.at, id: { lt: after.id } }],
            }
          : {},
      ],
    };
    const { rows, stats } = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.engagement.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select,
      });
      const ids = rows.slice(0, q.limit).map((r) => r.id);
      return { rows, stats: await openTaskStats(tx, businessId, ids) };
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log(
      'workspaces.listed',
      { type: 'engagement' },
      { count: page.length, filters: sentFields(q, LIST_FILTERS) },
    );
    return {
      items: page.map((row) => toItem(row, stats)),
      nextCursor:
        rows.length > q.limit && last
          ? encodeTimeCursor({ at: last.updatedAt, id: last.id })
          : null,
    };
  }

  /** The list item and the service's stages (for the stage picker). */
  async get(businessId: string, actor: ClientsActor, engagementId: string): Promise<Workspace> {
    const workspace = await this.inFirm(businessId, async (tx) => {
      const row = await tx.engagement.findFirst({
        where: { AND: [{ id: engagementId }, visibleWorkspaces(businessId, actor)] },
        select,
      });
      if (!row) throw notFound();
      const stats = await openTaskStats(tx, businessId, [row.id]);
      return { ...toItem(row, stats), stages: row.service.stages };
    });
    await this.audit.log(
      'workspace.viewed',
      { type: 'engagement', id: workspace.engagementId },
      { clientId: workspace.client.id, kind: workspace.kind },
    );
    return workspace;
  }
}
