import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { FirmAccountAction } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from './admin-prisma.js';

/** The audit action each account action writes; the firm page's Account History reads them. */
export const FIRM_ACCOUNT_AUDIT = {
  suspend: 'business.suspended',
  reactivate: 'business.reactivated',
  close: 'business.closed',
} as const satisfies Record<FirmAccountAction, string>;

type Status = 'PENDING_SETUP' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

/** The statuses each action starts from (Closed is final; the database refuses any way out). */
export const FIRM_ACCOUNT_FROM: Record<FirmAccountAction, readonly Status[]> = {
  suspend: ['ACTIVE', 'PENDING_SETUP'],
  reactivate: ['SUSPENDED'],
  close: ['ACTIVE', 'PENDING_SETUP', 'SUSPENDED'],
};

/** What the Actions menu offers for a firm in `status` (FirmRecord.can). */
export const firmAccountCan = (status: string) => ({
  suspend: (FIRM_ACCOUNT_FROM.suspend as readonly string[]).includes(status),
  reactivate: (FIRM_ACCOUNT_FROM.reactivate as readonly string[]).includes(status),
  close: (FIRM_ACCOUNT_FROM.close as readonly string[]).includes(status),
});

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const statusChanged = () =>
  new ConflictException({
    code: 'FIRM_STATUS_CHANGED',
    message: "This firm's status has changed. Reload the page to see it.",
  });

/**
 * A firm's account actions (SA-FRM-F03, F04, Y10): one server action per change of state, for the
 * firm page's Actions menu and, later, Billing's Suspend and Cancel Account (SA-BIL-A2e). Admin
 * scope as the signed-in Super Admin: the database lets it change only the status, never out of
 * Closed, and records the closure time itself. The change and its audit row commit together.
 * While a firm is Suspended or Closed every firm route refuses its people (TenantGuard: 403
 * BUSINESS_INACTIVE); nothing of the firm's own data is read or changed here.
 */
@Injectable()
export class FirmAccountService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  /**
   * Suspend (Active or Pending Setup), Reactivate (Suspended: back to Active, or to Pending Setup
   * if the owner never finished setup) or Close (any status but Closed). 404 for an unknown firm;
   * 409 FIRM_STATUS_CHANGED when it is no longer in a status the action starts from, such as a
   * second administrator's click a moment later.
   */
  async change(id: string, action: FirmAccountAction, reason: string): Promise<void> {
    await this.admin.transaction(async (tx) => {
      // The firm's row first: a second action at the same moment waits, then meets this one's
      // status, so the history's "from" is always the status it changed.
      await tx.$queryRaw`SELECT 1 FROM businesses WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      const firm = await tx.business.findUnique({
        where: { id },
        select: { status: true, activatedAt: true },
      });
      if (!firm) throw notFound();
      const to: Status =
        action === 'suspend'
          ? 'SUSPENDED'
          : action === 'close'
            ? 'CLOSED'
            : firm.activatedAt
              ? 'ACTIVE'
              : 'PENDING_SETUP';
      // Only from a status the action starts from: of two clicks at once, the second finds the
      // status already changed.
      const { count } = await tx.business.updateMany({
        where: { id, status: { in: [...FIRM_ACCOUNT_FROM[action]] } },
        data: { status: to },
      });
      if (count === 0) throw statusChanged();
      // The platform's row (no firm): the reason is the Super Admin's, never sent to the firm.
      await this.audit.logIn(
        tx,
        FIRM_ACCOUNT_AUDIT[action],
        { type: 'business', id },
        { reason, from: firm.status, to },
        { businessId: null },
      );
    });
  }
}
