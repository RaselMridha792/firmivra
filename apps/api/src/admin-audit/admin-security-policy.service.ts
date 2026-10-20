import { BadRequestException, Injectable } from '@nestjs/common';
import { databaseErrorCode } from '@firmivra/db';
import {
  ADMIN_SECURITY_DEFAULTS,
  type AdminSecuritySettings,
  type AdminSecuritySettingsRecord,
  type SaveAdminSecuritySettingsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminAuditService } from './admin-audit.service.js';
import { conflict, writeAdminEvent } from './admin-audit.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Json = Record<string, unknown>;
type PolicyRow = {
  version: number;
  mfa: unknown;
  password: unknown;
  session: unknown;
  loginProtection: unknown;
  adminAccess: unknown;
  apiIntegrations: unknown;
  auditRetention: unknown;
  exportControls: unknown;
  alertRouting: unknown;
  updatedByUserId: string | null;
  updatedAt: Date;
};

const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const METHOD_KEYS = {
  authenticatorApp: 'TOTP',
  sms: 'SMS',
  email: 'EMAIL',
  hardwareKey: 'WEBAUTHN',
} as const;
const EXPIRATIONS = [0, 30, 60, 90, 180, 365] as const;
const D = ADMIN_SECURITY_DEFAULTS;

/** The page's settings from the policy's nine sections (missing keys: Firmivra's defaults). */
export function settingsOf(p: PolicyRow): { settings: AdminSecuritySettings; editable: boolean } {
  const mfa = obj(p.mfa);
  const password = obj(p.password);
  const session = obj(p.session);
  const login = obj(p.loginProtection);
  const access = obj(p.adminAccess);
  const retention = obj(p.auditRetention);
  const exportsJ = obj(p.exportControls);
  const routing = obj(p.alertRouting);
  const methods = strings(mfa.methods);
  const rotation = num(password.rotationDays, 0);
  const events = obj(routing.events);
  const severity = routing.minimumSeverity;
  return {
    editable: bool(retention.editable, false),
    settings: {
      mfa: { scope: mfa.requiredFor === 'ALL_USERS' ? 'ALL' : 'ADMINS' },
      methods: {
        authenticatorApp: methods.length ? methods.includes('TOTP') : true,
        sms: methods.includes('SMS'),
        email: methods.includes('EMAIL'),
        hardwareKey: methods.includes('WEBAUTHN'),
      },
      password: {
        minLength: num(password.minLength, D.password.minLength),
        uppercase: bool(password.requireUppercase, D.password.uppercase),
        lowercase: bool(password.requireLowercase, D.password.lowercase),
        numbers: bool(password.requireNumber, D.password.numbers),
        special: bool(password.requireSymbol, D.password.special),
        expirationDays: (EXPIRATIONS as readonly number[]).includes(rotation)
          ? (rotation as AdminSecuritySettings['password']['expirationDays'])
          : 0,
        preventReuseCount: num(password.preventReuseCount, D.password.preventReuseCount),
      },
      session: {
        idleTimeoutMinutes: num(session.idleTimeoutMinutes, D.session.idleTimeoutMinutes),
        maxLifetimeHours: num(session.maxLifetimeHours, D.session.maxLifetimeHours),
        rememberMeDays: num(session.rememberMeDays, D.session.rememberMeDays),
        concurrentSessions: num(session.concurrentLimit, D.session.concurrentSessions),
        selfManage: bool(session.selfManage, D.session.selfManage),
        reauthSensitive: bool(access.reauthForHighRiskChanges, D.session.reauthSensitive),
        reauthWindowMinutes: num(access.reauthWindowMinutes, D.session.reauthWindowMinutes),
        reauthDeviceSwitch: bool(session.reauthDeviceSwitch, D.session.reauthDeviceSwitch),
      },
      protection: {
        maxFailedAttempts: num(login.maxFailedAttempts, D.protection.maxFailedAttempts),
        lockoutMinutes: num(login.lockoutMinutes, D.protection.lockoutMinutes),
        notifySuspicious: bool(login.suspiciousLoginAlerts, D.protection.notifySuspicious),
        autoLock: bool(login.autoLock, D.protection.autoLock),
        emailAdminOnLockout: bool(login.emailAdminOnLockout, D.protection.emailAdminOnLockout),
        verifyNewDevices: bool(login.verifyNewDevices, D.protection.verifyNewDevices),
      },
      ip: {
        mode: login.ipMode === 'ALLOW_LIST' || login.ipMode === 'BLOCK_LIST' ? login.ipMode : 'ANY',
        allowList: strings(login.ipAllowList),
        blockList: strings(login.ipBlockList),
      },
      notifications: {
        failedLogins: bool(events.failedLogins, true),
        newDevice: bool(events.newDevice, true),
        passwordChanges: bool(events.passwordChanges, true),
        mfaDisabled: bool(events.mfaDisabled, true),
        accountLocked: bool(events.accountLocked, true),
        suspicious: bool(events.suspicious, true),
        email: bool(routing.email, D.notifications.email),
        sms: bool(routing.sms, D.notifications.sms),
        minimumSeverity:
          severity === 'LOW' ||
          severity === 'MEDIUM' ||
          severity === 'HIGH' ||
          severity === 'CRITICAL'
            ? severity
            : D.notifications.minimumSeverity,
      },
      retention: {
        retentionDays: num(retention.retentionDays, D.retention.retentionDays),
        archiveAfterDays: num(retention.archiveAfterDays, D.retention.archiveAfterDays),
      },
      exports: {
        roles: strings(exportsJ.exportRoleKeys).filter(
          (r): r is AdminSecuritySettings['exports']['roles'][number] =>
            r === 'SUPER_ADMINS' || r === 'SECURITY_ADMINS' || r === 'AUDITORS',
        ),
        requireReauth: bool(exportsJ.requireReauth, D.exports.requireReauth),
        linkExpiryHours: num(exportsJ.linkExpiryHours, D.exports.linkExpiryHours),
      },
    },
  };
}

