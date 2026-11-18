import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type ApproveMyTaxPlanRequest,
  type CreateMyTaxPlanRequest,
  type MyTaxPlan,
  type MyTaxPlanRow,
  type MyTaxPlanState,
  TAX_PLANNING_DISCLAIMER,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { Notifier } from '../notifications/notifier.js';
import { notFound } from '../workspaces/common.js';
import { todayIn, tpErrors } from './tax-planning.common.js';

/** The versions the client was given: sent for their review, or delivered. */
const GIVEN = ['SENT', 'DELIVERED'] as const;
/** A client's request moves a plan waiting on them to Needs Review (as one staff record). */
const CLIENT_REQUEST_MOVES: readonly string[] = ['AWAITING_CLIENT', 'CLIENT_APPROVED'];

interface Snapshot {
  planName?: string;
  strategies?: {
    name: string;
    category?: string | null;
    estimate?: { cents?: number | null } | null;
  }[];
  projectedSavingsCents?: number | null;
}

interface PlanRow {
  id: string;
  name: string;
  planYear: number;
  status: string;
  archivedAt: Date | null;
  assignedUserId: string | null;
}

/**
 * P4-8 (Tax Planning Review 2, approved workflow): the signed-in client's tax plans in the portal.
 * Only the client's own plans, only once sent, each read at the exact version given. The client
 * approves the version awaiting review, or asks (a question, a revision, a meeting). Never the
 * firm's screening, the figures' notes or internal notes. Each change is audited and tells the
 * plan's assigned staff.
 */
