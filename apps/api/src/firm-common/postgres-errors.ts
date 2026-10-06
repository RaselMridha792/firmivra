/** Inspect only structured driver codes; never match or expose SQL/provider error messages. */
export function hasPostgresCode(error: unknown, code: string, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 8) return false;
  const row = error as Record<string, unknown>;
  if (row.code === code || row.originalCode === code || row.sqlState === code) return true;
  return ['cause', 'meta', 'driverAdapterError', 'error'].some((key) =>
    hasPostgresCode(row[key], code, depth + 1),
  );
}
