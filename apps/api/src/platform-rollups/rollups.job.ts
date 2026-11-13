import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';

// The platform's daily rollups (Rasel's yes of Nov 10 through the lead): the Super Admin's per-firm
// report rows (platform_firm_metrics_daily, platform_feature_usage_daily) and the integration
// usage rows (platform_integration_usage_daily: SA-INT-R3's connected firms by plan, and the
// platform integrations' requests). No SECURITY DEFINER function and no schema: the job lists the
// firms in platform scope and reads each one in its own scope (forBusiness, the normal RLS), one
// short transaction per firm, then writes only the platform's rows. The integration rows hold sums
// with no firm id or name; the report rows are one firm's own counts, keyed by its id (the Firm
// Report Detail's rows). Idempotent: each run rewrites yesterday and today (UTC).

/** The job's advisory lock key: fixed, in R55's range (0x5537). */
export const ROLLUP_LOCK_KEY = 0x5537_0003;
/** How often it runs; each run rewrites yesterday and today. */
export const ROLLUP_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
/** A firm counts as actively using an integration with a good sync in the last 30 days. */
const ACTIVE_DAYS = 30;

/**
 * PLATFORM_ROLLUPS=on|off: run the job in this API task. Default on, off under NODE_ENV=test (tests
 * call `run()` themselves). Any other value is refused at boot.
 */
export function rollupsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PLATFORM_ROLLUPS;
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('PLATFORM_ROLLUPS must be "on" or "off"');
}

/**
 * Feature keys (ADMIN_REPORT_FEATURES) and the audit actions that count as a use. documents.generate
 * counts uploads and agreements: no "generated" action exists (the lead's Review 2 default).
 */
export const FEATURE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  'documents.generate': ['document.uploaded', 'agreement.created'],
  'esign.send': ['esign.request_sent'],
  'crm.lead_created': ['lead.created'],
  'templates.used': ['communication.template_used'],
  'billing.invoice_sent': ['invoice.sent', 'invoice.resent'],
  'communications.sent': ['communication.sent', 'message.sent', 'lead.message_sent'],
};
const FEATURE_OF = new Map(
  Object.entries(FEATURE_ACTIONS).flatMap(([feature, actions]) =>
    actions.map((a) => [a, feature] as const),
  ),
);

type Day = { day: Date; start: Date; end: Date };
const dayOf = (at: Date): Day => {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return { day: start, start, end: new Date(start.getTime() + DAY_MS) };
};
const within = (at: Date | null | undefined, d: Day) =>
  !!at && at.getTime() >= d.start.getTime() && at.getTime() < d.end.getTime();

/** One firm's integration facts for one day and provider (summed across firms afterwards). */
interface ProviderDay {
  connected: boolean;
  active: boolean;
  connects: number;
  disconnects: number;
  requests: number;
  successes: number;
  failures: number;
  latencyMs: number[];
}

/** One firm's counts for one day (platform_firm_metrics_daily's columns). */
type FirmMetrics = Omit<
  Prisma.PlatformFirmMetricsDailyUncheckedCreateInput,
  'day' | 'businessId' | 'computedAt'
>;

interface FirmFacts {
  metrics: Map<number, FirmMetrics>;
  features: Map<number, Map<string, { events: number; users: Set<string> }>>;
  providers: Map<number, Map<string, ProviderDay>>;
  plan: string | null;
}

export type RollupResult =
  | { skipped: true }
  | { skipped: false; firms: number; firmRows: number; featureRows: number; usageRows: number };

