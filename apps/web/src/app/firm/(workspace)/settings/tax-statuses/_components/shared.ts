import type { TaxReturnWorkflowStatus } from '@firmivra/types';
import { STATUS_LABEL, STATUS_ORDER } from '../../../tax-returns/_components/tr-shared';

/** Review 2 (TX-F36): "Maps to" choices, the Tax Returns workflow statuses, and none. */
export const MAPS_TO_OPTIONS = [
  { value: '', label: 'None (your own label)' },
  ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];
export const mapsToLabel = (s: TaxReturnWorkflowStatus | null) => (s ? STATUS_LABEL[s] : 'None');

/** One key for this list: reads use it, and every change refetches it (`invalidate`). */
export const TAX_STATUSES = ['tax-statuses'];

/** This module's error codes (TaxStatusErrorCode in @firmivra/types), for errorMessage(). */
export const STATUS_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'A status with this name already exists.',
  CONFIGURATION_LIMIT: 'Your firm has the most tax statuses it can have. Archive one first.',
  CONFLICT: 'The list changed while you were working. Reload and try again.',
};
