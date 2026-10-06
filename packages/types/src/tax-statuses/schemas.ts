import { z } from 'zod';

// Firm tax statuses (Settings > Tax statuses): the statuses a firm shows on each client's tax year.
// Staff read them; Owner and Admin add, rename, reorder and archive. Archived, never deleted.
// API: /api/v1/business/tax-statuses (lead's T04, from Tumit's design).

/** 1 to 120 characters after trimming. Unique within the firm, ignoring case (archived ones too). */
export const TaxStatusName = z.string().trim().min(1, 'Enter a name').max(120);

export const TaxStatus = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  /** 0, 1, 2 ... in display order; archived statuses keep their last position. */
  sortOrder: z.number().int().min(0),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type TaxStatus = z.infer<typeof TaxStatus>;

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
export type ListTaxStatusesQuery = z.input<typeof ListTaxStatusesQuery>;

/** The list and the result of a reorder, in display order (at most 500 per firm). */
export const ListTaxStatusesResponse = z.strictObject({
  items: z.array(TaxStatus).max(500),
});
export type ListTaxStatusesResponse = z.infer<typeof ListTaxStatusesResponse>;

/** POST: the new status goes last. Unknown fields such as businessId are refused. */
export const CreateTaxStatusRequest = z.strictObject({ name: TaxStatusName });
export type CreateTaxStatusRequest = z.input<typeof CreateTaxStatusRequest>;

/** PATCH /{id}. */
export const RenameTaxStatusRequest = z.strictObject({ name: TaxStatusName });
export type RenameTaxStatusRequest = z.input<typeof RenameTaxStatusRequest>;

/** PUT /order: every active status's id exactly once, in the new order. */
export const OrderTaxStatusesRequest = z.strictObject({
  ids: z
    .array(z.uuid())
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
