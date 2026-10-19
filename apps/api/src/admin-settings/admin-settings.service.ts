import { createRequire } from 'node:module';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import type {
  AdminEmailSection,
  AdminGeneralSection,
  AdminSecretRef,
  AdminSecretRefList,
  AdminSettingsCategory,
  AdminSettingsOverview,
  AdminTestEmailResult,
  SaveAdminEmailRequest,
  SaveAdminGeneralRequest,
  SetAdminSecretRefRequest,
} from '@firmivra/types';
import { createTransport } from 'nodemailer';
import type { z } from 'zod';
import { conflict, writeAdminEvent } from '../admin-audit/admin-audit.common.js';
import { PlatformPrisma } from '../database/database.module.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import type { NotifyConfig } from '../notify/config.js';
import { AWS_CLIENT } from '../notify/notify.service.js';
import {
  type EmailTransport,
  SesEmailTransport,
  SmtpEmailTransport,
} from '../notify/transports.js';
import { notFound } from '../workspaces/common.js';
import { changedFields, emailOf, emailValue, generalOf, generalValue } from './settings.mappers.js';

type Out<S extends z.ZodType> = z.output<S>;
type Section = 'general' | 'branding' | 'email_notifications';

const pkg = createRequire(import.meta.url)('../../package.json') as { version?: string };

export const saveConflict = () =>
  conflict(
    'SAVE_CONFLICT',
    'Someone saved these settings after you opened them. Reload and apply your changes again.',
  );

/** The database's floors (a CHECK) as 400, never a 500. */
export function rethrowCheck(e: unknown): never {
  if (databaseErrorCode(e) === '23514')
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Some of the values are not allowed',
    });
  throw e;
}

/**
 * Super Admin System Settings (R55; contract in packages/types/src/admin-settings): the landing,
 * the versioned sections (`platform_settings`), the test email and secret references. Admin scope
 * only: the database stamps who saved and bumps versions. Every change writes a SYSTEM audit row
 * (SECURITY for secrets) with field names, never a secret.
 */
