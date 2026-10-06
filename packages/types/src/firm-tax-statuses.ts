import { z } from 'zod';

// Shared contract for docs/api/firm/tax-statuses.yaml; policy validation also runs in the service.
export const FirmTaxStatus = z.strictObject({
  id: z.uuid(),
  name: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  sortOrder: z.number().int().min(0),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FirmTaxStatus = z.infer<typeof FirmTaxStatus>;

export const ListTaxStatusesQuery = z.strictObject({
  includeArchived: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    )
    .optional()
    .default(false),
});
export type ListTaxStatusesQuery = z.infer<typeof ListTaxStatusesQuery>;

export const ListTaxStatusesResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmTaxStatus)).max(500),
});
export type ListTaxStatusesResponse = z.infer<typeof ListTaxStatusesResponse>;

export const CreateTaxStatusRequest = z.strictObject({
  name: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
});
export type CreateTaxStatusRequest = z.infer<typeof CreateTaxStatusRequest>;

export const CreateTaxStatusResponse = z.lazy(() => FirmTaxStatus);
export type CreateTaxStatusResponse = z.infer<typeof CreateTaxStatusResponse>;

export const OrderTaxStatusesRequest = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(500)
    .refine((value) => new Set(value).size === value.length, 'Duplicate values'),
});
export type OrderTaxStatusesRequest = z.infer<typeof OrderTaxStatusesRequest>;

export const OrderTaxStatusesResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmTaxStatus)).max(500),
});
export type OrderTaxStatusesResponse = z.infer<typeof OrderTaxStatusesResponse>;

export const RenameTaxStatusRequest = z.strictObject({
  name: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
});
export type RenameTaxStatusRequest = z.infer<typeof RenameTaxStatusRequest>;

export const RenameTaxStatusResponse = z.lazy(() => FirmTaxStatus);
export type RenameTaxStatusResponse = z.infer<typeof RenameTaxStatusResponse>;

export const ArchiveTaxStatusResponse = z.lazy(() => FirmTaxStatus);
export type ArchiveTaxStatusResponse = z.infer<typeof ArchiveTaxStatusResponse>;
