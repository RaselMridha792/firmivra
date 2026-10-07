import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

/**
 * Which rows the app may see, enforced by PostgreSQL row-level security
 * (prisma/migrations/*_row_level_security).
 * - business: one firm's data. Everything a firm user or client does. `actorUserId` optionally
 *   records who is acting; rows private to one person (a client's own notes) need it.
 * - user: the signed-in person's own memberships and client accounts across firms (/me).
 * - admin: Super Admin pages, for one platform admin: firm applications and their history,
 *   firms' platform fields, support grant requests, firm owners' contact and platform audit
 *   events. Never firm data. Sees nothing unless `adminUserId` is a platform admin.
 * - platform: identity work (sign-in, invites, activation, firm provisioning). No firm data.
 * - invite: only the invite whose token hash matches (signed-out "accept invite" step).
 */
export type Scope =
  | { kind: 'business'; businessId: string; actorUserId?: string }
  | { kind: 'user'; userId: string }
  | { kind: 'admin'; adminUserId: string }
  | { kind: 'invite'; tokenHash: string }
  | { kind: 'platform' };

export type TxClient = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function assertScope(scope: Scope): void {
  if (scope.kind === 'invite') {
    if (!SHA256_HEX.test(scope.tokenHash)) {
      throw new Error('Invalid invite token hash for database scope');
    }
    return;
  }
  const id =
    scope.kind === 'business'
      ? scope.businessId
      : scope.kind === 'user'
        ? scope.userId
        : scope.kind === 'admin'
          ? scope.adminUserId
          : null;
  if (id !== null && !UUID.test(id)) {
    throw new Error(`Invalid ${scope.kind} id for database scope`);
  }
  if (
    scope.kind === 'business' &&
    scope.actorUserId !== undefined &&
    !UUID.test(scope.actorUserId)
  ) {
    throw new Error('Invalid actor id for database scope');
  }
}

/** Sets the scope for the current transaction only (set_config(..., true)). */
function setScope(client: PrismaClient | TxClient, scope: Scope) {
  const businessId = scope.kind === 'business' ? scope.businessId : '';
  const actorUserId = scope.kind === 'business' ? (scope.actorUserId ?? '') : '';
  const userId = scope.kind === 'user' ? scope.userId : '';
  const adminUserId = scope.kind === 'admin' ? scope.adminUserId : '';
  const tokenHash = scope.kind === 'invite' ? scope.tokenHash : '';
  return client.$executeRaw`SELECT
    set_config('app.scope', ${scope.kind}, true),
    set_config('app.current_business_id', ${businessId}, true),
    set_config('app.current_actor_id', ${actorUserId}, true),
    set_config('app.current_user_id', ${userId}, true),
    set_config('app.current_admin_id', ${adminUserId}, true),
    set_config('app.invite_token_hash', ${tokenHash}, true)`;
}

/** Limits for one transaction, in ms; unset values use the client's (Prisma's 2000 and 5000). */
export interface TransactionLimits {
  /** How long to wait for a connection to start the transaction. */
  maxWait?: number;
  /** How long the transaction may run. */
  timeout?: number;
}

/**
 * Runs `fn` in one transaction with the scope set. Use it for multi-step work and raw SQL.
 * Works with the app client and, for seeds and tests, the owner client. `limits` is for the rare
 * call that waits on an outside service inside the transaction (R2's activation calls Cognito):
 * only that call gets the longer time.
 */
export async function runInScope<T>(
  client: PrismaClient,
  scope: Scope,
  fn: (tx: TxClient) => Promise<T>,
  limits?: TransactionLimits,
): Promise<T> {
  assertScope(scope);
  return client.$transaction(async (tx) => {
    await setScope(tx, scope);
    return fn(tx);
  }, capped(limits));
}

/** No transaction may wait or run longer than this, whatever a caller asks for. */
export const MAX_TRANSACTION_MS = 30_000;

