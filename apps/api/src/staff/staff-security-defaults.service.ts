import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { StaffAccessLocation, StaffAuthMethod, StaffSecurityDefaults } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { SaveStaffSecurityDefaultsBody } from './staff-input.js';
import { mapStaffDbError, requireManager, type StaffActor, staffConflict } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The settings a new account's staff_security_settings row starts with. */
export interface NewAccountSecurity {
  allowedAuthMethods: StaffAuthMethod[];
  accessLocation: StaffAccessLocation;
  allowedIps: string[];
  allowedCountries: string[];
  restrictDevices: boolean;
  autoLogoutMinutes: number | null;
  maxConcurrentSessions: number;
  signOutOtherSessions: boolean;
  allowTrustedDevices: boolean;
  notifyNewDeviceLogin: boolean;
  notifyFailedLogins: boolean;
  notifyPasswordChanges: boolean;
  notifySecurityAlerts: boolean;
  notifyLockouts: boolean;
}

/**
 * Firmivra's defaults, for a firm that never saved its own: the column defaults of
 * staff_security_defaults and staff_security_settings (an e2e test compares them).
 */
const FIRMIVRA: NewAccountSecurity = {
  allowedAuthMethods: ['AUTHENTICATOR_APP', 'BACKUP_CODES'],
  accessLocation: 'ANYWHERE',
  allowedIps: [],
  allowedCountries: [],
  restrictDevices: false,
  autoLogoutMinutes: null,
  maxConcurrentSessions: 1,
  signOutOtherSessions: false,
  allowTrustedDevices: false,
  notifyNewDeviceLogin: true,
  notifyFailedLogins: true,
  notifyPasswordChanges: true,
  notifySecurityAlerts: true,
  notifyLockouts: true,
};

const FIELDS = Object.keys(FIRMIVRA) as (keyof NewAccountSecurity)[];

const SETTINGS = {
  allowedAuthMethods: true,
  accessLocation: true,
  allowedIps: true,
  allowedCountries: true,
  restrictDevices: true,
  autoLogoutMinutes: true,
  maxConcurrentSessions: true,
  signOutOtherSessions: true,
  allowTrustedDevices: true,
  notifyNewDeviceLogin: true,
  notifyFailedLogins: true,
  notifyPasswordChanges: true,
  notifySecurityAlerts: true,
  notifyLockouts: true,
} as const satisfies Record<keyof NewAccountSecurity, true>;

const ROW = {
  ...SETTINGS,
  updatedAt: true,
  updatedBy: { select: { user: { select: { name: true } } } },
} as const;

type Row = NewAccountSecurity & { updatedAt: Date; updatedBy: { user: { name: string } } | null };

const pick = (r: NewAccountSecurity): NewAccountSecurity => {
  const out = { ...FIRMIVRA };
  for (const f of FIELDS) (out as Record<string, unknown>)[f] = r[f];
  return out;
};

/** The firm's defaults for a new staff account, read in the caller's transaction. */
export async function newAccountSecurity(
  tx: TxClient,
  businessId: string,
): Promise<NewAccountSecurity> {
  const row = await tx.staffSecurityDefaults.findUnique({
    where: { businessId },
    select: SETTINGS,
  });
  return row ? pick(row) : { ...FIRMIVRA };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Staff Settings > New Accounts & Security (Octavia's SM3): the security settings every new staff
 * account starts from, one row per firm (staff_security_defaults). Owner and Admin read and save;
 * a save changes no existing account. The audit row names the changed settings, never a value.
 */
@Injectable()
export class StaffSecurityDefaultsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(actor: StaffActor, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: actor.businessId }, fn);
  }

  private async view(tx: TxClient, businessId: string, row: Row | null) {
    const s = row ? pick(row) : FIRMIVRA;
    const existingAccounts = await tx.membership.count({ where: { businessId } });
    const out: StaffSecurityDefaults = {
      allowedAuthMethods: s.allowedAuthMethods,
      restrictDevices: s.restrictDevices,
      autoLogoutMinutes: s.autoLogoutMinutes,
      accessLocation: s.accessLocation,
      allowedIps: s.allowedIps,
      allowedCountries: s.allowedCountries,
      maxConcurrentSessions: s.maxConcurrentSessions,
      signOutOtherSessions: s.signOutOtherSessions,
      allowTrustedDevices: s.allowTrustedDevices,
      notices: {
        newDeviceLogin: s.notifyNewDeviceLogin,
        failedLogins: s.notifyFailedLogins,
        passwordChanges: s.notifyPasswordChanges,
        securityAlerts: s.notifySecurityAlerts,
        lockouts: s.notifyLockouts,
      },
      existingAccounts,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy?.user.name ?? null,
      version: row?.updatedAt.toISOString() ?? 'none',
    };
    return out;
  }

  private row(tx: TxClient, businessId: string): Promise<Row | null> {
    return tx.staffSecurityDefaults.findUnique({ where: { businessId }, select: ROW });
  }

  get(actor: StaffActor): Promise<StaffSecurityDefaults> {
    return this.inFirm(actor, async (tx) =>
      this.view(tx, actor.businessId, await this.row(tx, actor.businessId)),
    );
  }

  async save(
    actor: StaffActor,
    body: Out<typeof SaveStaffSecurityDefaultsBody>,
  ): Promise<StaffSecurityDefaults> {
    const { businessId } = actor;
    try {
      return await this.inFirm(actor, async (tx) => {
        await requireManager(tx, actor);
        // One save at a time per firm, the first one (no row to lock yet) included.
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`staff_security_defaults:${businessId}`}))) AS l`;
        const current = await this.row(tx, businessId);
        if ((current?.updatedAt.toISOString() ?? 'none') !== body.version)
          throw staffConflict(
            'SAVE_CONFLICT',
            'Someone saved these defaults after you opened them. Reload and apply your changes again.',
          );
        const data: NewAccountSecurity = {
          allowedAuthMethods: body.allowedAuthMethods,
          accessLocation: body.accessLocation,
          allowedIps: body.allowedIps,
          allowedCountries: body.allowedCountries,
          restrictDevices: body.restrictDevices,
          autoLogoutMinutes: body.autoLogoutMinutes,
          maxConcurrentSessions: body.maxConcurrentSessions,
          signOutOtherSessions: body.signOutOtherSessions,
          allowTrustedDevices: body.allowTrustedDevices,
          notifyNewDeviceLogin: body.notices.newDeviceLogin,
          notifyFailedLogins: body.notices.failedLogins,
          notifyPasswordChanges: body.notices.passwordChanges,
          notifySecurityAlerts: body.notices.securityAlerts,
          notifyLockouts: body.notices.lockouts,
        };
        const before = current ? pick(current) : FIRMIVRA;
        const changed = FIELDS.filter((f) => !same(before[f], data[f]));
        const saved = await tx.staffSecurityDefaults.upsert({
          where: { businessId },
          create: { ...data, businessId, updatedByUserId: actor.userId },
          update: { ...data, updatedByUserId: actor.userId },
          select: ROW,
        });
        await this.audit.logIn(
          tx,
          'staff_security_defaults.updated',
          { type: 'staff_security_defaults', id: businessId },
          { changed },
          { businessId },
        );
        return this.view(tx, businessId, saved);
      });
    } catch (e) {
      throw mapStaffDbError(e);
    }
  }
}
