// Audit Log Review 2, M02b: which refused firm routes are worth a row, and the rate limit.
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { AuditService } from '../../src/audit/audit.service.js';
import { DeniedAccessLog, deniedCategory, routeOf } from '../../src/audit/denied-access.js';

describe('deniedCategory', () => {
  it('names exports, permissions and settings; nothing else', () => {
    expect(deniedCategory('/business/audit-log/export')).toBe('export');
    expect(deniedCategory('/business/users/export')).toBe('export');
    expect(deniedCategory('/business/roles/:id')).toBe('permissions');
    expect(deniedCategory('/business/staff/:id/security')).toBe('permissions');
    expect(deniedCategory('/business/team/:id/role')).toBe('permissions');
    expect(deniedCategory('/business/settings')).toBe('settings');
    expect(deniedCategory('/business/intake-settings')).toBe('settings');
    for (const route of [
      '/business/audit-log',
      '/business/clients/:id',
      '/business/invoices',
      '/business/tasks/:id',
    ]) {
      expect([route, deniedCategory(route)]).toEqual([route, null]);
    }
  });

  it('reads the route pattern, never the URL with its ids or query', () => {
    expect(
      routeOf({
        path: '/api/v1/business/roles/abc',
        route: { path: '/api/v1/business/roles/:id' },
      }),
    ).toBe('/business/roles/:id');
  });
});

describe('DeniedAccessLog', () => {
  const req = (route: string, role = 'STAFF') =>
    ({
      method: 'GET',
      path: `/api/v1${route}`,
      route: { path: `/api/v1${route}` },
      auth: { userId: 'u-1' },
      tenant: { kind: 'staff', businessId: 'b-1', role },
    }) as unknown as Request;

  it('writes one row per person and route in a window, and none for a route that is not sensitive', async () => {
    const log = vi.fn(async () => undefined);
    const denied = new DeniedAccessLog({ log } as unknown as AuditService);
    await denied.refused(req('/business/audit-log/export'), 'FORBIDDEN');
    await denied.refused(req('/business/audit-log/export'), 'FORBIDDEN');
    await denied.refused(req('/business/audit-log'), 'FORBIDDEN');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'access.denied',
      { type: 'route', id: 'GET /business/audit-log/export' },
      {
        category: 'export',
        method: 'GET',
        route: '/business/audit-log/export',
        code: 'FORBIDDEN',
        role: 'STAFF',
      },
      { businessId: 'b-1' },
    );
  });

  it('a row that cannot be written never throws', async () => {
    const log = vi.fn(async () => {
      throw new Error('down');
    });
    const denied = new DeniedAccessLog({ log } as unknown as AuditService);
    await expect(denied.refused(req('/business/settings'), 'FORBIDDEN')).resolves.toBeUndefined();
  });
});
