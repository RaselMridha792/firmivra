import { Injectable } from '@nestjs/common';
import { databaseErrorCode, type Prisma, type TxClient } from '@firmivra/db';
import {
  type AdminCatalogItem,
  type AdminCatalogPreview,
  type AdminConfirmAccessLoss,
  type AdminFirmOption,
  type AdminPlanOption,
  type CreateAdminCatalogRequest,
  type ListAdminCatalogQuery,
  type ListAdminCatalogResponse,
  PlatformIntegrationCategory,
  type PutAdminCatalogFirmRequest,
  type UpdateAdminCatalogRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { auditIn } from './integration-records.js';
import {
  type AccessRules,
  cleanText,
  cleanUrl,
  connectLabel,
  failure,
  FIRMIVRA_SECRET,
  firmsLosingAccess,
  invalid,
  keyOf,
  optionalText,
  optionalUrl,
  readAdvanced,
  readSetup,
  type StoredCatalogAdvanced,
  type StoredCatalogSetup,
} from './integrations.rules.js';

type Json = Prisma.InputJsonValue;
const include = {
  plans: { include: { plan: { select: { id: true, name: true } } } },
  firmRules: true,
  platformIntegration: {
    select: {
      id: true,
      name: true,
      status: true,
      environment: true,
      lastCheckAt: true,
      lastCheckOk: true,
    },
  },
} as const;
type Row = Prisma.PlatformIntegrationCatalogGetPayload<{ include: typeof include }>;

const DAY_MS = 86_400_000;
const STATUS_RANK = { ENABLED: 0, DISABLED: 1, COMING_SOON: 2 } as const;
const CATEGORY_RANK = (c: string) => PlatformIntegrationCategory.options.indexOf(c as never);
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * DAY_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const humanize = (key: string) => {
  const words = key.replace(/^b_/, '').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const rulesOf = (r: Row): AccessRules => ({
  status: r.status,
  planAccess: r.planAccess,
  planIds: new Set(r.plans.map((p) => p.planId)),
  firmRules: new Map(r.firmRules.map((f) => [f.businessId, f.access])),
});

/** Adoption from the daily rollup: the latest day's firm counts and 30 days of changes. */
interface Adoption {
  connectedFirms: number;
  activeFirms: number;
  connects30d: number;
  disconnects30d: number;
  lastActivityAt: string | null;
}
const NO_ADOPTION: Adoption = {
  connectedFirms: 0,
  activeFirms: 0,
  connects30d: 0,
  disconnects30d: 0,
  lastActivityAt: null,
};

/**
 * The customer integration catalog (R0 stage B8, `platform_integration_catalog*`): what firms may
 * discover and connect, by plan and per firm. Admin scope only. Adoption comes from the daily
 * rollup, never from reading firms' own connections (B8). A change that hides an entry from firms
 * while firms have it connected answers 409 ACCESS_LOSS until it is confirmed.
 */
@Injectable()
export class IntegrationCatalogService {
  constructor(private readonly admin: AdminPrisma) {}

  // ---------- Options ----------

  async plans(): Promise<AdminPlanOption[]> {
    return this.admin.db.platformPlan.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true },
    });
  }

  async firmOptions(search: string | undefined): Promise<AdminFirmOption[]> {
    const firms = await this.admin.db.business.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, name: true },
    });
    const plans = await this.firmPlans(firms.map((f) => f.id));
    return firms.map((f) => ({
      id: f.id,
      name: f.name,
      planId: plans.get(f.id)?.id ?? null,
      planName: plans.get(f.id)?.name ?? null,
    }));
  }

  // ---------- Reads ----------

  async list(q: z.output<typeof ListAdminCatalogQuery>): Promise<ListAdminCatalogResponse> {
    const rows = await this.admin.db.platformIntegrationCatalog.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.category ? { category: q.category } : {}),
        AND: [
          q.plan
            ? { OR: [{ planAccess: 'ALL_PLANS' }, { plans: { some: { planId: q.plan } } }] }
            : {},
          q.search
            ? {
                OR: [
                  { name: { contains: q.search, mode: 'insensitive' } },
                  { provider: { contains: q.search.toLowerCase() } },
                  { shortDescription: { contains: q.search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      include,
      take: 1000,
    });
    const adoption = await this.adoption(rows.map((r) => r.provider));
    const sign = q.descending ? -1 : 1;
    const key = (r: Row): string | number =>
      q.sort === 'name'
        ? r.name.toLowerCase()
        : q.sort === 'category'
          ? CATEGORY_RANK(r.category)
          : q.sort === 'customers'
            ? (adoption.get(r.provider)?.connectedFirms ?? 0)
            : q.sort === 'status'
              ? STATUS_RANK[r.status]
              : r.sortOrder;
    const sorted = [...rows].sort((a, b) => {
      const l = key(a);
      const r = key(b);
      const c =
        typeof l === 'number' && typeof r === 'number' ? l - r : String(l).localeCompare(String(r));
      return c * sign || a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime();
    });
    const pageRows = sorted.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    return {
      items: await this.shape(pageRows, adoption),
      total: sorted.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(id: string): Promise<AdminCatalogItem> {
    const row = await this.find(id);
    const [item] = await this.shape([row], await this.adoption([row.provider]));
    return item as AdminCatalogItem;
  }

  /** How firms see it; never live customer data. */
  async preview(id: string): Promise<AdminCatalogPreview> {
    const row = await this.find(id);
    const setup = readSetup(row.setup);
    const advanced = readAdvanced(row.advanced);
    const badges = this.badgeLabels(row.badges, advanced);
    return {
      id: row.id,
      name: advanced.displayLabel ?? row.name,
      category: row.category,
      shortDescription: row.shortDescription,
      description: row.description,
      logo: advanced.logo,
      badges: advanced.beta ? [...badges, 'Beta'] : badges,
      status: row.status,
      hidden: row.status === 'DISABLED',
      connectable: row.status === 'ENABLED',
      connectLabel: connectLabel(row.status),
      setup: this.setupOf(setup),
      websiteUrl: row.websiteUrl,
      helpUrl: row.helpUrl,
      deprecationNotice: advanced.deprecationNotice,
    };
  }

  // ---------- Writes ----------

  /** A new entry starts DISABLED, on all plans; its provider key never changes. */
  async create(b: z.output<typeof CreateAdminCatalogRequest>): Promise<AdminCatalogItem> {
    const name = cleanText(b.name, 'integration name', 120);
    const shortDescription = cleanText(b.shortDescription, 'short description', 200);
    const description = optionalText(b.description, 'detailed description', 5000) ?? null;
    const websiteUrl = cleanUrl(b.websiteUrl, 'website URL');
    const helpUrl = cleanUrl(b.helpUrl, 'help URL');
    const id = await this.admin
      .transaction(async (tx) => {
        if (await tx.platformIntegrationCatalog.findUnique({ where: { provider: b.provider } }))
          throw failure('DUPLICATE_PROVIDER');
        if (b.platformIntegrationId) await this.checkLinked(tx, b.platformIntegrationId);
        const last = await tx.platformIntegrationCatalog.aggregate({ _max: { sortOrder: true } });
        const row = await tx.platformIntegrationCatalog.create({
          data: {
            provider: b.provider,
            name,
            category: b.category,
            shortDescription,
            description,
            websiteUrl,
            helpUrl,
            sortOrder: (last._max.sortOrder ?? 0) + 1,
            platformIntegrationId: b.platformIntegrationId ?? null,
            setup: readSetup({}) as Json,
            advanced: readAdvanced({}) as Json,
          },
          select: { id: true },
        });
        await auditIn(tx, {
          action: 'integrations.catalog.created',
          entity: { type: 'integration_catalog', id: row.id },
          label: name,
          metadata: { provider: b.provider },
        });
        return row.id;
      })
      .catch((e: unknown) => {
        if (databaseErrorCode(e) === '23505') throw failure('DUPLICATE_PROVIDER');
        throw e;
      });
    return this.get(id);
  }

  /** A versioned save; 409 ACCESS_LOSS when connected firms would lose it. */
  async update(
    id: string,
    b: z.output<typeof UpdateAdminCatalogRequest>,
  ): Promise<AdminCatalogItem> {
    const row = await this.find(id);
    if (b.version !== row.version) throw failure('CONFLICT');
    const setup = readSetup(row.setup);
    const advanced = readAdvanced(row.advanced);
    const data: Prisma.PlatformIntegrationCatalogUncheckedUpdateManyInput = {};
    const changed: string[] = [];
    if (b.name !== undefined) data.name = cleanText(b.name, 'integration name', 120);
    if (b.category !== undefined) data.category = b.category;
    if (b.shortDescription !== undefined)
      data.shortDescription = cleanText(b.shortDescription, 'short description', 200);
    if (b.description !== undefined)
      data.description = optionalText(b.description, 'detailed description', 5000);
    if (b.websiteUrl !== undefined) data.websiteUrl = optionalUrl(b.websiteUrl, 'website URL');
    if (b.helpUrl !== undefined) data.helpUrl = optionalUrl(b.helpUrl, 'help URL');
    if (b.status !== undefined) data.status = b.status;
    if (b.planAccess !== undefined) data.planAccess = b.planAccess;
    if (b.sortOrder !== undefined) data.sortOrder = b.sortOrder;
    if (b.platformIntegrationId !== undefined) data.platformIntegrationId = b.platformIntegrationId;
    for (const [field, value] of Object.entries(data))
      if (value !== (row as Record<string, unknown>)[field]) changed.push(field);

    const nextSetup: StoredCatalogSetup = { ...setup };
    if (b.setup) {
      Object.assign(nextSetup, b.setup);
      nextSetup.instructions = nextSetup.instructions.trim();
      nextSetup.helpText = nextSetup.helpText?.trim() || null;
      if (FIRMIVRA_SECRET.test(`${nextSetup.instructions} ${nextSetup.helpText ?? ''}`))
        throw invalid('Customer instructions cannot contain Firmivra secrets.');
      if (nextSetup.requiredFields.some((f) => !f.key.trim() || !f.label.trim()))
        throw invalid('Give every required field a key and a label.');
      changed.push('setup');
    }
    if (b.requiredRole !== undefined && b.requiredRole !== setup.requiredRole) {
      nextSetup.requiredRole = b.requiredRole;
      changed.push('requiredRole');
    }
    const nextAdvanced: StoredCatalogAdvanced = {
      ...advanced,
      badgeLabels: { ...advanced.badgeLabels },
    };
    if (b.advanced) {
      Object.assign(nextAdvanced, b.advanced);
      if (nextAdvanced.minAppVersion && !/^\d+\.\d+(\.\d+)?$/.test(nextAdvanced.minAppVersion))
        throw invalid('Write the version as 1.2 or 1.2.3.');
      nextAdvanced.featureFlag = nextAdvanced.featureFlag?.trim() || null;
      nextAdvanced.deprecationNotice = nextAdvanced.deprecationNotice?.trim() || null;
      changed.push('advanced');
    }
    if (b.displayLabel !== undefined) {
      nextAdvanced.displayLabel = optionalText(b.displayLabel, 'display label', 40) ?? null;
      changed.push('displayLabel');
    }
    if (b.logo !== undefined) {
      nextAdvanced.logo = b.logo;
      changed.push('logo');
    }
    if (b.badges !== undefined) {
      const labels = new Map<string, string>();
      for (const label of b.badges) {
        const text = cleanText(label, 'badge', 30);
        if (!labels.has(keyOf(text))) labels.set(keyOf(text), text);
      }
      data.badges = [...labels.keys()];
      nextAdvanced.badgeLabels = Object.fromEntries(labels);
      changed.push('badges');
    }
    data.setup = nextSetup as Json;
    data.advanced = nextAdvanced as Json;

    const planIds = b.planIds ? [...new Set(b.planIds)] : null;
    const before = rulesOf(row);
    const after: AccessRules = {
      ...before,
      status: data.status ?? row.status,
      planAccess: data.planAccess ?? row.planAccess,
      planIds: planIds ? new Set(planIds) : before.planIds,
    } as AccessRules;
    if (after.planAccess === 'SELECTED_PLANS' && after.planIds.size === 0)
      throw invalid('Choose at least one plan, or make it available on all plans.');
    if (planIds) changed.push('plans');
    const access = changed.some((c) =>
      ['status', 'planAccess', 'plans', 'requiredRole'].includes(c),
    );
    await this.admin.transaction(async (tx) => {
      if (planIds) {
        const found = await tx.platformPlan.count({ where: { id: { in: planIds } } });
        if (found !== planIds.length) throw invalid('Choose plans from the list.');
      }
      if (b.platformIntegrationId) await this.checkLinked(tx, b.platformIntegrationId);
      const losing = await this.guardAccessLoss(tx, row, after, b.confirmAccessLoss);
      const { count } = await tx.platformIntegrationCatalog.updateMany({
        where: { id, version: b.version },
        data,
      });
      if (!count) throw failure('CONFLICT');
      if (planIds) {
        await tx.platformIntegrationCatalogPlan.deleteMany({
          where: { catalogId: id, planId: { notIn: planIds } },
        });
        await tx.platformIntegrationCatalogPlan.createMany({
          data: planIds.map((planId) => ({ catalogId: id, planId })),
          skipDuplicates: true,
        });
      }
      await auditIn(tx, {
        action: access ? 'integrations.catalog.access_changed' : 'integrations.catalog.updated',
        entity: { type: 'integration_catalog', id },
        label: (data.name as string | undefined) ?? row.name,
        metadata: {
          fields: [...new Set(changed)],
          ...(losing ? { firmsLosingAccess: losing } : {}),
        },
        severity: access ? 'MEDIUM' : 'LOW',
      });
    });
    return this.get(id);
  }

  async putPlan(id: string, planId: string): Promise<AdminCatalogItem> {
    const row = await this.find(id);
    if (row.plans.some((p) => p.planId === planId)) return this.get(id);
    await this.admin.transaction(async (tx) => {
      const plan = await tx.platformPlan.findUnique({
        where: { id: planId },
        select: { name: true },
      });
      if (!plan) throw failure('NOT_FOUND', 'This plan was not found.');
      await tx.platformIntegrationCatalogPlan.createMany({
        data: [{ catalogId: id, planId }],
        skipDuplicates: true,
      });
      await this.touch(tx, id);
      await auditIn(tx, {
        action: 'integrations.catalog.plan_added',
        entity: { type: 'integration_catalog', id },
        label: row.name,
        metadata: { planId, plan: plan.name },
        severity: 'MEDIUM',
      });
    });
    return this.get(id);
  }

  async deletePlan(
    id: string,
    planId: string,
    b: z.output<typeof AdminConfirmAccessLoss>,
  ): Promise<AdminCatalogItem> {
    const row = await this.find(id);
    if (!row.plans.some((p) => p.planId === planId)) return this.get(id);
    const before = rulesOf(row);
    const after = { ...before, planIds: new Set([...before.planIds].filter((p) => p !== planId)) };
    if (row.planAccess === 'SELECTED_PLANS' && after.planIds.size === 0)
      throw invalid('Keep at least one plan, or make it available on all plans.');
    await this.admin.transaction(async (tx) => {
      const losing = await this.guardAccessLoss(tx, row, after, b.confirmAccessLoss);
      await tx.platformIntegrationCatalogPlan.deleteMany({ where: { catalogId: id, planId } });
      await this.touch(tx, id);
      await auditIn(tx, {
        action: 'integrations.catalog.plan_removed',
        entity: { type: 'integration_catalog', id },
        label: row.name,
        metadata: { planId, ...(losing ? { firmsLosingAccess: losing } : {}) },
        severity: 'MEDIUM',
      });
    });
    return this.get(id);
  }

  /** A firm's ALLOW or DENY: it overrides the plan. */
  async putFirm(
    id: string,
    businessId: string,
    b: z.output<typeof PutAdminCatalogFirmRequest>,
  ): Promise<AdminCatalogItem> {
    const row = await this.find(id);
    const reason = optionalText(b.reason, 'reason', 1000) ?? null;
    const before = rulesOf(row);
    const after = { ...before, firmRules: new Map(before.firmRules).set(businessId, b.access) };
    await this.admin.transaction(async (tx) => {
      const firm = await tx.business.findUnique({
        where: { id: businessId },
        select: { id: true },
      });
      if (!firm) throw failure('NOT_FOUND', 'This firm was not found.');
      const losing = await this.guardAccessLoss(tx, row, after, b.confirmAccessLoss);
      await tx.platformIntegrationCatalogFirm.upsert({
        where: { catalogId_businessId: { catalogId: id, businessId } },
        create: { catalogId: id, businessId, access: b.access, reason },
        update: { access: b.access, reason },
      });
      await this.touch(tx, id);
      await auditIn(tx, {
        action: 'integrations.catalog.firm_access_set',
        entity: { type: 'integration_catalog', id },
        label: row.name,
        metadata: {
          businessId,
          access: b.access,
          before: before.firmRules.get(businessId) ?? null,
          ...(losing ? { firmsLosingAccess: losing } : {}),
        },
        severity: 'MEDIUM',
      });
    });
    return this.get(id);
  }

  /** Back to the plan default. */
  async deleteFirm(
    id: string,
    businessId: string,
    b: z.output<typeof AdminConfirmAccessLoss>,
  ): Promise<AdminCatalogItem> {
    const row = await this.find(id);
    const before = rulesOf(row);
    const had = before.firmRules.get(businessId);
    if (!had) return this.get(id);
    const firmRules = new Map(before.firmRules);
    firmRules.delete(businessId);
    await this.admin.transaction(async (tx) => {
      const losing = await this.guardAccessLoss(
        tx,
        row,
        { ...before, firmRules },
        b.confirmAccessLoss,
      );
      await tx.platformIntegrationCatalogFirm.deleteMany({ where: { catalogId: id, businessId } });
      await this.touch(tx, id);
      await auditIn(tx, {
        action: 'integrations.catalog.firm_access_cleared',
        entity: { type: 'integration_catalog', id },
        label: row.name,
        metadata: { businessId, before: had, ...(losing ? { firmsLosingAccess: losing } : {}) },
        severity: 'MEDIUM',
      });
    });
    return this.get(id);
  }

  // ---------- Helpers ----------

  private async find(id: string): Promise<Row> {
    const row = await this.admin.db.platformIntegrationCatalog.findUnique({
      where: { id },
      include,
    });
    if (!row) throw failure('NOT_FOUND');
    return row;
  }

  /** A plan or firm change is a new version of the entry too (the database stamps it). */
  private async touch(tx: TxClient, id: string) {
    await tx.platformIntegrationCatalog.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  private async checkLinked(tx: TxClient, integrationId: string) {
    const linked = await tx.platformIntegration.findUnique({
      where: { id: integrationId },
      select: { status: true },
    });
    if (!linked) throw failure('NOT_FOUND', 'This platform integration was not found.');
    if (linked.status === 'REMOVED')
      throw failure('INVALID_STATE', 'This platform integration was removed.');
  }

  /**
   * Firms that see the entry now and would not after the change. When the rollup says firms have
   * it connected, the change needs `confirmAccessLoss` (409 ACCESS_LOSS with both counts). Which
   * firms are connected is theirs to know (B8): the count is the latest rollup's.
   */
  private async guardAccessLoss(
    tx: TxClient,
    row: Row,
    after: AccessRules,
    confirmed: boolean | undefined,
  ): Promise<number> {
    const latest = await tx.platformIntegrationUsageDaily.findFirst({
      where: { scope: 'CATALOG', subjectKey: row.provider },
      orderBy: { day: 'desc' },
      select: { connectedFirms: true },
    });
    const connected = latest?.connectedFirms ?? 0;
    if (!connected) return 0;
    const [firms, subs] = await Promise.all([
      tx.business.findMany({ select: { id: true } }),
      tx.platformFirmSubscription.findMany({ select: { businessId: true, planId: true } }),
    ]);
    const planOf = new Map(subs.map((s) => [s.businessId, s.planId]));
    const losing = firmsLosingAccess(
      rulesOf(row),
      after,
      firms.map((f) => ({ id: f.id, planId: planOf.get(f.id) ?? null })),
    );
    if (losing && !confirmed)
      throw failure(
        'ACCESS_LOSS',
        `This change hides ${row.name} from ${losing} ${losing === 1 ? 'firm' : 'firms'}, and ${connected} ${connected === 1 ? 'firm has' : 'firms have'} it connected. Confirm to save it.`,
        { firmsLosingAccess: losing, connectedFirms: connected },
      );
    return losing;
  }

  private async firmPlans(ids: string[]): Promise<Map<string, { id: string; name: string }>> {
    if (!ids.length) return new Map();
    const subs = await this.admin.db.platformFirmSubscription.findMany({
      where: { businessId: { in: ids } },
      select: { businessId: true, plan: { select: { id: true, name: true } } },
    });
    return new Map(subs.map((s) => [s.businessId, s.plan]));
  }

  private async adoption(providers: string[]): Promise<Map<string, Adoption>> {
    if (!providers.length) return new Map();
    const rows = await this.admin.db.platformIntegrationUsageDaily.findMany({
      where: {
        scope: 'CATALOG',
        subjectKey: { in: [...new Set(providers)] },
        day: { gte: daysAgo(29) },
      },
      orderBy: { day: 'desc' },
      select: {
        subjectKey: true,
        day: true,
        requests: true,
        connectedFirms: true,
        activeFirms: true,
        connects: true,
        disconnects: true,
      },
    });
    const out = new Map<string, Adoption>();
    for (const r of rows) {
      const a = out.get(r.subjectKey) ?? {
        ...NO_ADOPTION,
        // Newest first: the first row a subject meets is its latest day.
        connectedFirms: r.connectedFirms ?? 0,
        activeFirms: r.activeFirms ?? 0,
      };
      a.connects30d += r.connects ?? 0;
      a.disconnects30d += r.disconnects ?? 0;
      if (
        !a.lastActivityAt &&
        (r.requests > 0 || (r.connects ?? 0) > 0 || (r.disconnects ?? 0) > 0)
      )
        a.lastActivityAt = r.day.toISOString();
      out.set(r.subjectKey, a);
    }
    return out;
  }

  private badgeLabels(keys: string[], advanced: StoredCatalogAdvanced) {
    return keys.map((k) => advanced.badgeLabels[k] ?? humanize(k));
  }

  private setupOf(s: StoredCatalogSetup): AdminCatalogItem['setup'] {
    return {
      authType: s.authType,
      instructions: s.instructions,
      requiredFields: s.requiredFields,
      helpText: s.helpText,
      testOnConnect: s.testOnConnect,
    };
  }

  private async shape(rows: Row[], adoption: Map<string, Adoption>): Promise<AdminCatalogItem[]> {
    if (!rows.length) return [];
    const db = this.admin.db;
    const firmIds = [...new Set(rows.flatMap((r) => r.firmRules.map((f) => f.businessId)))];
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [
          ...(r.updatedByUserId ? [r.updatedByUserId] : []),
          ...r.firmRules.flatMap((f) => (f.updatedByUserId ? [f.updatedByUserId] : [])),
        ]),
      ),
    ];
    const linkedIds = rows.flatMap((r) =>
      r.platformIntegrationId ? [r.platformIntegrationId] : [],
    );
    const [firms, plans, users, uptime] = await Promise.all([
      firmIds.length
        ? db.business.findMany({ where: { id: { in: firmIds } }, select: { id: true, name: true } })
        : [],
      this.firmPlans(firmIds),
      userIds.length
        ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [],
      linkedIds.length
        ? db.platformIntegrationUsageDaily.groupBy({
            by: ['subjectKey'],
            where: {
              scope: 'PLATFORM_INTEGRATION',
              subjectKey: { in: linkedIds },
              day: { gte: daysAgo(29) },
            },
            _sum: { requests: true, successes: true },
          })
        : [],
    ]);
    const firmName = new Map(firms.map((f) => [f.id, f.name]));
    const names = new Map(users.map((u) => [u.id, u.name]));
    const uptimeOf = new Map(
      uptime
        .filter((u) => (u._sum.requests ?? 0) > 0)
        .map((u) => [
          u.subjectKey,
          Math.round(((u._sum.successes ?? 0) / (u._sum.requests ?? 1)) * 10_000) / 100,
        ]),
    );
    return rows.map((r) => {
      const setup = readSetup(r.setup);
      const advanced = readAdvanced(r.advanced);
      const a = adoption.get(r.provider) ?? NO_ADOPTION;
      return {
        id: r.id,
        provider: r.provider,
        name: r.name,
        category: r.category,
        shortDescription: r.shortDescription,
        description: r.description,
        logo: advanced.logo,
        websiteUrl: r.websiteUrl,
        helpUrl: r.helpUrl,
        displayLabel: advanced.displayLabel,
        status: r.status,
        planAccess: r.planAccess,
        plans: r.plans.map((p) => ({ id: p.plan.id, name: p.plan.name })),
        firmRules: r.firmRules.map((f) => ({
          businessId: f.businessId,
          firmName: firmName.get(f.businessId) ?? 'Removed firm',
          planName: plans.get(f.businessId)?.name ?? 'No plan',
          access: f.access,
          reason: f.reason,
          updatedAt: f.updatedAt.toISOString(),
          updatedBy: f.updatedByUserId
            ? (names.get(f.updatedByUserId) ?? 'Firmivra team')
            : 'Firmivra team',
        })),
        requiredRole: setup.requiredRole,
        setup: this.setupOf(setup),
        badges: this.badgeLabels(r.badges, advanced),
        sortOrder: r.sortOrder,
        advanced: {
          featureFlag: advanced.featureFlag,
          beta: advanced.beta,
          deprecationNotice: advanced.deprecationNotice,
          minAppVersion: advanced.minAppVersion,
          rolloutPercent: advanced.rolloutPercent,
          regions: advanced.regions,
        },
        platformIntegration: r.platformIntegration
          ? {
              id: r.platformIntegration.id,
              name: r.platformIntegration.name,
              status: r.platformIntegration.status,
              environment: r.platformIntegration.environment,
              lastCheckAt: r.platformIntegration.lastCheckAt?.toISOString() ?? null,
              lastCheckOk: r.platformIntegration.lastCheckOk,
            }
          : null,
        stats: {
          firmsUsing: a.connectedFirms,
          activeFirms: a.activeFirms,
          totalConnections: a.connectedFirms,
          connects30d: a.connects30d,
          disconnects30d: a.disconnects30d,
          lastActivityAt: a.lastActivityAt,
          uptime30d: r.platformIntegrationId
            ? (uptimeOf.get(r.platformIntegrationId) ?? null)
            : null,
        },
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        updatedBy: r.updatedByUserId ? (names.get(r.updatedByUserId) ?? 'Firmivra team') : null,
      };
    });
  }
}
