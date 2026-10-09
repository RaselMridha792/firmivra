import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { databaseErrorCode, type Database, type TxClient } from '@firmivra/db';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';

/** The support views (R0's app_enter_support_scope names each in both audit logs). */
export type SupportView = 'audit_log';

/** How long a caller waits before trying again after the grant was busy (R0's lock_timeout). */
const RETRY_AFTER_SECONDS = 2;

export const supportScopeErrors = {
  grantRequired: () =>
    new ForbiddenException({
      code: 'SUPPORT_GRANT_REQUIRED',
      message: 'This needs an approved, unexpired support grant for this firm',
    }),
  /** The grant is held by a revoke or another support read: retryable (55P03). */
  busy: () =>
    new ConflictException({
      code: 'CONFLICT',
      message: 'Support access to this firm is changing. Please try again in a moment.',
      retryAfter: RETRY_AFTER_SECONDS,
    }),
};

/** 55P03 lock_not_available: R0's 2 s lock_timeout behind a revoke or another support read. */
export const isLockTimeout = (e: unknown) => databaseErrorCode(e) === '55P03';

/**
 * The only way the admin site reads a firm's data (R8, Rasel's Oct 6 rule; R0's #123 answer):
 * one read-write transaction opened in the Super Admin's own admin scope, whose first statement
 * is app_enter_support_scope. The database checks the admin's own approved, unexpired, unrevoked
 * grant, holds it so a revoke waits, writes the platform's and the firm's `support.viewed` rows,
 * moves the transaction into the firm's scope and makes it read-only. `fn` then reads with every
 * firm policy unchanged. No grant is 403 SUPPORT_GRANT_REQUIRED; a busy grant is a retryable 409.
 * Admin routes never open a plain business scope (test/unit/support-scope.test.ts).
 */
@Injectable()
export class SupportScope {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async read<T>(
    adminUserId: string,
    businessId: string,
    view: SupportView,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    const store = requestContext.getStore();
    try {
      return await this.db.withScope({ kind: 'admin', adminUserId }, async (tx) => {
        await tx.$queryRaw`
          SELECT app_enter_support_scope(${businessId}::uuid, ${view}, ${store?.ip ?? null},
            ${store?.userAgent ?? null}, ${store?.requestId ?? null}) AS until`;
        return fn(tx);
      });
    } catch (e) {
      if (databaseErrorCode(e) === '42501') throw supportScopeErrors.grantRequired();
      if (isLockTimeout(e)) throw supportScopeErrors.busy();
      throw e;
    }
  }
}
