// Super Admin Audit & Security (R55): the classification of rows written before the normalized
// fields, labels, references, devices, masked changes, and the security policy's mapping.
import { describe, expect, it } from 'vitest';
import { ADMIN_SECURITY_DEFAULTS } from '@firmivra/types';
import {
  diffOf,
  sectionsOf,
  settingsOf,
} from '../../src/admin-audit/admin-security-policy.service.js';
import {
  actionLabel,
  changesOf,
  classify,
  deviceOf,
  referenceOf,
} from '../../src/admin-audit/classify.js';

const bare = (action: string) => ({ action, category: null, severity: null, outcome: null });

describe('classify', () => {
  it.each([
    ['auth.sign_in_failed', 'AUTHENTICATION', 'MEDIUM', 'FAILURE'],
    ['auth.signed_in', 'AUTHENTICATION', 'INFO', 'SUCCESS'],
    ['staff.locked', 'SECURITY', 'HIGH', 'DENIED'],
    ['membership.role_changed', 'AUTHORIZATION', 'HIGH', 'SUCCESS'],
    ['membership.invited', 'AUTHORIZATION', 'MEDIUM', 'SUCCESS'],
    ['integration.connected', 'INTEGRATION', 'LOW', 'SUCCESS'],
    ['clients.exported', 'DATA', 'MEDIUM', 'SUCCESS'],
    ['clients.updated', 'DATA', 'INFO', 'SUCCESS'],
  ])('reads %s as %s, %s, %s', (action, category, severity, outcome) => {
    expect(classify(bare(action))).toEqual({ category, severity, outcome, classified: false });
  });

  it("keeps a row's own fields", () => {
    expect(
      classify({
        action: 'auth.signed_in',
        category: 'SECURITY',
        severity: 'CRITICAL',
        outcome: 'DENIED',
      }),
    ).toEqual({ category: 'SECURITY', severity: 'CRITICAL', outcome: 'DENIED', classified: true });
  });
});

describe('the event view helpers', () => {
  it('labels, references and devices', () => {
    expect(actionLabel('auth.sign_in_failed')).toBe('Sign In Failed');
    expect(actionLabel('policy.changed')).toBe('Changed');
    expect(
      referenceOf('0199b6a0-0000-7000-8000-0000001a2b3c', new Date('2026-10-14T09:12:00Z')),
    ).toBe('EVT-20261014-1A2B3C');
    expect(
      deviceOf(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', os: 'iOS', mobile: true, label: 'Safari / iOS' });
    expect(deviceOf(null).label).toBe('Unknown device');
  });

  it('shows metadata as changes, masking secrets and personal details', () => {
    expect(
      changesOf({
        role: { from: 'STAFF', to: 'ADMIN' },
        email: 'someone@example.test',
        apiToken: 'abc',
        fields: ['name'],
      }),
    ).toEqual([
      { field: 'role', before: 'STAFF', after: 'ADMIN', masked: false },
      { field: 'email', before: null, after: '••••', masked: true },
      { field: 'apiToken', before: null, after: '••••', masked: true },
      { field: 'fields', before: null, after: '["name"]', masked: false },
    ]);
    expect(changesOf(null)).toEqual([]);
  });
});

describe('the security policy mapping', () => {
  const row = {
    version: 1,
    mfa: { requiredFor: 'PLATFORM_ADMINS', roleKeys: [], methods: ['TOTP'] },
    password: {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSymbol: false,
      preventReuseCount: 5,
      rotationDays: null,
    },
    session: {
      idleTimeoutMinutes: 30,
      maxLifetimeHours: 12,
      concurrentSessions: 'ALLOW',
      adminsCanRevokeAll: true,
    },
    loginProtection: {
      maxFailedAttempts: 5,
      lockoutMinutes: 15,
      suspiciousLoginAlerts: true,
      ipAllowList: [],
      ipBlockList: [],
    },
    adminAccess: { reauthForHighRiskChanges: true, reauthWindowMinutes: 10 },
    apiIntegrations: { maskSecrets: true, tokenLifetimeDays: 90 },
    auditRetention: { retentionDays: 2555, archiveAfterDays: 365, editable: false },
    exportControls: { exportRoleKeys: [], requireReauth: true, linkExpiryHours: 24 },
    alertRouting: {
      inApp: true,
      email: true,
      sms: false,
      webhook: false,
      minimumSeverity: 'HIGH',
      recipientRoleKeys: [],
    },
    updatedByUserId: null,
    updatedAt: new Date(),
  };

  it("reads the migration's policy as the page, with defaults for the page's own keys", () => {
    const { settings, editable } = settingsOf(row);
    expect(editable).toBe(false);
    expect(settings).toMatchObject({
      mfa: { scope: 'ADMINS' },
      methods: { authenticatorApp: true, sms: false },
      password: { minLength: 12, expirationDays: 0, preventReuseCount: 5 },
      session: { idleTimeoutMinutes: 30, reauthSensitive: true, reauthWindowMinutes: 10 },
      ip: { mode: 'ANY', allowList: [] },
      retention: { retentionDays: 2555, archiveAfterDays: 365 },
    });
  });

  it('writes the page back, keeping what it does not manage, and reads the same again', () => {
    const changed = structuredClone(ADMIN_SECURITY_DEFAULTS);
    changed.mfa.scope = 'ALL';
    changed.password.expirationDays = 90;
    changed.ip = { mode: 'BLOCK_LIST', allowList: [], blockList: ['198.51.100.0/24'] };
    const sections = sectionsOf(row, changed);
    expect(sections.mfa).toEqual({ requiredFor: 'ALL_USERS', roleKeys: [], methods: ['TOTP'] });
    expect(sections.password.rotationDays).toBe(90);
    expect(sections.session).toMatchObject({
      concurrentSessions: 'ALLOW',
      adminsCanRevokeAll: true,
    });
    expect(sections.alertRouting).toMatchObject({
      inApp: true,
      webhook: false,
      recipientRoleKeys: [],
    });
    expect(settingsOf({ ...row, ...sections }).settings).toEqual(changed);
  });

  it('lists the changed fields with old and new values', () => {
    const after = structuredClone(ADMIN_SECURITY_DEFAULTS);
    after.password.minLength = 14;
    after.ip.allowList = ['203.0.113.7'];
    expect(diffOf(ADMIN_SECURITY_DEFAULTS, after)).toEqual({
      'password.minLength': { from: 12, to: 14 },
      'ip.allowList': { changed: true, count: 1 },
    });
  });
});
