import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database, type ScopedClient } from '@firmivra/db';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../common/request-context.js';

export const DATABASE = Symbol('DATABASE');

/**
 * The current firm's data for this request: `this.tenantPrisma.db.client.findMany()`.
 * Row-level security limits every query to the firm TenantGuard resolved.
 * Only usable in routes whose @Roles() include a firm role.
 */
@Injectable()
export class TenantPrisma {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  get db(): ScopedClient {
    const tenant = requestContext.getStore()?.tenant;
    if (!tenant) throw new Error('TenantPrisma used in a request without a firm (check @Roles)');
    return this.database.forBusiness(tenant.businessId);
  }
}

/**
 * Platform tables for Super Admin routes: `this.platformPrisma.db.firmApplication.findMany()`.
 * Only works in a request whose caller RolesGuard verified as a Super Admin (`@Roles('SUPER_ADMIN')`
 * on a route under /api/v1/admin/). Never firm data: that needs an approved support grant (R8).
 */
@Injectable()
export class PlatformPrisma {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  get db(): ScopedClient {
    if (requestContext.getStore()?.platform?.role !== 'SUPER_ADMIN') {
      throw new Error('PlatformPrisma used outside a Super Admin request (check @Roles)');
    }
    return this.database.forPlatform();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ENV],
      // Up to 15 s per transaction: activation sets the Cognito password inside the transaction
      // that holds the invite (auth/invites.service.ts, #41 review).
      useFactory: (env: Env): Database =>
        createDatabase(env.DATABASE_URL_APP, { transactionOptions: { timeout: 15_000 } }),
    },
    TenantPrisma,
    PlatformPrisma,
  ],
  exports: [DATABASE, TenantPrisma, PlatformPrisma],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.disconnect();
  }
}
