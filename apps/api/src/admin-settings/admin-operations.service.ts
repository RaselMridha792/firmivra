import { BadRequestException, Injectable } from '@nestjs/common';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import type {
  AdminDefaultSetVersions,
  AdminFirmDefaults,
  AdminFirmDefaultSet,
  AdminJob,
  AdminJobList,
  AdminLegalHold,
  AdminLegalHoldList,
  AdminMaintenanceList,
  AdminMaintenanceWindow,
  AdminRetentionPolicy,
  AdminRetentionPolicyList,
  AdminRetentionRun,
  AdminRetentionRunList,
  AdminUserDefaults,
  AdminUserDefaultSet,
  CreateAdminLegalHoldRequest,
  CreateAdminMaintenanceRequest,
  SaveAdminFirmDefaultsRequest,
  SaveAdminUserDefaultsRequest,
  UpdateAdminMaintenanceRequest,
  UpdateAdminRetentionPolicyRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { conflict, writeAdminEvent } from '../admin-audit/admin-audit.common.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { notFound } from '../workspaces/common.js';
import { AdminSettingsService, rethrowCheck, saveConflict } from './admin-settings.service.js';

type Out<S extends z.ZodType> = z.output<S>;
type Json = Record<string, unknown>;

const stateError = (message: string) => conflict('STATE', message);
/** A lifecycle the database refused (its trigger or CHECK) as 409 STATE, never a 500. */
const lifecycle = (e: unknown, message: string): never => {
  if (databaseErrorCode(e) === '23514') throw stateError(message);
  throw e;
};
const iso = (d: Date | null) => d?.toISOString() ?? null;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

/** A FIRM default set's values as the contract's (the seeded version 1 is the older shape). */
export function firmDefaultsOf(v: unknown): AdminFirmDefaults {
  const x = obj(v);
  const regional = obj(x.regional);
  const n = obj(x.notifications);
  const o = obj(x.onboarding);
  return {
    planCode: typeof x.planCode === 'string' ? x.planCode : null,
    trialDays: typeof x.trialDays === 'number' ? x.trialDays : 14,
    timeZone:
      typeof x.timeZone === 'string'
        ? x.timeZone
        : typeof regional.timeZone === 'string'
          ? regional.timeZone
          : null,
    currency: typeof x.currency === 'string' ? x.currency : null,
    dateFormat:
      x.dateFormat === 'MM/DD/YYYY' ||
      x.dateFormat === 'DD/MM/YYYY' ||
      x.dateFormat === 'YYYY-MM-DD'
        ? x.dateFormat
        : null,
    features: Array.isArray(x.features)
      ? x.features.filter((f): f is string => typeof f === 'string')
      : [],
    notifications: { email: n.email !== false, sms: n.sms === true, inApp: n.inApp !== false },
    onboarding: {
      sendWelcomeEmail: o.sendWelcomeEmail !== false,
      assignOnboardingTasks: o.assignOnboardingTasks === true,
    },
  };
}

export function userDefaultsOf(v: unknown): AdminUserDefaults {
  const x = obj(v);
  const regional = obj(x.regional);
  const n = obj(x.notifications);
  const roles = [
    'MANAGER',
    'STAFF',
    'BOOKKEEPER',
    'TAX_PREPARER',
    'CLIENT_SUPPORT',
    'READ_ONLY',
  ] as const;
  return {
    role: roles.includes(x.role as (typeof roles)[number])
      ? (x.role as (typeof roles)[number])
      : 'STAFF',
    requireEmailVerification: x.requireEmailVerification !== false,
    timeZone:
      typeof x.timeZone === 'string'
        ? x.timeZone
        : typeof regional.timeZone === 'string'
          ? regional.timeZone
          : null,
    locale:
      typeof x.locale === 'string'
        ? x.locale
        : typeof regional.locale === 'string'
          ? regional.locale
          : null,
    appearance:
      x.appearance === 'LIGHT' || x.appearance === 'DARK' || x.appearance === 'SYSTEM'
        ? x.appearance
        : null,
    notifications: { email: n.email !== false, sms: n.sms === true, inApp: n.inApp !== false },
    sendWelcomeEmail: x.sendWelcomeEmail !== false,
  };
}

/**
 * Data & Retention, Maintenance and Defaults (R55; R0 stage B7). Retention changes apply going
 * forward and never below their floor; a run is queued for the retention worker (a dry run by
 * default) and never deletes here. Maintenance windows and job controls follow the database's
 * lifecycles. Default sets are versions: a save adds one; existing firms and users never change.
 */
@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly settings: AdminSettingsService,
  ) {}

  private names(ids: (string | null)[]) {
    return this.settings.names(ids);
  }

  // ---------- Retention ----------

  async retention(): Promise<AdminRetentionPolicyList> {
    return this.admin.transaction(async (tx) => {
      const [rows, holds] = await Promise.all([
        tx.platformRetentionPolicy.findMany({ orderBy: { category: 'asc' } }),
        tx.platformLegalHold.groupBy({
          by: ['category'],
          where: { releasedAt: null, category: { not: null } },
          _count: { _all: true },
        }),
      ]);
      const names = await this.names(rows.map((r) => r.updatedByUserId));
      const held = new Map(holds.map((h) => [h.category, h._count._all]));
      return {
        items: rows.map((r) => this.policyView(r, names, held.get(r.category) ?? 0)),
      };
    });
  }

  private policyView(
    r: {
      category: string;
      retentionDays: number;
      disposition: AdminRetentionPolicy['disposition'];
      archiveAfterDays: number | null;
      minimumDays: number;
      effectiveFrom: Date;
      version: number;
      updatedAt: Date;
      updatedByUserId: string | null;
    },
    names: Map<string, string>,
    activeHolds: number,
  ): AdminRetentionPolicy {
    return {
      category: r.category,
      retentionDays: r.retentionDays,
      disposition: r.disposition,
      archiveAfterDays: r.archiveAfterDays,
      minimumDays: r.minimumDays,
      effectiveFrom: r.effectiveFrom.toISOString(),
      version: r.version,
      activeHolds,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedByUserId ? (names.get(r.updatedByUserId) ?? null) : null,
    };
  }

  async updateRetention(
    category: string,
    body: Out<typeof UpdateAdminRetentionPolicyRequest>,
  ): Promise<AdminRetentionPolicy> {
    const adminUserId = this.admin.adminUserId;
    try {
      return await this.admin.transaction(async (tx) => {
        const row = await tx.platformRetentionPolicy.findUnique({ where: { category } });
        if (!row) throw notFound();
        if (row.version !== body.version) throw saveConflict();
        if (body.retentionDays < row.minimumDays)
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: `Keep at least ${row.minimumDays} days`,
            details: [{ path: 'retentionDays', message: `The floor is ${row.minimumDays} days` }],
          });
        const today = new Date().toISOString().slice(0, 10);
        if (body.effectiveFrom && body.effectiveFrom < today)
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'A retention change applies from today or later',
            details: [{ path: 'effectiveFrom', message: 'Choose today or a later day' }],
          });
        const { count } = await tx.platformRetentionPolicy.updateMany({
          where: { category, version: body.version },
          data: {
            retentionDays: body.retentionDays,
            disposition: body.disposition,
            archiveAfterDays: body.archiveAfterDays,
            effectiveFrom: body.effectiveFrom
              ? new Date(`${body.effectiveFrom}T00:00:00.000Z`)
              : new Date(),
          },
        });
        if (count !== 1) throw saveConflict();
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.retention_updated',
          entityType: 'platform_retention_policy',
          entityId: category,
          category: 'SYSTEM',
          severity:
            body.retentionDays < row.retentionDays || body.disposition !== row.disposition
              ? 'MEDIUM'
              : 'LOW',
          metadata: {
            retentionDays: { from: row.retentionDays, to: body.retentionDays },
            disposition: { from: row.disposition, to: body.disposition },
          },
        });
        const saved = await tx.platformRetentionPolicy.findUniqueOrThrow({ where: { category } });
        return this.policyView(saved, await this.names([saved.updatedByUserId]), 0);
      });
    } catch (e) {
      rethrowCheck(e);
    }
  }

  private async runViews(
    rows: {
      id: string;
      category: string;
      dryRun: boolean;
      status: AdminRetentionRun['status'];
      policyVersion: number;
      eligibleCount: number | null;
      affectedCount: number | null;
      heldCount: number | null;
      errorCode: string | null;
      requestedByUserId: string | null;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
    }[],
  ): Promise<AdminRetentionRun[]> {
    const names = await this.names(rows.map((r) => r.requestedByUserId));
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      dryRun: r.dryRun,
      status: r.status,
      policyVersion: r.policyVersion,
      eligibleCount: r.eligibleCount,
      affectedCount: r.affectedCount,
      heldCount: r.heldCount,
      errorCode: r.errorCode,
      requestedBy: r.requestedByUserId ? (names.get(r.requestedByUserId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
    }));
  }

  async runs(): Promise<AdminRetentionRunList> {
    const rows = await this.admin.db.platformRetentionRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return { items: await this.runViews(rows) };
  }

  async createRun(category: string, dryRun: boolean): Promise<AdminRetentionRun> {
    const adminUserId = this.admin.adminUserId;
    const row = await this.admin.transaction(async (tx) => {
      const policy = await tx.platformRetentionPolicy.findUnique({
        where: { category },
        select: { version: true },
      });
      if (!policy) throw notFound();
      const run = await tx.platformRetentionRun.create({
        data: { category, dryRun, policyVersion: policy.version },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'system_settings.retention_run_requested',
        entityType: 'platform_retention_run',
        entityId: run.id,
        category: 'SYSTEM',
        severity: dryRun ? 'INFO' : 'HIGH',
        metadata: { category, dryRun },
      });
      return run;
    });
    return (await this.runViews([row]))[0]!;
  }

  async cancelRun(id: string): Promise<AdminRetentionRun> {
    const adminUserId = this.admin.adminUserId;
    const row = await this.admin
      .transaction(async (tx) => {
        const run = await tx.platformRetentionRun.findUnique({ where: { id } });
        if (!run) throw notFound();
        if (run.status !== 'QUEUED') throw stateError('Only a queued run can be cancelled');
        await tx.platformRetentionRun.updateMany({
          where: { id, status: 'QUEUED' },
          data: { status: 'CANCELLED' },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.retention_run_cancelled',
          entityType: 'platform_retention_run',
          entityId: id,
          category: 'SYSTEM',
          severity: 'INFO',
        });
        return tx.platformRetentionRun.findUniqueOrThrow({ where: { id } });
      })
      .catch((e: unknown) => lifecycle(e, 'Only a queued run can be cancelled'));
    return (await this.runViews([row]))[0]!;
  }

  // ---------- Legal holds ----------

  private async holdViews(
    tx: TxClient,
    rows: {
      id: string;
      name: string;
      reason: string;
      category: string | null;
      heldBusinessId: string | null;
      recordType: string | null;
      recordId: string | null;
      createdByUserId: string | null;
      createdAt: Date;
      releasedAt: Date | null;
      releaseReason: string | null;
    }[],
  ): Promise<AdminLegalHold[]> {
    const firmIds = rows.map((r) => r.heldBusinessId).filter((x): x is string => !!x);
    const firms = new Map(
      (firmIds.length
        ? await tx.business.findMany({
            where: { id: { in: firmIds } },
            select: { id: true, name: true },
          })
        : []
      ).map((f) => [f.id, f.name]),
    );
    const names = await this.names(rows.map((r) => r.createdByUserId));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      reason: r.reason,
      category: r.category,
      firm: r.heldBusinessId
        ? { id: r.heldBusinessId, name: firms.get(r.heldBusinessId) ?? 'Unknown firm' }
        : null,
      record: r.recordType && r.recordId ? { type: r.recordType, id: r.recordId } : null,
      createdBy: r.createdByUserId ? (names.get(r.createdByUserId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      releasedAt: iso(r.releasedAt),
      releaseReason: r.releaseReason,
    }));
  }

  holds(): Promise<AdminLegalHoldList> {
    return this.admin.transaction(async (tx) => {
      const rows = await tx.platformLegalHold.findMany({
        orderBy: [{ releasedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      });
      return { items: await this.holdViews(tx, rows) };
    });
  }

  async createHold(body: Out<typeof CreateAdminLegalHoldRequest>): Promise<AdminLegalHold> {
    const adminUserId = this.admin.adminUserId;
    try {
      return await this.admin.transaction(async (tx) => {
        if (
          body.businessId &&
          !(await tx.business.findUnique({ where: { id: body.businessId }, select: { id: true } }))
        )
          throw notFound();
        const row = await tx.platformLegalHold.create({
          data: {
            name: body.name,
            reason: body.reason,
            category: body.category ?? null,
            heldBusinessId: body.businessId ?? null,
            recordType: body.record?.type ?? null,
            recordId: body.record?.id ?? null,
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.legal_hold_created',
          entityType: 'platform_legal_hold',
          entityId: row.id,
          category: 'SYSTEM',
          severity: 'MEDIUM',
          subjectBusinessId: body.businessId ?? null,
          metadata: { target: body.category ? 'category' : body.businessId ? 'firm' : 'record' },
        });
        return (await this.holdViews(tx, [row]))[0]!;
      });
    } catch (e) {
      rethrowCheck(e);
    }
  }

  releaseHold(id: string, reason: string): Promise<AdminLegalHold> {
    const adminUserId = this.admin.adminUserId;
    return this.admin
      .transaction(async (tx) => {
        const row = await tx.platformLegalHold.findUnique({ where: { id } });
        if (!row) throw notFound();
        if (row.releasedAt) throw stateError('This hold was released already');
        await tx.platformLegalHold.update({
          where: { id },
          data: { releasedAt: new Date(), releaseReason: reason },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.legal_hold_released',
          entityType: 'platform_legal_hold',
          entityId: id,
          category: 'SYSTEM',
          severity: 'MEDIUM',
          subjectBusinessId: row.heldBusinessId,
        });
        return (
          await this.holdViews(tx, [
            await tx.platformLegalHold.findUniqueOrThrow({ where: { id } }),
          ])
        )[0]!;
      })
      .catch((e: unknown) => lifecycle(e, 'This hold was released already'));
  }

  // ---------- Maintenance ----------

  private async windowViews(
    rows: {
      id: string;
      title: string;
      message: string;
      startsAt: Date;
      endsAt: Date;
      status: AdminMaintenanceWindow['status'];
      adminBypass: boolean;
      startedAt: Date | null;
      endedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      updatedByUserId: string | null;
      createdByUserId: string | null;
    }[],
  ): Promise<AdminMaintenanceWindow[]> {
    const names = await this.names(rows.map((r) => r.updatedByUserId ?? r.createdByUserId));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      status: r.status,
      adminBypass: r.adminBypass,
      startedAt: iso(r.startedAt),
      endedAt: iso(r.endedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      updatedBy:
        (r.updatedByUserId ?? r.createdByUserId)
          ? (names.get((r.updatedByUserId ?? r.createdByUserId)!) ?? null)
          : null,
    }));
  }

  async maintenance(): Promise<AdminMaintenanceList> {
    const rows = await this.admin.db.platformMaintenanceWindow.findMany({
      orderBy: [{ startsAt: 'desc' }],
      take: 100,
    });
    return { items: await this.windowViews(rows) };
  }

  async schedule(body: Out<typeof CreateAdminMaintenanceRequest>): Promise<AdminMaintenanceWindow> {
    const adminUserId = this.admin.adminUserId;
    try {
      const row = await this.admin.transaction(async (tx) => {
        const w = await tx.platformMaintenanceWindow.create({
          data: {
            title: body.title,
            message: body.message,
            startsAt: new Date(body.startsAt),
            endsAt: new Date(body.endsAt),
            adminBypass: body.adminBypass,
            createdByUserId: adminUserId,
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.maintenance_scheduled',
          entityType: 'platform_maintenance_window',
          entityId: w.id,
          category: 'SYSTEM',
          severity: 'MEDIUM',
          targetLabel: body.title,
        });
        return w;
      });
      return (await this.windowViews([row]))[0]!;
    } catch (e) {
      rethrowCheck(e);
    }
  }

  async updateWindow(
    id: string,
    body: Out<typeof UpdateAdminMaintenanceRequest>,
  ): Promise<AdminMaintenanceWindow> {
    const adminUserId = this.admin.adminUserId;
    const row = await this.admin
      .transaction(async (tx) => {
        const w = await tx.platformMaintenanceWindow.findUnique({ where: { id } });
        if (!w) throw notFound();
        if (w.status === 'COMPLETED' || w.status === 'CANCELLED')
          throw stateError('A finished window never changes');
        if (
          w.status === 'ACTIVE' &&
          (body.title !== undefined ||
            body.startsAt !== undefined ||
            body.adminBypass !== undefined)
        )
          throw stateError('While maintenance runs, only its message and end change');
        const endsAt = body.endsAt ? new Date(body.endsAt) : w.endsAt;
        const startsAt = body.startsAt ? new Date(body.startsAt) : w.startsAt;
        if (endsAt <= startsAt)
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'End after the start',
            details: [{ path: 'endsAt', message: 'End after the start' }],
          });
        await tx.platformMaintenanceWindow.update({
          where: { id },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.message !== undefined ? { message: body.message } : {}),
            ...(body.startsAt !== undefined ? { startsAt } : {}),
            ...(body.endsAt !== undefined ? { endsAt } : {}),
            ...(body.adminBypass !== undefined ? { adminBypass: body.adminBypass } : {}),
            updatedByUserId: adminUserId,
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.maintenance_updated',
          entityType: 'platform_maintenance_window',
          entityId: id,
          category: 'SYSTEM',
          severity: 'LOW',
          metadata: { fields: Object.keys(body).filter((k) => (body as Json)[k] !== undefined) },
        });
        return tx.platformMaintenanceWindow.findUniqueOrThrow({ where: { id } });
      })
      .catch((e: unknown) => lifecycle(e, 'This window cannot change that way'));
    return (await this.windowViews([row]))[0]!;
  }

  async moveWindow(
    id: string,
    to: 'ACTIVE' | 'COMPLETED' | 'CANCELLED',
  ): Promise<AdminMaintenanceWindow> {
    const adminUserId = this.admin.adminUserId;
    const from = to === 'COMPLETED' ? 'ACTIVE' : 'SCHEDULED';
    const row = await this.admin
      .transaction(async (tx) => {
        const w = await tx.platformMaintenanceWindow.findUnique({ where: { id } });
        if (!w) throw notFound();
        if (w.status !== from)
          throw stateError(
            to === 'ACTIVE'
              ? 'Only a scheduled window starts'
              : to === 'COMPLETED'
                ? 'Only running maintenance completes'
                : 'Only a scheduled window is cancelled',
          );
        await tx.platformMaintenanceWindow.updateMany({
          where: { id, status: from },
          data: { status: to, updatedByUserId: adminUserId },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: `system_settings.maintenance_${to === 'ACTIVE' ? 'started' : to.toLowerCase()}`,
          entityType: 'platform_maintenance_window',
          entityId: id,
          category: 'SYSTEM',
          severity: to === 'ACTIVE' ? 'HIGH' : 'MEDIUM',
          targetLabel: w.title,
        });
        return tx.platformMaintenanceWindow.findUniqueOrThrow({ where: { id } });
      })
      .catch((e: unknown) => lifecycle(e, 'This window cannot make that move'));
    return (await this.windowViews([row]))[0]!;
  }

  // ---------- Jobs ----------

  private async jobViews(
    rows: {
      jobKey: string;
      name: string;
      enabled: boolean;
      pausedReason: string | null;
      lastRunAt: Date | null;
      lastStatus: AdminJob['lastStatus'];
      lastError: string | null;
      updatedAt: Date;
      updatedByUserId: string | null;
    }[],
  ): Promise<AdminJob[]> {
    const names = await this.names(rows.map((r) => r.updatedByUserId));
    return rows.map((r) => ({
      key: r.jobKey,
      name: r.name,
      enabled: r.enabled,
      pausedReason: r.pausedReason,
      lastRunAt: iso(r.lastRunAt),
      lastStatus: r.lastStatus,
      lastError: r.lastError,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedByUserId ? (names.get(r.updatedByUserId) ?? null) : null,
    }));
  }

  async jobs(): Promise<AdminJobList> {
    const rows = await this.admin.db.platformJobControl.findMany({ orderBy: { name: 'asc' } });
    return { items: await this.jobViews(rows) };
  }

  async setJob(key: string, enabled: boolean, reason?: string): Promise<AdminJob> {
    const adminUserId = this.admin.adminUserId;
    const row = await this.admin.transaction(async (tx) => {
      const job = await tx.platformJobControl.findUnique({ where: { jobKey: key } });
      if (!job) throw notFound();
      await tx.platformJobControl.update({
        where: { jobKey: key },
        data: { enabled, pausedReason: enabled ? null : (reason ?? null) },
      });
      if (job.enabled !== enabled)
        await writeAdminEvent(tx, adminUserId, {
          action: enabled ? 'system_settings.job_resumed' : 'system_settings.job_paused',
          entityType: 'platform_job_control',
          entityId: key,
          category: 'SYSTEM',
          severity: 'MEDIUM',
          targetLabel: job.name,
        });
      return tx.platformJobControl.findUniqueOrThrow({ where: { jobKey: key } });
    });
    return (await this.jobViews([row]))[0]!;
  }

  // ---------- Defaults ----------

  private async currentSet(tx: TxClient, kind: 'FIRM' | 'USER') {
    const row = await tx.platformDefaultSet.findFirst({
      where: { kind },
      orderBy: { version: 'desc' },
    });
    if (!row)
      throw new Error(
        `platform_default_sets has no ${kind} set (the B7 migration seeds version 1)`,
      );
    return row;
  }

  async firmDefaults(): Promise<AdminFirmDefaultSet> {
    const row = await this.currentSet(this.admin.db as unknown as TxClient, 'FIRM');
    const names = await this.names([row.createdByUserId]);
    return {
      id: row.id,
      version: row.version,
      values: firmDefaultsOf(row.values),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
    };
  }

  async userDefaults(): Promise<AdminUserDefaultSet> {
    const row = await this.currentSet(this.admin.db as unknown as TxClient, 'USER');
    const names = await this.names([row.createdByUserId]);
    return {
      id: row.id,
      version: row.version,
      values: userDefaultsOf(row.values),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
    };
  }

  /** A new version of the set; a feature switched off for the platform or an unknown plan is refused. */
  async saveDefaults(
    kind: 'FIRM' | 'USER',
    body: Out<typeof SaveAdminFirmDefaultsRequest> | Out<typeof SaveAdminUserDefaultsRequest>,
  ): Promise<void> {
    const adminUserId = this.admin.adminUserId;
    try {
      await this.admin.transaction(async (tx) => {
        const current = await this.currentSet(tx, kind);
        if (current.version !== body.basedOnVersion) throw saveConflict();
        if (kind === 'FIRM') {
          const v = body.values as AdminFirmDefaults;
          if (v.features.length) {
            const found = await tx.platformFeature.findMany({
              where: { key: { in: v.features } },
              select: { key: true, emergencyDisabled: true },
            });
            const off = v.features.filter(
              (k) => !found.some((f) => f.key === k && !f.emergencyDisabled),
            );
            if (off.length)
              throw conflict('FEATURE_DEPENDENCY', `Not available to turn on: ${off.join(', ')}`);
          }
          if (
            v.planCode &&
            !(await tx.platformPlan.findFirst({
              where: { code: v.planCode, isActive: true },
              select: { id: true },
            }))
          )
            throw new BadRequestException({
              code: 'VALIDATION_FAILED',
              message: 'Choose an active plan',
              details: [{ path: 'values.planCode', message: 'No active plan has this code' }],
            });
        }
        const values = {
          ...(body.values as Json),
          regional: {
            timeZone: body.values.timeZone,
            locale: 'locale' in body.values ? body.values.locale : null,
          },
        };
        const set = await tx.platformDefaultSet.create({
          data: {
            kind,
            version: 0,
            values: values as object,
            note: body.note ?? null,
            createdByUserId: adminUserId,
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.defaults_saved',
          entityType: 'platform_default_set',
          entityId: set.id,
          category: 'SYSTEM',
          severity: 'LOW',
          metadata: { kind, fromVersion: body.basedOnVersion },
        });
      });
    } catch (e) {
      rethrowCheck(e);
    }
  }

  async versions(kind: 'FIRM' | 'USER'): Promise<AdminDefaultSetVersions> {
    const rows = await this.admin.db.platformDefaultSet.findMany({
      where: { kind },
      orderBy: { version: 'desc' },
      take: 50,
      include: { _count: { select: { applications: true } } },
    });
    const names = await this.names(rows.map((r) => r.createdByUserId));
    return {
      items: rows.map((r) => ({
        id: r.id,
        version: r.version,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdByUserId ? (names.get(r.createdByUserId) ?? null) : null,
        firms: r._count.applications,
      })),
    };
  }
}