/** The settings written over the policy's sections, keeping the keys this page does not manage. */
export function sectionsOf(p: PolicyRow, s: AdminSecuritySettings) {
  const methods = (Object.keys(METHOD_KEYS) as (keyof typeof METHOD_KEYS)[])
    .filter((k) => s.methods[k])
    .map((k) => METHOD_KEYS[k]);
  return {
    mfa: {
      ...obj(p.mfa),
      requiredFor: s.mfa.scope === 'ALL' ? 'ALL_USERS' : 'PLATFORM_ADMINS',
      methods,
    },
    password: {
      ...obj(p.password),
      minLength: s.password.minLength,
      requireUppercase: s.password.uppercase,
      requireLowercase: s.password.lowercase,
      requireNumber: s.password.numbers,
      requireSymbol: s.password.special,
      rotationDays: s.password.expirationDays || null,
      preventReuseCount: s.password.preventReuseCount,
    },
    session: {
      ...obj(p.session),
      idleTimeoutMinutes: s.session.idleTimeoutMinutes,
      maxLifetimeHours: s.session.maxLifetimeHours,
      rememberMeDays: s.session.rememberMeDays,
      concurrentLimit: s.session.concurrentSessions,
      selfManage: s.session.selfManage,
      reauthDeviceSwitch: s.session.reauthDeviceSwitch,
    },
    loginProtection: {
      ...obj(p.loginProtection),
      maxFailedAttempts: s.protection.maxFailedAttempts,
      lockoutMinutes: s.protection.lockoutMinutes,
      suspiciousLoginAlerts: s.protection.notifySuspicious,
      autoLock: s.protection.autoLock,
      emailAdminOnLockout: s.protection.emailAdminOnLockout,
      verifyNewDevices: s.protection.verifyNewDevices,
      ipMode: s.ip.mode,
      ipAllowList: s.ip.allowList,
      ipBlockList: s.ip.blockList,
    },
    adminAccess: {
      ...obj(p.adminAccess),
      reauthForHighRiskChanges: s.session.reauthSensitive,
      reauthWindowMinutes: s.session.reauthWindowMinutes,
    },
    auditRetention: {
      ...obj(p.auditRetention),
      retentionDays: s.retention.retentionDays,
      archiveAfterDays: s.retention.archiveAfterDays,
    },
    exportControls: {
      ...obj(p.exportControls),
      exportRoleKeys: s.exports.roles,
      requireReauth: s.exports.requireReauth,
      linkExpiryHours: s.exports.linkExpiryHours,
    },
    alertRouting: {
      ...obj(p.alertRouting),
      inApp: true,
      email: s.notifications.email,
      sms: s.notifications.sms,
      minimumSeverity: s.notifications.minimumSeverity,
      events: {
        failedLogins: s.notifications.failedLogins,
        newDevice: s.notifications.newDevice,
        passwordChanges: s.notifications.passwordChanges,
        mfaDisabled: s.notifications.mfaDisabled,
        accountLocked: s.notifications.accountLocked,
        suspicious: s.notifications.suspicious,
      },
    },
  };
}