@Injectable()
export class AdminSettingsService {
  private readonly logger = new Logger(AdminSettingsService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly platform: PlatformPrisma,
    @Inject(NOTIFY_CONFIG) private readonly notify: NotifyConfig,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Super Admins' and other users' names (platform tables, read for a Super Admin). */
  async names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return new Map();
    const rows = await this.platform.db.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  // ---------- The landing ----------

  async overview(): Promise<AdminSettingsOverview> {
    return this.admin.transaction(async (tx) => {
      const newest = <T extends { updatedAt: Date; updatedByUserId: string | null }>(rows: T[]) =>
        rows.reduce<T | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);
      const [sections, brand, features, retention, policy, jobs, windows, defaults, firms, recent] =
        await Promise.all([
          tx.platformSetting.findMany({
            select: { key: true, updatedAt: true, updatedByUserId: true },
          }),
          tx.platformBrandCurrent.findMany({ select: { updatedAt: true, updatedByUserId: true } }),
          tx.platformFeature.findMany({ select: { updatedAt: true, updatedByUserId: true } }),
          tx.platformRetentionPolicy.findMany({
            select: { updatedAt: true, updatedByUserId: true },
          }),
          tx.platformSecurityPolicy.findMany({
            select: { updatedAt: true, updatedByUserId: true },
          }),
          tx.platformJobControl.findMany({ select: { updatedAt: true, updatedByUserId: true } }),
          tx.platformMaintenanceWindow.findMany({
            select: {
              id: true,
              title: true,
              status: true,
              startsAt: true,
              endsAt: true,
              updatedAt: true,
              updatedByUserId: true,
            },
          }),
          tx.platformDefaultSet.findMany({ select: { createdAt: true, createdByUserId: true } }),
          tx.business.count(),
          tx.auditLog.findMany({
            where: {
              businessId: null,
              OR: [{ action: { startsWith: 'system_settings.' } }, { action: 'policy.changed' }],
            },
            select: { id: true, action: true, actorUserId: true, actorName: true, createdAt: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 6,
          }),
        ]);
      const sectionOf = (key: Section) => sections.filter((s) => s.key === key);
      const last: Record<
        AdminSettingsCategory,
        { updatedAt: Date; updatedByUserId: string | null } | null
      > = {
        GENERAL: newest(sectionOf('general')),
        BRANDING: newest([...sectionOf('branding'), ...brand]),
        EMAIL: newest(sectionOf('email_notifications')),
        FEATURES: newest(features),
        RETENTION: newest(retention),
        SECURITY: newest(policy),
        SYSTEM: newest(jobs),
        MAINTENANCE: newest(windows),
        DEFAULTS: newest(
          defaults.map((d) => ({ updatedAt: d.createdAt, updatedByUserId: d.createdByUserId })),
        ),
      };
      const names = await this.names([
        ...Object.values(last).map((l) => l?.updatedByUserId),
        ...recent.filter((r) => !r.actorName).map((r) => r.actorUserId),
      ]);
      const totalUsers = await this.platform.db.user.count({
        where: { pool: { in: ['STAFF', 'CLIENT'] } },
      });
      const all = Object.values(last).filter((l): l is NonNullable<typeof l> => !!l);
      const now = new Date();
      const window =
        windows.find((w) => w.status === 'ACTIVE') ??
        windows
          .filter((w) => w.status === 'SCHEDULED' && w.endsAt > now)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ??
        null;
      return {
        categories: (Object.keys(last) as AdminSettingsCategory[]).map((key) => ({
          key,
          lastChangedAt: last[key]?.updatedAt.toISOString() ?? null,
          lastChangedBy: last[key]?.updatedByUserId
            ? (names.get(last[key].updatedByUserId) ?? null)
            : null,
        })),
        system: {
          version: process.env.APP_VERSION ?? pkg.version ?? '0.0.0',
          environment:
            process.env.APP_ENV ??
            (this.env.NODE_ENV === 'production'
              ? 'Production'
              : this.env.NODE_ENV === 'test'
                ? 'Test'
                : 'Development'),
          totalFirms: firms,
          totalUsers,
          lastUpdatedAt: all.length ? newest(all)!.updatedAt.toISOString() : null,
        },
        maintenance: window
          ? {
              id: window.id,
              title: window.title,
              status: window.status,
              startsAt: window.startsAt.toISOString(),
              endsAt: window.endsAt.toISOString(),
            }
          : null,
        recentChanges: recent.map((r) => ({
          eventId: r.id,
          label: recentLabel(r.action),
          by: r.actorName ?? (r.actorUserId ? (names.get(r.actorUserId) ?? null) : null),
          at: r.createdAt.toISOString(),
        })),
      };
    });
  }

  // ---------- Sections ----------

  async section(tx: TxClient, key: Section) {
    const row = await tx.platformSetting.findUnique({ where: { key } });
    if (!row) throw new Error(`platform_settings has no '${key}' row (the B7 migration seeds it)`);
    return row;
  }

  private async sectionOut<T>(key: Section, read: (v: unknown) => T) {
    const row = await this.section(this.admin.db as unknown as TxClient, key);
    const names = await this.names([row.updatedByUserId]);
    return {
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedByUserId ? (names.get(row.updatedByUserId) ?? null) : null,
      value: read(row.value),
    };
  }

  /** Saves one section with its version, and writes the audit row with the changed fields. */
  async saveSection(
    key: Section,
    version: number,
    value: (old: unknown) => Record<string, unknown>,
  ) {
    const adminUserId = this.admin.adminUserId;
    try {
      await this.admin.transaction(async (tx) => {
        const row = await this.section(tx, key);
        if (row.version !== version) throw saveConflict();
        const next = value(row.value);
        const { count } = await tx.platformSetting.updateMany({
          where: { key, version },
          data: { value: next as object },
        });
        if (count !== 1) throw saveConflict();
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.section_saved',
          entityType: 'platform_setting',
          entityId: key,
          category: 'SYSTEM',
          severity: 'LOW',
          targetLabel: `System Settings: ${key}`,
          metadata: {
            fromVersion: version,
            changes: changedFields(row.value as Record<string, unknown>, next),
          },
        });
      });
    } catch (e) {
      rethrowCheck(e);
    }
  }

  general(): Promise<AdminGeneralSection> {
    return this.sectionOut('general', generalOf);
  }

  async saveGeneral(body: Out<typeof SaveAdminGeneralRequest>): Promise<AdminGeneralSection> {
    await this.saveSection('general', body.version, (old) => generalValue(old, body.value));
    return this.general();
  }

  async email(): Promise<AdminEmailSection> {
    const [section, smtp] = await Promise.all([
      this.sectionOut('email_notifications', emailOf),
      this.admin.db.platformSecretRef.findUnique({ where: { key: 'smtp' }, select: { key: true } }),
    ]);
    return { ...section, smtpConfigured: !!smtp };
  }

  async saveEmail(body: Out<typeof SaveAdminEmailRequest>): Promise<AdminEmailSection> {
    await this.saveSection('email_notifications', body.version, (old) =>
      emailValue(old, body.value),
    );
    return this.email();
  }

  /** Send Test Email through the configured sender: the provider's answer; nothing is saved. */
  async testEmail(to: string): Promise<AdminTestEmailResult> {
    const adminUserId = this.admin.adminUserId;
    const config = this.notify.email;
    // No sender in development and tests (EMAIL_MODE=log): answered, not failed.
    if (config.mode === 'log')
      return { accepted: false, detail: 'No email sender is configured (EMAIL_MODE is log)' };
    const transport: EmailTransport =
      config.mode === 'ses'
        ? new SesEmailTransport(new SESv2Client(AWS_CLIENT))
        : new SmtpEmailTransport(
            createTransport({
              host: config.host,
              port: config.port,
              secure: false,
              ignoreTLS: true,
              connectionTimeout: 5_000,
            }),
          );
    const settings = emailOf(
      (await this.section(this.admin.db as unknown as TxClient, 'email_notifications')).value,
    );
    let result: AdminTestEmailResult;
    try {
      await transport.send({
        from: { name: settings.fromName, address: config.from.address },
        to,
        replyTo: settings.replyTo,
        subject: 'Firmivra test email',
        text: 'This is a test email from Firmivra System Settings. No action is needed.',
        html: '<p>This is a test email from Firmivra System Settings. No action is needed.</p>',
      });
      result = { accepted: true, detail: null };
    } catch (e) {
      this.logger.warn(`Test email failed: ${(e as Error).name}`);
      result = { accepted: false, detail: (e as Error).name };
    }
    await this.admin.transaction((tx) =>
      writeAdminEvent(tx, adminUserId, {
        action: 'system_settings.email_test_sent',
        entityType: 'platform_setting',
        entityId: 'email_notifications',
        category: 'SYSTEM',
        severity: 'INFO',
        outcome: result.accepted ? 'SUCCESS' : 'FAILURE',
        metadata: { accepted: result.accepted },
      }),
    );
    return result;
  }

  // ---------- Secrets (references only) ----------

  private async secretOut(
    rows: {
      key: string;
      hint: string | null;
      rotatedAt: Date | null;
      updatedAt: Date;
      updatedByUserId: string | null;
    }[],
  ): Promise<AdminSecretRef[]> {
    const names = await this.names(rows.map((r) => r.updatedByUserId));
    return rows.map((r) => ({
      key: r.key,
      hint: r.hint,
      configured: true as const,
      rotatedAt: r.rotatedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedByUserId ? (names.get(r.updatedByUserId) ?? null) : null,
    }));
  }

  async secrets(): Promise<AdminSecretRefList> {
    const rows = await this.admin.db.platformSecretRef.findMany({
      select: { key: true, hint: true, rotatedAt: true, updatedAt: true, updatedByUserId: true },
      orderBy: { key: 'asc' },
    });
    return { items: await this.secretOut(rows) };
  }

  async setSecret(
    key: string,
    body: Out<typeof SetAdminSecretRefRequest>,
  ): Promise<AdminSecretRef> {
    const adminUserId = this.admin.adminUserId;
    try {
      const row = await this.admin.transaction(async (tx) => {
        const existed = await tx.platformSecretRef.findUnique({
          where: { key },
          select: { key: true },
        });
        const saved = await tx.platformSecretRef.upsert({
          where: { key },
          create: { key, reference: body.reference, hint: body.hint ?? null },
          update: { reference: body.reference, hint: body.hint ?? null },
          select: {
            key: true,
            hint: true,
            rotatedAt: true,
            updatedAt: true,
            updatedByUserId: true,
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: existed ? 'system_settings.secret_rotated' : 'system_settings.secret_set',
          entityType: 'platform_secret_ref',
          entityId: key,
          category: 'SECURITY',
          severity: 'HIGH',
          targetLabel: `Secret: ${key}`,
          metadata: { hintGiven: !!body.hint },
        });
        return saved;
      });
      return (await this.secretOut([row]))[0]!;
    } catch (e) {
      rethrowCheck(e);
    }
  }

  async removeSecret(key: string): Promise<{ ok: true }> {
    const adminUserId = this.admin.adminUserId;
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformSecretRef.deleteMany({ where: { key } });
      if (!count) throw notFound();
      await writeAdminEvent(tx, adminUserId, {
        action: 'system_settings.secret_removed',
        entityType: 'platform_secret_ref',
        entityId: key,
        category: 'SECURITY',
        severity: 'HIGH',
        targetLabel: `Secret: ${key}`,
      });
    });
    return { ok: true };
  }
}

/** Recent Changes' words for an audit action. */
function recentLabel(action: string): string {
  if (action === 'policy.changed') return 'Security settings updated';
  const what = action.replace(/^system_settings\./, '').replace(/_/g, ' ');
  return what.charAt(0).toUpperCase() + what.slice(1);
}
