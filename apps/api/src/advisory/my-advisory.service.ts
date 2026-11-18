import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AdvisoryArea,
  ApproveMyAdvisoryPlanRequest,
  MyAdvisory,
  MyAdvisoryPlan,
  MyAdvisoryPlanRow,
  MyAdvisoryResource,
  MyAdvisoryResourcePdf,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { Notifier } from '../notifications/notifier.js';
import { REPORT_FILES, type ReportFiles } from '../reports/report-files.js';
import { type PortalCaller, type PortalLogin, portalLogin } from '../storage/document-records.js';
import { visible } from '../storage/my-documents.service.js';
import { day, memberNames, notFound } from '../workspaces/common.js';
import { advErrors, DISCLAIMER, todayIn } from './advisory.common.js';
import { resourceOf } from './catalog.js';
import { renderResourcePdf } from './resource-pdf.js';

/** What a version keeps (advisory-plans.service.ts `Content`), as the client may read it. */
interface Kept {
  planName?: string;
  targetYear?: number;
  profile?: { businessName?: unknown };
  strategy?: { summary?: unknown; areas?: unknown };
  goals?: { title: string; area: string | null; targetDate: string | null; status: string }[];
  recommendations?: {
    title: string;
    rationale: string | null;
    impactLabel: string | null;
    status: string;
    clientVisible?: boolean;
  }[];
  workstreams?: { serviceName: string; status: string }[];
  disclaimer?: string;
}

/** A plan in staff hands (a revision being prepared), as the client's view words it. */
const PREPARING: readonly string[] = ['DRAFT', 'IN_REVIEW'];
const OPEN_ACTION: readonly string[] = ['NOT_STARTED', 'IN_PROGRESS'];
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

