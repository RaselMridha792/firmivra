import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
export interface ApprovedSupportScope {
  businessId: string;
  grantId: string;
  adminUserId: string;
}
export abstract class ApprovedSupportAccess {
  /** Rasel authorizes an owner-approved, live grant for this admin and supplies a business-scoped
   * transaction. Revoke/expiry must be checked for every call, never cached or inferred from role. */
  abstract withFirm<T>(
    selector: string,
    adminUserId: string,
    read: (tx: TxClient, scope: ApprovedSupportScope) => Promise<T>,
  ): Promise<T>;
}
@Injectable()
export class PendingSupportAccess extends ApprovedSupportAccess {
  async withFirm<T>(): Promise<T> {
    throw new ServiceUnavailableException({
      code: 'SUPPORT_NOT_READY',
      message: 'Support authorization service is unavailable',
    });
  }
}
