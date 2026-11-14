import { z } from 'zod';
import { TaxReturnWorkflowStatus } from '../db-enums.js';

// Firm tax statuses (Settings > Tax statuses): the statuses a firm shows on each client's tax year.
// Staff read them; Owner and Admin add, rename, reorder and archive. Archived, never deleted.
// API: /api/v1/business/tax-statuses (lead's T04, from Tumit's design).

/** 1 to 120 characters after trimming. Unique within the firm, ignoring case (archived ones too). */
export const TaxStatusName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(120, 'Use at most 120 characters')
  .regex(/^[^\p{Cc}]*$/u, 'Remove the special characters');

/** A status id in a path: anything else gets 400 VALIDATION_FAILED. */
export const TaxStatusId = z.uuid();

/** Responses are plain objects: a field added later is dropped, so an open page keeps working. */
export const TaxStatus = z.object({
  id: z.uuid(),
  name: z.string(),
  /** 0, 1, 2 ... in display order; archived statuses keep their last position. */
  sortOrder: z.number().int().min(0),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  /**
   * Tax Returns Review 2 (TX-F36): the fixed workflow status this label stands for ("Maps to"),
   * or null for a label of the firm's own with no workflow meaning. Missing reads as null.
   */
  workflowStatus: TaxReturnWorkflowStatus.nullable().default(null),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type TaxStatus = z.infer<typeof TaxStatus>;

/** "Maps to": a workflow status, or null for none. */
export const TaxStatusMapping = TaxReturnWorkflowStatus.nullable();

/** GET query: archived statuses are left out unless includeArchived=true. */
export const ListTaxStatusesQuery = z.strictObject({
  includeArchived: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    )
    .optional()
    .default(false),
});
export type ListTaxStatusesQuery = { includeArchived?: boolean };

/** The list and the result of a reorder, in display order (at most 500 per firm). */
export const ListTaxStatusesResponse = z.object({
  items: z.array(TaxStatus).max(500),
});
export type ListTaxStatusesResponse = z.infer<typeof ListTaxStatusesResponse>;

/**
 * POST: the new status goes last, mapped to `workflowStatus` when one is given. Unknown fields
 * such as businessId are refused.
 */
export const CreateTaxStatusRequest = z.strictObject({
  name: TaxStatusName,
  workflowStatus: TaxStatusMapping.optional(),
});
export type CreateTaxStatusRequest = z.input<typeof CreateTaxStatusRequest>;

/** PATCH /{id}: a new name, a new "Maps to" (null for none), or both. */
export const RenameTaxStatusRequest = z
  .strictObject({
    name: TaxStatusName.optional(),
    workflowStatus: TaxStatusMapping.optional(),
  })
  .refine((b) => b.name !== undefined || b.workflowStatus !== undefined, 'Change something first');
export type RenameTaxStatusRequest = z.input<typeof RenameTaxStatusRequest>;

/** PUT /order: every active status's id exactly once, in the new order. */
export const OrderTaxStatusesRequest = z.strictObject({
  ids: z
    .array(TaxStatusId)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Each status only once'),
});
export type OrderTaxStatusesRequest = z.input<typeof OrderTaxStatusesRequest>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const TaxStatusErrorCode = z.enum([
  /** 409: another status of the firm has this name (ignoring case, archived ones too). */
  'DUPLICATE_NAME',
  /** 409: the firm already has 500 statuses. */
  'CONFIGURATION_LIMIT',
  /** 409: a reorder did not list every active status exactly once. */
  'CONFLICT',
]);
export type TaxStatusErrorCode = z.infer<typeof TaxStatusErrorCode>;