const advisorySelect = {
  id: true,
  advisorUserId: true,
  engagementId: true,
  client: {
    select: { displayName: true, accountType: true, profile: { select: { businessName: true } } },
  },
  workstreams: {
    select: { serviceId: true, status: true, service: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.AdvisoryClientSelect;
type Advisory = Prisma.AdvisoryClientGetPayload<{ select: typeof advisorySelect }>;

/**
 * BA-CP (Client Portal Review One; the lead's decision 4, option A): the signed-in client's
 * Business Advisory under My Services. Only what the firm marked for the client: delivered plans
 * at the version delivered, recommendations shown, tasks not hidden (never cancelled ones),
 * resources sent and advisory files shared. Never figures, the health score, the assessment,
 * notes or anything hidden. The client is the session's login (household logins only), never the
 * URL; a plan of another client or firm, never delivered, or archived, is 404. Each view is
 * audited (`by: 'CLIENT'`). B10: the client approves the plan the firm sent for their approval.
 */
@Injectable()
export class MyAdvisoryService {
  private readonly logger = new Logger(MyAdvisoryService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
    @Inject(REPORT_FILES) private readonly files: ReportFiles,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The login's advisory record: a household login's client, in the program; else null. */
  private async mine(
    tx: TxClient,
    caller: PortalCaller,
  ): Promise<{ login: PortalLogin; advisory: Advisory } | null> {
    const login = await portalLogin(tx, caller);
    if (!login.clientId || !login.household) return null;
    const advisory = await tx.advisoryClient.findFirst({
      where: { businessId: caller.businessId, clientId: login.clientId, archivedAt: null },
      select: advisorySelect,
    });
    return advisory ? { login, advisory } : null;
  }

  /** The newest delivered version of each of the client's live plans, newest first. */
  private async delivered(tx: TxClient, businessId: string, advisoryClientId: string) {
    const versions = await tx.advisoryPlanVersion.findMany({
      where: {
        businessId,
        deliveredAt: { not: null },
        plan: { advisoryClientId, archivedAt: null },
      },
      orderBy: [{ versionNo: 'desc' }],
      select: {
        planId: true,
        versionNo: true,
        deliveredAt: true,
        content: true,
        plan: {
          select: { status: true, clientApprovedAt: true, clientApprovedVersion: true },
        },
      },
    });
    const seen = new Set<string>();
    return versions
      .filter((v) => !seen.has(v.planId) && seen.add(v.planId))
      .sort((a, b) => b.deliveredAt!.getTime() - a.deliveredAt!.getTime());
  }

  private planRow(v: Awaited<ReturnType<MyAdvisoryService['delivered']>>[number]) {
    const kept = v.content as Kept;
    const { status, clientApprovedAt, clientApprovedVersion } = v.plan;
    return {
      id: v.planId,
      name: kept.planName ?? 'Business plan',
      targetYear: kept.targetYear ?? 0,
      version: v.versionNo,
      deliveredAt: v.deliveredAt!.toISOString(),
      // B10: waiting for the client's approval, or approved (until a revision clears it).
      state:
        status === 'AWAITING_CLIENT_APPROVAL'
          ? 'AWAITING_APPROVAL'
          : clientApprovedVersion
            ? 'APPROVED'
            : PREPARING.includes(status)
              ? 'IN_PREPARATION'
              : 'DELIVERED',
      approval:
        clientApprovedAt && clientApprovedVersion
          ? { version: clientApprovedVersion, approvedAt: clientApprovedAt.toISOString() }
          : null,
    } satisfies MyAdvisoryPlanRow;
  }

  async get(caller: PortalCaller): Promise<MyAdvisory> {
    const { view, advisoryClientId } = await this.inFirm(caller.businessId, async (tx) => {
      const empty: MyAdvisory = {
        enrolled: false,
        businessName: null,
        advisor: null,
        services: [],
        plans: [],
        recommendations: [],
        tasks: [],
        resources: [],
        files: [],
        disclaimer: DISCLAIMER,
      };
      const found = await this.mine(tx, caller);
      if (!found) return { view: empty, advisoryClientId: null };
      const { login, advisory: a } = found;
      const { businessId } = caller;
      const serviceIds = a.workstreams.map((w) => w.serviceId);
      const files = visible(login, 'FIRM');
      const [plans, recs, tasks, sent, docs, names, today] = await Promise.all([
        this.delivered(tx, businessId, a.id),
        tx.advisoryRecommendation.findMany({
          where: { businessId, advisoryClientId: a.id, clientVisible: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
        }),
        tx.advisoryActionItem.findMany({
          where: {
            businessId,
            advisoryClientId: a.id,
            clientVisible: true,
            status: { not: 'CANCELLED' },
          },
          orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          take: 100,
        }),
        this.sentResources(tx, businessId, a.id),
        files && (serviceIds.length || a.engagementId)
          ? tx.document.findMany({
              where: {
                AND: [
                  files,
                  {
                    OR: [
                      { engagement: { serviceId: { in: serviceIds } } },
                      ...(a.engagementId ? [{ engagementId: a.engagementId }] : []),
                    ],
                  },
                ],
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 50,
              select: { id: true, fileName: true, createdAt: true },
            })
          : Promise.resolve([]),
        memberNames(tx, businessId, [a.advisorUserId]),
        firmTimeZone(tx, businessId).then((zone) => todayIn(zone)),
      ]);
      const view: MyAdvisory = {
        enrolled: true,
        businessName:
          a.client.profile?.businessName ??
          (a.client.accountType === 'BUSINESS' ? a.client.displayName : null),
        advisor: a.advisorUserId ? (names.get(a.advisorUserId) ?? null) : null,
        services: a.workstreams
          .filter((w) => w.status !== 'DECLINED')
          .map((w) => ({ name: w.service.name, status: w.status })),
        plans: plans.map((v) => this.planRow(v)),
        recommendations: recs.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          rationale: r.rationale,
          impactLabel: r.impactLabel,
          impactCents: r.impactCents,
          status: r.status,
        })),
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          details: t.details,
          dueOn: day(t.dueOn),
          status: t.status,
          overdue: t.dueOn !== null && OPEN_ACTION.includes(t.status) && day(t.dueOn)! < today,
          forYou: t.assigneeKind === 'CLIENT',
        })),
        resources: sent,
        files: docs.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          sharedAt: d.createdAt.toISOString(),
        })),
        disclaimer: DISCLAIMER,
      };
      return { view, advisoryClientId: a.id };
    });
    if (advisoryClientId) {
      await this.audit.log(
        'advisory_client.viewed',
        { type: 'advisory_client', id: advisoryClientId },
        { advisoryClientId, by: 'CLIENT' },
      );
    }
    return view;
  }

  /**
   * The resources the firm sent this client (each `advisory_resource.sent` row), newest first and
   * once per resource; only client-facing ones of the library.
   */
  private async sentResources(
    tx: TxClient,
    businessId: string,
    advisoryClientId: string,
  ): Promise<MyAdvisoryResource[]> {
    const rows = await tx.auditLog.findMany({
      where: {
        businessId,
        action: 'advisory_resource.sent',
        metadata: { path: ['advisoryClientId'], equals: advisoryClientId },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: { metadata: true, createdAt: true },
    });
    const out: MyAdvisoryResource[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const key = typeof meta['resourceKey'] === 'string' ? meta['resourceKey'] : '';
      const r = resourceOf(key);
      if (!r?.clientFacing || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        title: r.title,
        category: r.category,
        kind: r.kind,
        summary: r.summary,
        // B28: sent before the choice existed: a link.
        format: meta['format'] === 'PDF' ? 'PDF' : 'SECURE_LINK',
        sentAt: row.createdAt.toISOString(),
      });
    }
    return out;
  }

  async plan(caller: PortalCaller, id: string, audited = true): Promise<MyAdvisoryPlan> {
    const out = await this.inFirm(caller.businessId, async (tx) => {
      const found = await this.mine(tx, caller);
      if (!found) throw notFound();
      const version = (await this.delivered(tx, caller.businessId, found.advisory.id)).find(
        (v) => v.planId === id,
      );
      if (!version) throw notFound();
      return { advisoryClientId: found.advisory.id, version };
    });
    const { version } = out;
    const kept = version.content as Kept;
    const areas = Array.isArray(kept.strategy?.areas)
      ? (kept.strategy.areas as { area?: unknown; objective?: unknown }[])
      : [];
    const view: MyAdvisoryPlan = {
      ...this.planRow(version),
      businessName: text(kept.profile?.businessName),
      summary: text(kept.strategy?.summary),
      // An area's own notes are the firm's: only the area and its objective.
      focusAreas: areas.flatMap((a) =>
        typeof a.area === 'string' && typeof a.objective === 'string'
          ? [{ area: a.area as AdvisoryArea, objective: a.objective }]
          : [],
      ),
      goals: (kept.goals ?? []).map((g) => ({
        title: g.title,
        area: g.area,
        targetDate: g.targetDate,
        status: g.status as MyAdvisoryPlan['goals'][number]['status'],
      })),
      // Only the recommendations the version kept as shown to the client.
      recommendations: (kept.recommendations ?? [])
        .filter((r) => r.clientVisible === true)
        .map((r) => ({
          title: r.title,
          rationale: r.rationale,
          impactLabel: r.impactLabel,
          status: r.status as MyAdvisoryPlan['recommendations'][number]['status'],
        })),
      services: (kept.workstreams ?? [])
        .filter((w) => w.status !== 'DECLINED')
        .map((w) => ({
          name: w.serviceName,
          status: w.status as MyAdvisoryPlan['services'][number]['status'],
        })),
      disclaimer: kept.disclaimer ?? DISCLAIMER,
      // B10: while the plan waits, the version delivered is the one sent for approval (the firm
      // can neither finalize nor send another until the client answers or it is withdrawn).
      can: { approve: version.plan.status === 'AWAITING_CLIENT_APPROVAL' },
    };
    if (audited) {
      await this.audit.log(
        'advisory_plan.viewed',
        { type: 'advisory_plan', id },
        { advisoryClientId: out.advisoryClientId, version: version.versionNo, by: 'CLIENT' },
      );
    }
    return view;
  }

  /**
   * B10: the client approves exactly the version the firm sent for their approval. The plan is
   * then finalized at that version (the approval comes before finalization), with who, when and
   * which version; audited, and the plan's advisor and sender get a bell item. A plan not waiting
   * for approval, or another version, is 409 INVALID_STATUS; a plan the client can't see is 404.
   */
  async approve(
    caller: PortalCaller,
    id: string,
    body: ApproveMyAdvisoryPlanRequest,
  ): Promise<MyAdvisoryPlan> {
    const { businessId } = caller;
    const told = await this.inFirm(businessId, async (tx) => {
      const found = await this.mine(tx, caller);
      if (!found) throw notFound();
      await tx.$queryRaw`
        SELECT 1 FROM advisory_plans
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
          AND advisory_client_id = ${found.advisory.id}::uuid
        FOR UPDATE`;
      const shown = (await this.delivered(tx, businessId, found.advisory.id)).some(
        (v) => v.planId === id,
      );
      const plan = shown
        ? await tx.advisoryPlan.findFirst({
            where: { businessId, id, advisoryClientId: found.advisory.id, archivedAt: null },
            select: { status: true, sentByUserId: true },
          })
        : null;
      if (!plan) throw notFound();
      if (plan.status !== 'AWAITING_CLIENT_APPROVAL')
        throw advErrors.invalidStatus('This plan is not waiting for your approval');
      const newest = await tx.advisoryPlanVersion.findFirstOrThrow({
        where: { businessId, planId: id },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      if (newest.versionNo !== body.version)
        throw advErrors.invalidStatus(
          `Version ${body.version} is not the one awaiting your approval: reload the plan`,
        );
      const now = new Date();
      await tx.advisoryPlan.update({
        where: { businessId_id: { businessId, id } },
        data: {
          status: 'FINALIZED',
          finalizedAt: now,
          currentVersion: newest.versionNo,
          clientApprovedAt: now,
          clientApprovedByUserId: caller.userId,
          clientApprovedVersion: newest.versionNo,
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_plan.client_approved',
        { type: 'advisory_plan', id },
        {
          advisoryClientId: found.advisory.id,
          version: newest.versionNo,
          from: 'AWAITING_CLIENT_APPROVAL',
          to: 'FINALIZED',
          by: 'CLIENT',
        },
      );
      return [found.advisory.advisorUserId, plan.sentByUserId].filter(
        (u): u is string => u !== null,
      );
    });
    await this.tellFirm(businessId, id, body.version, [...new Set(told)]);
    return this.plan(caller, id, false);
  }

  /**
   * B28: a 5-minute link to the PDF of a resource the firm sent this client as a PDF (its newest
   * send says the format), made under the firm's own prefix; any other resource is 404. Audited.
   */
  async resourcePdf(caller: PortalCaller, key: string): Promise<MyAdvisoryResourcePdf> {
    const { businessId } = caller;
    const found = await this.inFirm(businessId, async (tx) => {
      const mine = await this.mine(tx, caller);
      if (!mine) throw notFound();
      const sent = (await this.sentResources(tx, businessId, mine.advisory.id)).find(
        (r) => r.key === key,
      );
      if (sent?.format !== 'PDF') throw notFound();
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true },
      });
      const sentOn = todayIn(await firmTimeZone(tx, businessId), new Date(sent.sentAt));
      return { advisoryClientId: mine.advisory.id, sent, firm: firm.name, sentOn };
    });
    const bytes = await renderResourcePdf({
      firmName: found.firm,
      title: found.sent.title,
      category: found.sent.category,
      summary: found.sent.summary,
      sentOn: found.sentOn,
      disclaimer: DISCLAIMER,
    });
    const file = `tenant/${businessId}/reports/advisory-resource-${randomUUID()}.pdf`;
    let url: string;
    try {
      await this.files.put(file, bytes, 'application/pdf');
      url = await this.files.presignDownload({
        key: file,
        fileName: `${key}.pdf`,
        contentType: 'application/pdf',
      });
    } catch {
      throw new HttpException(
        {
          code: 'FILE_STORE_UNAVAILABLE',
          message: 'The file could not be saved. Try again shortly.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.audit.log(
      'advisory_resource.downloaded',
      { type: 'advisory_client', id: found.advisoryClientId },
      { advisoryClientId: found.advisoryClientId, resourceKey: key, format: 'PDF', by: 'CLIENT' },
    );
    return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }

  /** The plan's advisor and sender get a bell item; a failure is logged, never the client's error. */
  private async tellFirm(
    businessId: string,
    id: string,
    version: number,
    toUserIds: string[],
  ): Promise<void> {
    if (toUserIds.length === 0) return;
    try {
      await this.notifier.notify({
        businessId,
        event: 'advisory-plan.client-approved',
        recordId: id,
        toUserIds,
        eventKey: `advisory-plan.client-approved:${id}:${version}`,
      });
    } catch (error) {
      this.logger.warn(
        `advisory-plan.client-approved for plan ${id} failed (${error instanceof Error ? error.name : 'Error'})`,
      );
    }
  }
}