/** The settings' leaves that changed, as dotted paths with their old and new values. */
export function diffOf(before: AdminSecuritySettings, after: AdminSecuritySettings) {
  const out: Record<string, unknown> = {};
  for (const [section, values] of Object.entries(after) as [string, Json][]) {
    const old = (before as unknown as Record<string, Json>)[section] ?? {};
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(old[key]) === JSON.stringify(value)) continue;
      out[`${section}.${key}`] = Array.isArray(value)
        ? { changed: true, count: value.length }
        : { from: old[key] ?? null, to: value };
    }
  }
  return out;
}

/**
 * The platform security policy (R0 stage B4: one row, nine JSON sections, the database bumps its
 * version) as the Security Settings page (R55). A save names the version it started from (409
 * SAVE_CONFLICT otherwise), lands atomically and writes `policy.changed` (SECURITY, HIGH) with the
 * changed fields. Audit retention changes only where the policy says it is editable.
 */
@Injectable()
export class AdminSecurityPolicyService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly events: AdminAuditService,
  ) {}

  private async record(p: PolicyRow): Promise<AdminSecuritySettingsRecord> {
    const { settings, editable } = settingsOf(p);
    const names = await this.events.adminNames([p.updatedByUserId]);
    return {
      version: p.version,
      updatedAt: p.updatedAt.toISOString(),
      updatedBy: p.updatedByUserId ? (names.get(p.updatedByUserId) ?? 'Super Admin') : null,
      retentionEditable: editable,
      settings,
    };
  }

  async get(): Promise<AdminSecuritySettingsRecord> {
    const p = await this.admin.db.platformSecurityPolicy.findUnique({ where: { id: 1 } });
    if (!p) throw new Error('platform_security_policy has no row (the B4 migration seeds it)');
    return this.record(p);
  }

  async save(
    body: Out<typeof SaveAdminSecuritySettingsRequest>,
  ): Promise<AdminSecuritySettingsRecord> {
    const adminUserId = this.admin.adminUserId;
    try {
      await this.admin.transaction(async (tx) => {
        const p = await tx.platformSecurityPolicy.findUnique({ where: { id: 1 } });
        if (!p) throw new Error('platform_security_policy has no row');
        if (p.version !== body.version) throw this.stale();
        const { settings: before, editable } = settingsOf(p);
        if (
          !editable &&
          JSON.stringify(before.retention) !== JSON.stringify(body.settings.retention)
        )
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Audit retention is fixed by policy',
            details: [
              { path: 'settings.retention', message: 'Audit retention cannot change here' },
            ],
          });
        const changes = diffOf(before, body.settings);
        const { count } = await tx.platformSecurityPolicy.updateMany({
          where: { id: 1, version: body.version },
          data: sectionsOf(p, body.settings) as never,
        });
        if (count !== 1) throw this.stale();
        await writeAdminEvent(tx, adminUserId, {
          action: 'policy.changed',
          entityType: 'platform_security_policy',
          entityId: '1',
          category: 'SECURITY',
          severity: 'HIGH',
          targetLabel: 'Security Settings',
          metadata: { fromVersion: body.version, changes },
        });
      });
    } catch (e) {
      if (databaseErrorCode(e) === '23514')
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Some of the values are below the platform floors',
        });
      throw e;
    }
    return this.get();
  }

  private stale() {
    return conflict(
      'SAVE_CONFLICT',
      'Someone saved the security settings after you opened them. Reload and apply your changes again.',
    );
  }
}
