/** One key for this list: reads use it, and every change refetches it (`invalidate`). */
export const TAX_STATUSES = ['tax-statuses'];

/** This module's error codes (TaxStatusErrorCode in @firmivra/types), for errorMessage(). */
export const STATUS_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'A status with this name already exists.',
  CONFIGURATION_LIMIT: 'Your firm has the most tax statuses it can have. Archive one first.',
  CONFLICT: 'The list changed while you were working. Reload and try again.',
};
