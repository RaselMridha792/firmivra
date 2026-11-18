import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from './audit.service.js';

/**
 * Audit Log Review 2, M02b (the lead's DECISIONS.md, "Audit Log" 3): a refused request worth a
 * row in the log, never every 403.
 * - In a firm: a request refused (403) on an export, on roles, permissions or a member's access,
 *   or on settings writes `access.denied` to that firm's log (who, the route, the code), never
 *   the request's body or query.
 * - Across firms: asking for a firm the signed-in person is not a member of writes
 *   `access.denied` to the platform's log; the firm's own log never names someone outside it.
 * Each person and route writes at most one row per window, so a script retrying cannot flood the
 * log. A row that cannot be written never changes the answer the request gets.
 */
export type DeniedCategory = 'export' | 'permissions' | 'settings';

/** One row per person, firm and route in this window. */
const WINDOW_MS = 10 * 60_000;
/** The rate limiter's memory: past this, windows that ended are forgotten. */
const MAX_KEYS = 10_000;

/** The route's pattern without the prefix: "/business/audit-log/export", ids as ":id". */
export function routeOf(req: Pick<Request, 'path'> & { route?: { path?: unknown } }): string {
  const pattern = typeof req.route?.path === 'string' ? req.route.path : req.path;
  return pattern.replace(/^\/api\/v1(?=\/)/, '');
}

/** The category of a refused firm route, or null for one that is not security-sensitive. */
export function deniedCategory(route: string): DeniedCategory | null {
  const parts = route.toLowerCase().split('/').filter(Boolean);
  if (parts.some((p) => p === 'export' || p.endsWith('-export') || p === 'exports'))
    return 'export';
  if (parts.some((p) => p === 'settings' || p.endsWith('-settings'))) return 'settings';
  if (
    parts.some((p) =>
      [
        'roles',
        'permissions',
        'permission-grants',
        'users',
        'team',
        'security',
        'access',
        'mfa-policy',
        'role',
      ].includes(p),
    )
  )
    return 'permissions';
  return null;
}

@Injectable()
export class DeniedAccessLog {
  private readonly logger = new Logger(DeniedAccessLog.name);
  private readonly last = new Map<string, number>();

  constructor(private readonly audit: AuditService) {}

  /** True the first time in a window for this key (and remembers it). */
  private allowed(key: string, now = Date.now()): boolean {
    const seen = this.last.get(key);
    if (seen !== undefined && now - seen < WINDOW_MS) return false;
    if (this.last.size >= MAX_KEYS) {
      for (const [k, at] of this.last) if (now - at >= WINDOW_MS) this.last.delete(k);
      if (this.last.size >= MAX_KEYS) this.last.clear();
    }
    this.last.set(key, now);
    return true;
  }

  /** A 403 in a firm (ApiExceptionFilter calls this): a row when the route is sensitive. */
  async refused(req: Request, code: string): Promise<void> {
    const tenant = req.tenant;
    const userId = req.auth?.userId;
    if (!tenant || tenant.kind !== 'staff' || !userId) return;
    const route = routeOf(req);
    const category = deniedCategory(route);
    if (!category) return;
    if (!this.allowed(`${tenant.businessId}:${userId}:${req.method} ${route}`)) return;
    await this.write(
      { type: 'route', id: `${req.method} ${route}` },
      { category, method: req.method, route, code, role: tenant.role },
      tenant.businessId,
    );
  }

  /** A signed-in person asked for a firm they are not a member of (TenantGuard calls this). */
  async crossFirm(req: Request, businessId: string): Promise<void> {
    const userId = req.auth?.userId;
    if (!userId) return;
    const route = routeOf(req);
    if (!this.allowed(`cross:${businessId}:${userId}:${req.method} ${route}`)) return;
    await this.write(
      { type: 'business', id: businessId },
      { category: 'cross_firm', method: req.method, route, code: 'NOT_A_MEMBER' },
      null,
    );
  }

  private async write(
    entity: { type: string; id: string },
    metadata: Record<string, unknown>,
    businessId: string | null,
  ): Promise<void> {
    try {
      await this.audit.log('access.denied', entity, metadata, { businessId });
    } catch {
      // AuditService already wrote the structured audit_write_failed line (M04).
      this.logger.warn(`access.denied for ${entity.type} not written`);
    }
  }
}

/** Global, as AuditModule is: ApiExceptionFilter and TenantGuard reach it from anywhere. */
@Global()
@Module({ providers: [DeniedAccessLog], exports: [DeniedAccessLog] })
export class DeniedAccessModule {}
