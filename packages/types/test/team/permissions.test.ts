import { describe, expect, it } from 'vitest';
import {
  capabilityOfMethod,
  DEFAULT_ROLE_PERMISSIONS,
  FIRM_ROLES,
  GRID_FIRM_ROLES,
  PermissionCapability,
  PermissionModule,
  roleCan,
  SENSITIVE_MODULES,
} from '../../src/index.js';

describe('the default permission grid', () => {
  it('covers all eight roles and the 24 modules of the designs', () => {
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual([...FIRM_ROLES].sort());
    expect(PermissionModule.options).toHaveLength(24);
    expect(PermissionCapability.options).toEqual([
      'VIEW',
      'CREATE',
      'EDIT',
      'DELETE',
      'APPROVE',
      'MANAGE',
      'EXPORT',
    ]);
  });

  it('gives Owner and Admin everything', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      for (const m of PermissionModule.options) {
        for (const c of PermissionCapability.options) expect(roleCan(role, m, c)).toBe(true);
      }
    }
  });

  it('never gives the five newer roles Manage, Delete or Approve, or a sensitive module', () => {
    for (const role of GRID_FIRM_ROLES) {
      for (const m of PermissionModule.options) {
        for (const c of ['MANAGE', 'DELETE', 'APPROVE'] as const) {
          expect(roleCan(role, m, c), `${role} ${m} ${c}`).toBe(false);
        }
      }
      for (const m of SENSITIVE_MODULES) expect(DEFAULT_ROLE_PERMISSIONS[role][m]).toBeUndefined();
    }
  });

  it('always holds View with Create, Edit or Export', () => {
    for (const role of FIRM_ROLES) {
      for (const [module, caps] of Object.entries(DEFAULT_ROLE_PERMISSIONS[role])) {
        if (caps.some((c) => c !== 'VIEW')) expect(caps, `${role} ${module}`).toContain('VIEW');
      }
    }
  });

  it('follows the Tax Preparer design where the two screens agree, and the narrower where not', () => {
    const can = (m: PermissionModule, c: PermissionCapability) => roleCan('TAX_PREPARER', m, c);
    expect(['VIEW', 'CREATE', 'EDIT'].every((c) => can('CLIENTS', c as PermissionCapability))).toBe(
      true,
    );
    expect(can('LEADS', 'VIEW')).toBe(true);
    expect(can('LEADS', 'CREATE')).toBe(false); // Users & Roles says yes, Create Staff no
    expect(can('TAX_RETURNS', 'CREATE')).toBe(true);
    expect(can('TAX_RETURNS', 'EDIT')).toBe(false); // Create Staff says yes, Users & Roles no
    expect(can('BOOKKEEPING', 'EDIT')).toBe(false);
    expect(can('PAYROLL', 'CREATE')).toBe(false);
    expect(can('DOCUMENTS', 'CREATE')).toBe(false);
    expect(can('SETTINGS', 'VIEW')).toBe(false);
  });

  it('makes Read Only look and never change', () => {
    for (const grid of Object.values(DEFAULT_ROLE_PERMISSIONS.READ_ONLY)) {
      expect(grid).toEqual(['VIEW']);
    }
  });

  it('maps a request method to a capability', () => {
    expect(['GET', 'post', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(capabilityOfMethod)).toEqual([
      'VIEW',
      'CREATE',
      'EDIT',
      'EDIT',
      'DELETE',
      undefined,
    ]);
  });
});
