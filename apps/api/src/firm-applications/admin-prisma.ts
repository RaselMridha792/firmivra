import { Inject, Injectable } from '@nestjs/common';
import type { Database, ScopedClient, TxClient } from '@firmivra/db';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';

/**
 * The Super Admin's view of platform tables, acting as the signed-in admin (`forAdmin`, R0's
 * admin scope): firm applications and their history, firms' status and slug, owner memberships
 * and active owners' contact, platform audit events. Never firm data. Only in a request whose
 * caller RolesGuard verified as a Super Admin (`@Roles('SUPER_ADMIN')` under /api/v1/admin/).
 */
@Injectable()
export class AdminPrisma {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** The signed-in Super Admin's user id. */
  get adminUserId(): string {
    return this.superAdmin();
  }

  get db(): ScopedClient {
    return this.database.forAdmin(this.superAdmin());
  }

  /**
   * Approval's provisioning, in one transaction in platform scope (packages/db: creating a firm
   * and linking its application are platform work). Only in a Super Admin request, like `db`.
   */
  async provision<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    this.superAdmin();
    return this.database.withScope({ kind: 'platform' }, fn);
  }

  private superAdmin(): string {
    const store = requestContext.getStore();
    if (store?.platform?.role !== 'SUPER_ADMIN' || !store.auth) {
      throw new Error('AdminPrisma used outside a Super Admin request (check @Roles)');
    }
    return store.auth.userId;
  }
}
