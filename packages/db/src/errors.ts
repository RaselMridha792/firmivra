/**
 * Errors the database raises on purpose (custom SQLSTATE codes from triggers), for the API to
 * turn into clear responses. Each code's message starts with its name, e.g. "LAST_ACTIVE_OWNER:".
 */
export const DB_ERRORS = {
  /** Demoting, deactivating or deleting a firm's last active owner (memberships_keep_an_owner). */
  LAST_ACTIVE_OWNER: 'FV001',
  /**
   * Recording or voiding an offline payment by anyone but the acting person, or by someone who is
   * not an active Owner or Admin (app_require_firm_manager). The API answers 403.
   */
  NOT_FIRM_MANAGER: 'FV002',
  /** An offline payment above the invoice's balance due (offline_payments_rules). */
  OVER_BALANCE: 'FV003',
} as const;

export type DbErrorName = keyof typeof DB_ERRORS;

/**
 * The PostgreSQL SQLSTATE behind a Prisma error, or undefined. Prisma wraps database errors from
 * the pg adapter in `meta.driverAdapterError.cause` (codes P2039 for model queries, P2010 for raw).
 */
export function databaseErrorCode(error: unknown): string | undefined {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as
    { originalCode?: unknown; code?: unknown } | undefined;
  const code = cause?.originalCode ?? cause?.code;
  return typeof code === 'string' ? code : undefined;
}

/** True when `error` is the named database error, e.g. isDbError(e, 'LAST_ACTIVE_OWNER'). */
export function isDbError(error: unknown, name: DbErrorName): boolean {
  return databaseErrorCode(error) === DB_ERRORS[name];
}
