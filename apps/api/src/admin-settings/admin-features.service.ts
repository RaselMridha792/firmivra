import { Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type {
  AdminFeature,
  AdminFeatureEmergencyRequest,
  AdminFeatureList,
  AdminFeatureOverride,
  AdminFeatureOverrideList,
  AdminFeatureQuery,
  CreateAdminFeatureRequest,
  SetAdminFeatureOverrideRequest,
  UpdateAdminFeatureRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { conflict, writeAdminEvent } from '../admin-audit/admin-audit.common.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { isUniqueViolation, notFound } from '../workspaces/common.js';
import { AdminSettingsService, rethrowCheck } from './admin-settings.service.js';

type Out<S extends z.ZodType> = z.output<S>;
type Row = {
  key: string;
  name: string;
  description: string | null;
  defaultState: 'ON' | 'OFF';
  emergencyDisabled: boolean;
  dependsOn: string[];
  updatedByUserId: string | null;
  updatedAt: Date;
  _count?: { overrides: number };
};

const dependency = (message: string) => conflict('FEATURE_DEPENDENCY', message);

/**
 * Feature Management (R55; `platform_features`, R0 stage B7). A firm's effective state: an
 * emergency off, then a required feature that is off for it, then its own override, then the
 * default. The API refuses a dependency on an unknown feature or a cycle; the database refuses a
 * feature depending on itself. An emergency switch writes a SECURITY audit row at once.
 */
@Injectable()
export class AdminFeaturesService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly settings: AdminSettingsService,
  ) {}

  private async view(tx: TxClient, rows: Row[]): Promise<AdminFeature[]> {
    const all = await tx.platformFeature.findMany({ select: { key: true, dependsOn: true } });
    const names = await this.settings.names(rows.map((r) => r.updatedByUserId));
    return rows.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      defaultState: r.defaultState,
      emergencyDisabled: r.emergencyDisabled,
      dependsOn: r.dependsOn,
      requiredBy: all.filter((f) => f.dependsOn.includes(r.key)).map((f) => f.key),
      overrides: r._count?.overrides ?? 0,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedByUserId ? (names.get(r.updatedByUserId) ?? null) : null,
    }));
  }

  private async one(tx: TxClient, key: string): Promise<AdminFeature> {
    const row = await tx.platformFeature.findUnique({
      where: { key },
      include: { _count: { select: { overrides: true } } },
    });
    if (!row) throw notFound();
    return (await this.view(tx, [row]))[0]!;
  }

  list(q: Out<typeof AdminFeatureQuery>): Promise<AdminFeatureList> {
    return this.admin.transaction(async (tx) => {
      const rows = await tx.platformFeature.findMany({
        include: { _count: { select: { overrides: true } } },
        orderBy: { name: 'asc' },
      });
      const s = q.search?.toLowerCase();
      const shown = rows.filter(
        (r) =>
          (!s ||
            r.key.includes(s) ||
            r.name.toLowerCase().includes(s) ||
            (r.description ?? '').toLowerCase().includes(s)) &&
          (!q.state ||
            (q.state === 'EMERGENCY_OFF'
              ? r.emergencyDisabled
              : !r.emergencyDisabled && r.defaultState === q.state)),
      );
      return {
        items: await this.view(tx, shown),
        counts: {
          total: rows.length,
          on: rows.filter((r) => !r.emergencyDisabled && r.defaultState === 'ON').length,
          off: rows.filter((r) => !r.emergencyDisabled && r.defaultState === 'OFF').length,
          emergencyOff: rows.filter((r) => r.emergencyDisabled).length,
        },
      };
    });
  }

  /** Every dependency exists, and the chain never comes back to `key`. */
  private async checkDependencies(tx: TxClient, key: string, dependsOn: string[]) {
    const all = await tx.platformFeature.findMany({ select: { key: true, dependsOn: true } });
    const graph = new Map(all.map((f) => [f.key, f.dependsOn]));
    for (const d of dependsOn) {
      if (d === key) throw dependency('A feature cannot depend on itself');
      if (!graph.has(d)) throw dependency(`No feature has the key ${d}`);
    }
    graph.set(key, dependsOn);
    const seen = new Set<string>();
    const walk = (k: string): void => {
      for (const next of graph.get(k) ?? []) {
        if (next === key) throw dependency('These dependencies would go round in a circle');
        if (!seen.has(next)) {
          seen.add(next);
          walk(next);
        }
      }
    };
    walk(key);
  }

  async create(body: Out<typeof CreateAdminFeatureRequest>): Promise<AdminFeature> {
    const adminUserId = this.admin.adminUserId;
    try {
      return await this.admin.transaction(async (tx) => {
        await this.checkDependencies(tx, body.key, body.dependsOn ?? []);
        await tx.platformFeature
          .create({
            data: {
              key: body.key,
              name: body.name,
              description: body.description ?? null,
              defaultState: body.defaultState,
              dependsOn: body.dependsOn ?? [],
            },
          })
          .catch((e: unknown) => {
            if (isUniqueViolation(e)) throw conflict('CONFLICT', 'A feature has this key already');
            throw e;
          });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.feature_created',
          entityType: 'platform_feature',
          entityId: body.key,
          category: 'SYSTEM',
          severity: 'LOW',
          metadata: { defaultState: body.defaultState, dependsOn: body.dependsOn ?? [] },
        });
        return this.one(tx, body.key);
      });
    } catch (e) {
      rethrowCheck(e);
    }
  }

  async update(key: string, body: Out<typeof UpdateAdminFeatureRequest>): Promise<AdminFeature> {
    const adminUserId = this.admin.adminUserId;
    try {
      return await this.admin.transaction(async (tx) => {
        const row = await tx.platformFeature.findUnique({ where: { key } });
        if (!row) throw notFound();
        if (body.dependsOn) await this.checkDependencies(tx, key, body.dependsOn);
        await tx.platformFeature.update({
          where: { key },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.defaultState !== undefined ? { defaultState: body.defaultState } : {}),
            ...(body.dependsOn !== undefined ? { dependsOn: body.dependsOn } : {}),
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.feature_updated',
          entityType: 'platform_feature',
          entityId: key,
          category: 'SYSTEM',
          severity: 'LOW',
          metadata: {
            fields: Object.keys(body).filter(
              (k) => (body as Record<string, unknown>)[k] !== undefined,
            ),
            ...(body.defaultState && body.defaultState !== row.defaultState
              ? { defaultState: { from: row.defaultState, to: body.defaultState } }
              : {}),
          },
        });
        return this.one(tx, key);
      });
    } catch (e) {
      rethrowCheck(e);
    }
  }

  emergency(key: string, body: Out<typeof AdminFeatureEmergencyRequest>): Promise<AdminFeature> {
    const adminUserId = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformFeature.findUnique({ where: { key } });
      if (!row) throw notFound();
      if (row.emergencyDisabled !== body.disabled) {
        await tx.platformFeature.update({
          where: { key },
          data: { emergencyDisabled: body.disabled },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: body.disabled
            ? 'system_settings.feature_emergency_disabled'
            : 'system_settings.feature_emergency_enabled',
          entityType: 'platform_feature',
          entityId: key,
          category: 'SECURITY',
          severity: body.disabled ? 'HIGH' : 'MEDIUM',
          targetLabel: row.name,
          metadata: { reasonLength: body.reason.length },
        });
      }
      return this.one(tx, key);
    });
  }

  // ---------- Firm overrides ----------

  /** What a firm gets: emergency off, then a required feature off for it, then its override, then the default. */
  private effective(
    key: string,
    businessId: string,
    features: Map<
      string,
      { defaultState: 'ON' | 'OFF'; emergencyDisabled: boolean; dependsOn: string[] }
    >,
    overrides: Map<string, 'ON' | 'OFF'>,
    seen = new Set<string>(),
  ): 'ON' | 'OFF' {
    const f = features.get(key);
    if (!f || f.emergencyDisabled || seen.has(key)) return 'OFF';
    seen.add(key);
    if (f.dependsOn.some((d) => this.effective(d, businessId, features, overrides, seen) === 'OFF'))
      return 'OFF';
    return overrides.get(`${key}:${businessId}`) ?? f.defaultState;
  }

  private async overrideViews(
    tx: TxClient,
    key: string,
    businessIds?: string[],
  ): Promise<AdminFeatureOverride[]> {
    const [features, overrides] = await Promise.all([
      tx.platformFeature.findMany({
        select: { key: true, defaultState: true, emergencyDisabled: true, dependsOn: true },
      }),
      tx.platformFeatureOverride.findMany({ include: { business: { select: { name: true } } } }),
    ]);
    const fmap = new Map(features.map((f) => [f.key, f]));
    const omap = new Map(overrides.map((o) => [`${o.featureKey}:${o.businessId}`, o.state]));
    return overrides
      .filter((o) => o.featureKey === key && (!businessIds || businessIds.includes(o.businessId)))
      .map((o) => ({
        businessId: o.businessId,
        firmName: o.business.name,
        state: o.state,
        reason: o.reason,
        effective: this.effective(key, o.businessId, fmap, omap),
        updatedAt: o.updatedAt.toISOString(),
      }));
  }

  overrides(key: string): Promise<AdminFeatureOverrideList> {
    return this.admin.transaction(async (tx) => {
      if (!(await tx.platformFeature.findUnique({ where: { key }, select: { key: true } })))
        throw notFound();
      return { items: await this.overrideViews(tx, key) };
    });
  }

  setOverride(
    key: string,
    businessId: string,
    body: Out<typeof SetAdminFeatureOverrideRequest>,
  ): Promise<AdminFeatureOverride> {
    const adminUserId = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const [feature, firm] = await Promise.all([
        tx.platformFeature.findUnique({ where: { key }, select: { key: true } }),
        tx.business.findUnique({ where: { id: businessId }, select: { id: true } }),
      ]);
      if (!feature || !firm) throw notFound();
      await tx.platformFeatureOverride.upsert({
        where: { featureKey_businessId: { featureKey: key, businessId } },
        create: { featureKey: key, businessId, state: body.state, reason: body.reason ?? null },
        update: { state: body.state, reason: body.reason ?? null },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'system_settings.feature_override_set',
        entityType: 'platform_feature',
        entityId: key,
        category: 'SYSTEM',
        severity: 'LOW',
        subjectBusinessId: businessId,
        metadata: { businessId, state: body.state },
      });
      return (await this.overrideViews(tx, key, [businessId]))[0]!;
    });
  }

  async removeOverride(key: string, businessId: string): Promise<{ ok: true }> {
    const adminUserId = this.admin.adminUserId;
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformFeatureOverride.deleteMany({
        where: { featureKey: key, businessId },
      });
      if (!count) throw notFound();
      await writeAdminEvent(tx, adminUserId, {
        action: 'system_settings.feature_override_removed',
        entityType: 'platform_feature',
        entityId: key,
        category: 'SYSTEM',
        severity: 'LOW',
        subjectBusinessId: businessId,
        metadata: { businessId },
      });
    });
    return { ok: true };
  }
}