@Injectable()
export class MyTaxPlansService {
  private readonly logger = new Logger(MyTaxPlansService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The login's client, or null (an account with no client sees no plan). */
  private async clientOf(tx: TxClient, businessId: string, clientAccountId: string) {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true },
    });
    return account?.clientId ?? null;
  }

  /** The client's own plan, given to them at least once; anything else is 404. */
  private async plan(
    tx: TxClient,
    businessId: string,
    clientId: string | null,
    id: string,
    lock = false,
  ): Promise<{ plan: PlanRow; given: { version: number; event: string; createdAt: Date } }> {
    if (!clientId) throw notFound();
    if (lock) {
      await tx.$queryRaw`
        SELECT 1 FROM tax_plans
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid AND client_id = ${clientId}::uuid
        FOR UPDATE`;
    }
    const plan = await tx.taxPlan.findFirst({
      where: { businessId, id, clientId },
      select: {
        id: true,
        name: true,
        planYear: true,
        status: true,
        archivedAt: true,
        assignedUserId: true,
      },
    });
    const given = plan
      ? await tx.taxPlanVersion.findFirst({
          where: { businessId, planId: id, event: { in: [...GIVEN] } },
          orderBy: { version: 'desc' },
          select: { version: true, event: true, createdAt: true },
        })
      : null;
    if (!plan || !given) throw notFound();
    return { plan, given };
  }

  /** Where the plan stands for the client, from its status. */
  private stateOf(status: string): MyTaxPlanState {
    if (status === 'CLOSED') return 'CLOSED';
    if (status === 'AWAITING_CLIENT') return 'AWAITING_REVIEW';
    if (status === 'READY_FOR_REVIEW') return 'REQUEST_WITH_FIRM';
    if (status === 'CLIENT_APPROVED' || status === 'IMPLEMENTED') return 'APPROVED';
    return 'IN_PREPARATION';
  }

  async list(businessId: string, clientAccountId: string): Promise<MyTaxPlanRow[]> {
    return this.inFirm(businessId, async (tx) => {
      const clientId = await this.clientOf(tx, businessId, clientAccountId);
      if (!clientId) return [];
      const plans = await tx.taxPlan.findMany({
        where: {
          businessId,
          clientId,
          archivedAt: null,
          taxPlanVersions: { some: { event: { in: [...GIVEN] } } },
        },
        select: { id: true, name: true, planYear: true, status: true },
        orderBy: [{ planYear: 'desc' }, { createdAt: 'desc' }],
      });
      const rows: MyTaxPlanRow[] = [];
      for (const p of plans) {
        const given = await tx.taxPlanVersion.findFirst({
          where: { businessId, planId: p.id, event: { in: [...GIVEN] } },
          orderBy: { version: 'desc' },
          select: { version: true, createdAt: true },
        });
        if (!given) continue;
        rows.push({
          id: p.id,
          name: p.name,
          planYear: p.planYear,
          version: given.version,
          sentAt: given.createdAt.toISOString(),
          state: this.stateOf(p.status),
        });
      }
      return rows;
    });
  }

  get(businessId: string, clientAccountId: string, id: string): Promise<MyTaxPlan> {
    return this.inFirm(businessId, async (tx) => {
      const clientId = await this.clientOf(tx, businessId, clientAccountId);
      const { plan } = await this.plan(tx, businessId, clientId, id);
      if (plan.archivedAt) throw notFound();
      return this.view(tx, businessId, clientId!, id);
    });
  }

  /** The plan as the client reads it: the exact version given, its approval, their requests. */
  private async view(
    tx: TxClient,
    businessId: string,
    clientId: string,
    id: string,
  ): Promise<MyTaxPlan> {
    const { plan, given } = await this.plan(tx, businessId, clientId, id);
    const [kept, approval, requests, sentForReview] = await Promise.all([
      tx.taxPlanVersion.findFirst({
        where: { businessId, planId: id, version: given.version },
        select: { snapshot: true },
      }),
      tx.taxPlanApproval.findFirst({
        where: { businessId, planId: id },
        orderBy: { version: 'desc' },
        select: { version: true, approvedOn: true, method: true },
      }),
      tx.taxPlanRequest.findMany({
        where: { businessId, planId: id, clientId, direction: 'CLIENT_TO_FIRM' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, body: true, status: true, createdAt: true },
      }),
      this.awaitingReview(tx, businessId, id),
    ]);
    const snapshot = (kept?.snapshot ?? {}) as Snapshot;
    const open = !plan.archivedAt && plan.status !== 'CLOSED';
    return {
      id: plan.id,
      name: snapshot.planName ?? plan.name,
      planYear: plan.planYear,
      version: given.version,
      sentAt: given.createdAt.toISOString(),
      state: this.stateOf(plan.status),
      // As the plan's own message says it: each strategy and its estimate, never the figures'
      // sources or notes, the overrides' reasons or the firm's screening.
      strategies: (snapshot.strategies ?? []).map((s) => ({
        name: s.name,
        category: s.category ?? null,
        estimatedSavingsCents: s.estimate?.cents ?? null,
      })),
      projectedSavingsCents: snapshot.projectedSavingsCents ?? null,
      disclaimer: TAX_PLANNING_DISCLAIMER,
      approval: approval
        ? {
            version: approval.version,
            approvedOn: approval.approvedOn.toISOString().slice(0, 10),
            method: approval.method,
          }
        : null,
      requests: requests.map((r) => ({
        id: r.id,
        kind: r.kind as MyTaxPlan['requests'][number]['kind'],
        body: r.body,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      can: {
        approve:
          open &&
          sentForReview !== null &&
          sentForReview === given.version &&
          approval?.version !== given.version,
        request: open,
      },
    };
  }

  /**
   * The version awaiting the client's approval: the newest sent for review, while the plan is
   * Awaiting Client Review or Needs Review (as Record Client Approval allows), else null.
   */
  private async awaitingReview(tx: TxClient, businessId: string, id: string) {
    const plan = await tx.taxPlan.findFirst({
      where: { businessId, id },
      select: { status: true },
    });
    if (plan?.status !== 'AWAITING_CLIENT' && plan?.status !== 'READY_FOR_REVIEW') return null;
    const sent = await tx.taxPlanVersion.findFirst({
      where: { businessId, planId: id, event: 'SENT' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return sent?.version ?? null;
  }

  /**
   * Ask a Question, Request a Revision or Request a Meeting: the client's own request on the plan.
   * A plan waiting on the client moves to Needs Review; the plan's history records it; audited
   * with ids only; the assigned staff get a bell item.
   */
  async ask(
    businessId: string,
    clientAccountId: string,
    id: string,
    body: CreateMyTaxPlanRequest,
  ): Promise<MyTaxPlan> {
    const { plan, requestId } = await this.inFirm(businessId, async (tx) => {
      const clientId = await this.clientOf(tx, businessId, clientAccountId);
      const { plan } = await this.plan(tx, businessId, clientId, id, true);
      if (plan.archivedAt) throw notFound();
      if (plan.status === 'CLOSED')
        throw tpErrors.invalidStatus('This plan is closed: send the firm a message instead');
      const row = await tx.taxPlanRequest.create({
        data: {
          businessId,
          clientId: clientId!,
          planId: id,
          direction: 'CLIENT_TO_FIRM',
          kind: body.kind,
          body: body.body.trim(),
        },
        select: { id: true },
      });
      const moves = CLIENT_REQUEST_MOVES.includes(plan.status);
      if (moves) {
        await tx.taxPlan.update({
          where: { businessId_id: { businessId, id } },
          data: { status: 'READY_FOR_REVIEW' },
        });
      }
      await tx.taxPlanEvent.create({
        data: {
          businessId,
          planId: id,
          kind: 'CLIENT_REQUEST',
          fromStatus: moves ? (plan.status as 'AWAITING_CLIENT') : null,
          toStatus: moves ? 'READY_FOR_REVIEW' : null,
          version: null,
          reason: null,
          actorUserId: null,
        },
      });
      await this.audit.logIn(
        tx,
        'tax_plan.client_request',
        { type: 'tax_plan', id },
        { clientId, requestId: row.id, kind: body.kind, by: 'CLIENT' },
      );
      return { plan, requestId: row.id };
    });
    await this.tellStaff('tax-plan.client-request', businessId, plan, `request:${requestId}`);
    return this.get(businessId, clientAccountId, id);
  }

  /**
   * Approve: the client's own approval of exactly the version awaiting their review, dated today
   * in the firm's time zone (method PORTAL). The plan is Client Approved; history, audit and the
   * assigned staff's bell item record it. Any other version, or one already approved, is 409.
   */
  async approve(
    businessId: string,
    clientAccountId: string,
    id: string,
    body: ApproveMyTaxPlanRequest,
  ): Promise<MyTaxPlan> {
    const plan = await this.inFirm(businessId, async (tx) => {
      const clientId = await this.clientOf(tx, businessId, clientAccountId);
      const { plan } = await this.plan(tx, businessId, clientId, id, true);
      if (plan.archivedAt) throw notFound();
      const awaiting = await this.awaitingReview(tx, businessId, id);
      if (awaiting === null)
        throw tpErrors.invalidStatus('This plan is not waiting for your approval');
      if (awaiting !== body.version)
        throw tpErrors.invalidStatus(
          `Version ${body.version} is not the one awaiting your approval: reload the plan`,
        );
      const already = await tx.taxPlanApproval.findFirst({
        where: { businessId, planId: id, version: awaiting },
        select: { id: true },
      });
      if (already) throw tpErrors.invalidStatus(`Version ${awaiting} is already approved`);
      const today = todayIn(await firmTimeZone(tx, businessId));
      await tx.taxPlanApproval.create({
        data: {
          businessId,
          clientId: clientId!,
          planId: id,
          version: awaiting,
          method: 'PORTAL',
          approvedOn: new Date(`${today}T00:00:00.000Z`),
        },
      });
      await tx.taxPlan.update({
        where: { businessId_id: { businessId, id } },
        data: { status: 'CLIENT_APPROVED' },
      });
      await tx.taxPlanEvent.create({
        data: {
          businessId,
          planId: id,
          kind: 'APPROVED',
          fromStatus: plan.status as 'AWAITING_CLIENT',
          toStatus: 'CLIENT_APPROVED',
          version: awaiting,
          reason: null,
          actorUserId: null,
        },
      });
      await this.audit.logIn(
        tx,
        'tax_plan.approval_recorded',
        { type: 'tax_plan', id },
        { clientId, version: awaiting, method: 'PORTAL', by: 'CLIENT' },
      );
      return plan;
    });
    await this.tellStaff('tax-plan.client-approved', businessId, plan, `approved:${body.version}`);
    return this.get(businessId, clientAccountId, id);
  }

  /** The plan's assigned staff get a bell item; a failure is logged, never the client's error. */
  private async tellStaff(
    event: 'tax-plan.client-request' | 'tax-plan.client-approved',
    businessId: string,
    plan: PlanRow,
    key: string,
  ): Promise<void> {
    if (!plan.assignedUserId) return;
    try {
      await this.notifier.notify({
        businessId,
        event,
        recordId: plan.id,
        toUserIds: [plan.assignedUserId],
        eventKey: `${event}:${plan.id}:${key}`,
      });
    } catch (error) {
      this.logger.warn(
        `${event} for plan ${plan.id} failed (${error instanceof Error ? error.name : 'Error'})`,
      );
    }
  }
}