/** Only maxWait and timeout reach Prisma, each at most MAX_TRANSACTION_MS. */
function capped(limits: TransactionLimits | undefined): TransactionLimits | undefined {
  if (!limits) return undefined;
  const cap = (ms: number | undefined) =>
    ms === undefined || !Number.isFinite(ms)
      ? undefined
      : Math.min(Math.max(ms, 0), MAX_TRANSACTION_MS);
  const maxWait = cap(limits.maxWait);
  const timeout = cap(limits.timeout);
  return {
    ...(maxWait !== undefined ? { maxWait } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

/**
 * A client where every model query runs in its own transaction with the scope set first
 * (set_config(..., true): the setting ends with that transaction, so a pooled connection
 * goes back to the pool with no scope). Raw queries ($queryRaw) are not scoped and therefore
 * see nothing: use runInScope for those. $transaction is removed so nobody opens an unscoped
 * transaction by mistake. Exported for tests; application code uses createDatabase().
 */
export function scopedClient(base: PrismaClient, scope: Scope) {
  assertScope(scope);
  const client = base.$extends({
    name: `firmivra-scope-${scope.kind}`,
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await base.$transaction([setScope(base, scope), query(args)]);
          return result;
        },
      },
    },
  });
  return client as Omit<typeof client, '$transaction'>;
}

export type ScopedClient = ReturnType<typeof scopedClient>;

export interface ClientOptions {
  /** Size of the connection pool (pg default when unset). Tests use 1 to force connection reuse. */
  maxConnections?: number;
  /**
   * Interactive transactions (runInScope, withScope): how long to wait to start one and how long
   * one may run, in ms. Prisma's defaults (2000 and 5000) apply when unset. Tests raise them,
   * because several suites on one machine can keep a transaction from starting within 2 s.
   */
  transactionOptions?: { maxWait?: number; timeout?: number };
}

export function createPrismaClient(
  connectionString: string,
  options: ClientOptions = {},
): PrismaClient {
  const pool = options.maxConnections
    ? { connectionString, max: options.maxConnections }
    : { connectionString };
  return new PrismaClient({
    adapter: new PrismaPg(pool),
    ...(options.transactionOptions ? { transactionOptions: options.transactionOptions } : {}),
  });
}

/**
 * The API's database access, as the non-owner role firmivra_app (DATABASE_URL_APP).
 * Without a scope the role sees no rows at all.
 */
export function createDatabase(appConnectionString: string, options: ClientOptions = {}) {
  const base = createPrismaClient(appConnectionString, options);
  return {
    /**
     * Only one firm's data: everything a firm user or client does. Pass `actorUserId` (the
     * signed-in person) for rows private to one person, such as a client's own notes.
     */
    forBusiness: (businessId: string, options: { actorUserId?: string } = {}) =>
      scopedClient(
        base,
        options.actorUserId === undefined
          ? { kind: 'business', businessId }
          : { kind: 'business', businessId, actorUserId: options.actorUserId },
      ),
    /** The signed-in person's own memberships and client accounts across firms. */
    forUser: (userId: string) => scopedClient(base, { kind: 'user', userId }),
    /** Only the invite with this SHA-256 token hash (hex). Read its businessId, then use forBusiness. */
    forInvite: (tokenHash: string) => scopedClient(base, { kind: 'invite', tokenHash }),
    /**
     * Super Admin pages, acting as `adminUserId` (must be a platform admin, else nothing is
     * visible): firm applications and history, firms' status and slug, support grant requests,
     * firm owners' contact, platform audit events. Never firm data: that needs an approved
     * support grant and firm scope.
     */
    forAdmin: (adminUserId: string) => scopedClient(base, { kind: 'admin', adminUserId }),
    /** Identity work: sign-in, invites, activation, firm provisioning. Never firm data. */
    forPlatform: () => scopedClient(base, { kind: 'platform' }),
    /**
     * Multi-step transaction in one scope. `limits` (for example `{ timeout: 15_000 }`) applies to
     * this call only.
     */
    withScope: <T>(scope: Scope, fn: (tx: TxClient) => Promise<T>, limits?: TransactionLimits) =>
      runInScope(base, scope, fn, limits),
    /** Connectivity check for health endpoints. Touches no table. */
    ping: async () => {
      await base.$queryRaw`SELECT 1`;
    },
    disconnect: () => base.$disconnect(),
  };
}

export type Database = ReturnType<typeof createDatabase>;