@Injectable()
export class PlatformRollupJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PlatformRollupJob');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (rollupsOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = ROLLUP_INTERVAL_MS): void {
    if (this.timers.length > 0) return;
    this.timers = [
      setTimeout(() => void this.tick(), 2 * 60_000),
      setInterval(() => void this.tick(), intervalMs),
    ];
    for (const timer of this.timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** A timer's run: never rejects. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`tick failed (${error instanceof Error ? error.name : 'Error'})`);
    } finally {
      this.running = false;
    }
  }

  /**
   * One run: yesterday and today. `businessIds` limits the firms (tests). One API task at a time
   * (the advisory lock); a firm that fails is left out of this run and logged, by id only.
   */
  async run(options: { now?: Date; businessIds?: string[] } = {}): Promise<RollupResult> {
    const now = options.now ?? new Date();
    const today = dayOf(now);
    const days = [dayOf(new Date(today.start.getTime() - DAY_MS)), today];
    return this.database.withScope(
      { kind: 'platform' },
      async (tx) => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${ROLLUP_LOCK_KEY}::bigint) AS locked`;
        if (!row?.locked) return { skipped: true } as const;
        const firms = await tx.business.findMany({
          where: options.businessIds ? { id: { in: options.businessIds } } : {},
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        const catalog = (
          await tx.platformIntegrationCatalog.findMany({ select: { provider: true } })
        ).map((c) => c.provider);

        let firmRows = 0;
        let featureRows = 0;
        let read = 0;
        // Per day and provider: the sum over firms, and connected firms by plan.
        const usage = new Map<
          number,
          Map<
            string,
            ProviderDay & { plans: Map<string, number>; firms: number; activeFirms: number }
          >
        >();
        for (const firm of firms) {
          let facts: FirmFacts;
          try {
            facts = await this.firmFacts(firm.id, days);
          } catch (error) {
            this.logger.warn(
              `firm ${firm.id} not rolled up (${error instanceof Error ? error.name : 'Error'})`,
            );
            continue;
          }
          read += 1;
          for (const d of days) {
            const key = d.day.getTime();
            const m = facts.metrics.get(key);
            if (m) {
              await tx.platformFirmMetricsDaily.upsert({
                where: { day_businessId: { day: d.day, businessId: firm.id } },
                create: { day: d.day, businessId: firm.id, ...m },
                update: { ...m, computedAt: new Date() },
              });
              firmRows += 1;
            }
            for (const [feature, f] of facts.features.get(key) ?? []) {
              await tx.platformFeatureUsageDaily.upsert({
                where: { day_businessId_feature: { day: d.day, businessId: firm.id, feature } },
                create: {
                  day: d.day,
                  businessId: firm.id,
                  feature,
                  events: f.events,
                  activeUsers: f.users.size,
                },
                update: { events: f.events, activeUsers: f.users.size, computedAt: new Date() },
              });
              featureRows += 1;
            }
            const sums = usage.get(key) ?? new Map();
            usage.set(key, sums);
            for (const [provider, p] of facts.providers.get(key) ?? []) {
              const s = sums.get(provider) ?? {
                ...emptyProviderDay(),
                plans: new Map<string, number>(),
                firms: 0,
                activeFirms: 0,
              };
              s.connects += p.connects;
              s.disconnects += p.disconnects;
              s.requests += p.requests;
              s.successes += p.successes;
              s.failures += p.failures;
              s.latencyMs.push(...p.latencyMs);
              if (p.connected) {
                s.firms += 1;
                const plan = facts.plan ?? 'NONE';
                s.plans.set(plan, (s.plans.get(plan) ?? 0) + 1);
              }
              if (p.active) s.activeFirms += 1;
              sums.set(provider, s);
            }
          }
        }

        let usageRows = 0;
        for (const d of days) {
          const sums = usage.get(d.day.getTime()) ?? new Map();
          // Every catalog entry has its day's row, so "No firm has connected this yet" is a 0.
          for (const provider of new Set([...catalog, ...sums.keys()])) {
            const s = sums.get(provider);
            const data = {
              requests: s?.requests ?? 0,
              successes: s?.successes ?? 0,
              failures: s?.failures ?? 0,
              avgLatencyMs: s?.latencyMs.length ? average(s.latencyMs) : null,
              connectedFirms: s?.firms ?? 0,
              activeFirms: s?.activeFirms ?? 0,
              connects: s?.connects ?? 0,
              disconnects: s?.disconnects ?? 0,
              connectedFirmsByPlan: Object.fromEntries(s?.plans ?? []),
            };
            await tx.platformIntegrationUsageDaily.upsert({
              where: {
                day_scope_subjectKey: { day: d.day, scope: 'CATALOG', subjectKey: provider },
              },
              create: { day: d.day, scope: 'CATALOG', subjectKey: provider, ...data },
              update: { ...data, computedAt: new Date() },
            });
            usageRows += 1;
          }
          usageRows += await this.platformIntegrations(tx, d);
        }

        await this.audit.logIn(
          tx,
          'platform.rollups_computed',
          { type: 'platform_rollup' },
          {
            days: days.map((d) => d.day.toISOString().slice(0, 10)),
            firms: read,
            firmRows,
            featureRows,
            usageRows,
          },
          { businessId: null },
        );
        return { skipped: false, firms: read, firmRows, featureRows, usageRows } as const;
      },
      { timeout: 10 * 60_000 },
    );
  }

  /** One firm, in its own scope (forBusiness, its RLS): its counts for each day. */
  private firmFacts(businessId: string, days: Day[]): Promise<FirmFacts> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const first = days[0] as Day;
      const last = days[days.length - 1] as Day;
      const since = new Date(first.start.getTime() - ACTIVE_DAYS * DAY_MS);
      const [members, sessions, audits, connections, runs, subscription] = await Promise.all([
        tx.membership.findMany({
          where: { businessId },
          select: { id: true, userId: true, status: true, createdAt: true, joinedAt: true },
        }),
        tx.staffSession.findMany({
          where: { businessId, lastActiveAt: { gte: first.start, lt: last.end } },
          select: { membershipId: true, lastActiveAt: true },
        }),
        tx.auditLog.findMany({
          where: { businessId, createdAt: { gte: first.start, lt: last.end } },
          select: { action: true, actorUserId: true, createdAt: true },
        }),
        tx.integrationConnection.findMany({
          where: { businessId },
          select: { provider: true, connectedAt: true, disconnectedAt: true },
        }),
        tx.integrationSyncRun.findMany({
          where: { businessId, createdAt: { gte: since, lt: last.end } },
          select: {
            status: true,
            createdAt: true,
            startedAt: true,
            finishedAt: true,
            connection: { select: { provider: true } },
          },
        }),
        tx.platformFirmSubscription.findUnique({
          where: { businessId },
          select: { plan: { select: { code: true } } },
        }),
      ]);
      const staff = new Set(members.map((m) => m.userId));
      const userOf = new Map(members.map((m) => [m.id, m.userId]));
      const facts: FirmFacts = {
        metrics: new Map(),
        features: new Map(),
        providers: new Map(),
        plan: subscription?.plan.code ?? null,
      };
      for (const d of days) {
        const inDay = (at: Date | null | undefined) => within(at, d);
        const before = { lt: d.end };
        const [
          totalClients,
          documentsCreated,
          documentsCompleted,
          activeDocuments,
          leadsCreated,
          esignSent,
          esignCompleted,
        ] = await Promise.all([
          tx.client.count({ where: { businessId, archivedAt: null, createdAt: before } }),
          tx.document.count({ where: { businessId, createdAt: { gte: d.start, lt: d.end } } }),
          tx.documentRequest.count({
            where: { businessId, status: 'ACCEPTED', resolvedAt: { gte: d.start, lt: d.end } },
          }),
          tx.document.count({ where: { businessId, archivedAt: null, createdAt: before } }),
          tx.lead.count({ where: { businessId, createdAt: { gte: d.start, lt: d.end } } }),
          tx.esignRequest.count({ where: { businessId, sentAt: { gte: d.start, lt: d.end } } }),
          tx.esignRequest.count({
            where: { businessId, completedAt: { gte: d.start, lt: d.end } },
          }),
        ]);
        const dayAudits = audits.filter((a) => inDay(a.createdAt));
        const active = new Set<string>();
        for (const s of sessions)
          if (inDay(s.lastActiveAt)) {
            const user = userOf.get(s.membershipId);
            if (user) active.add(user);
          }
        for (const a of dayAudits)
          if (a.actorUserId && staff.has(a.actorUserId)) active.add(a.actorUserId);
        // The firm's latest sign-in before the day's end (SM4's row), whatever day it was.
        const lastLogin = await tx.auditLog.findFirst({
          where: { businessId, action: 'auth.firm_session_started', createdAt: { lt: d.end } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        facts.metrics.set(d.day.getTime(), {
          totalUsers: members.filter(
            (m) => (m.status === 'ACTIVE' || m.status === 'LOCKED') && m.createdAt < d.end,
          ).length,
          activeUsers: active.size,
          newUsers: members.filter((m) => inDay(m.joinedAt)).length,
          logins: dayAudits.filter((a) => a.action === 'auth.firm_session_started').length,
          totalClients,
          documentsCreated,
          documentsCompleted,
          activeDocuments,
          leadsCreated,
          esignSent,
          esignCompleted,
          lastLoginAt: lastLogin?.createdAt ?? null,
        });

        const features = new Map<string, { events: number; users: Set<string> }>();
        for (const a of dayAudits) {
          const feature = FEATURE_OF.get(a.action);
          if (!feature) continue;
          const f = features.get(feature) ?? { events: 0, users: new Set<string>() };
          f.events += 1;
          if (a.actorUserId && staff.has(a.actorUserId)) f.users.add(a.actorUserId);
          features.set(feature, f);
        }
        facts.features.set(d.day.getTime(), features);

        const providers = new Map<string, ProviderDay>();
        const of = (provider: string) => {
          const p = providers.get(provider) ?? emptyProviderDay();
          providers.set(provider, p);
          return p;
        };
        for (const c of connections) {
          const p = of(c.provider);
          const connected =
            c.connectedAt < d.end && (!c.disconnectedAt || c.disconnectedAt >= d.end);
          p.connected ||= connected;
          if (inDay(c.connectedAt)) p.connects += 1;
          if (inDay(c.disconnectedAt)) p.disconnects += 1;
        }
        const activeSince = d.end.getTime() - ACTIVE_DAYS * DAY_MS;
        for (const r of runs) {
          const p = of(r.connection.provider);
          if (inDay(r.createdAt)) {
            p.requests += 1;
            if (r.status === 'SUCCEEDED') p.successes += 1;
            if (r.status === 'FAILED' || r.status === 'PARTIAL') p.failures += 1;
          }
          if (r.startedAt && r.finishedAt && inDay(r.finishedAt))
            p.latencyMs.push(r.finishedAt.getTime() - r.startedAt.getTime());
          if (
            r.status === 'SUCCEEDED' &&
            r.finishedAt &&
            r.finishedAt.getTime() >= activeSince &&
            r.finishedAt.getTime() < d.end.getTime()
          )
            p.active = true;
        }
        for (const p of providers.values()) p.active &&= p.connected;
        facts.providers.set(d.day.getTime(), providers);
      }
      return facts;
    });
  }

  /**
   * Firmivra's own integrations (platform tables, platform scope): a day's requests are its log
   * entries, their outcome; latency and volume come from the runs that finished that day.
   */
  private async platformIntegrations(tx: TxClient, d: Day): Promise<number> {
    const integrations = await tx.platformIntegration.findMany({ select: { id: true } });
    let rows = 0;
    for (const { id } of integrations) {
      const [logs, runs] = await Promise.all([
        tx.platformIntegrationLog.groupBy({
          by: ['succeeded'],
          where: { integrationId: id, createdAt: { gte: d.start, lt: d.end } },
          _count: { _all: true },
        }),
        tx.platformIntegrationRun.findMany({
          where: { integrationId: id, finishedAt: { gte: d.start, lt: d.end } },
          select: { startedAt: true, finishedAt: true, objectCount: true },
        }),
      ]);
      const successes = logs.find((l) => l.succeeded)?._count._all ?? 0;
      const failures = logs.find((l) => !l.succeeded)?._count._all ?? 0;
      const timed = runs
        .filter((r) => r.startedAt && r.finishedAt)
        .map((r) => (r.finishedAt as Date).getTime() - (r.startedAt as Date).getTime());
      const data = {
        requests: successes + failures,
        successes,
        failures,
        avgLatencyMs: timed.length ? average(timed) : null,
        volume: runs.length ? BigInt(runs.reduce((n, r) => n + r.objectCount, 0)) : null,
      };
      await tx.platformIntegrationUsageDaily.upsert({
        where: {
          day_scope_subjectKey: { day: d.day, scope: 'PLATFORM_INTEGRATION', subjectKey: id },
        },
        create: { day: d.day, scope: 'PLATFORM_INTEGRATION', subjectKey: id, ...data },
        update: { ...data, computedAt: new Date() },
      });
      rows += 1;
    }
    return rows;
  }
}

const emptyProviderDay = (): ProviderDay => ({
  connected: false,
  active: false,
  connects: 0,
  disconnects: 0,
  requests: 0,
  successes: 0,
  failures: 0,
  latencyMs: [],
});
const average = (values: number[]) => Math.round(values.reduce((n, v) => n + v, 0) / values.length);

@Module({ providers: [PlatformRollupJob], exports: [PlatformRollupJob] })
export class PlatformRollupsModule {}
