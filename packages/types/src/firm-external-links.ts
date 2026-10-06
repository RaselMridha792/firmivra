import { z } from 'zod';

// Shared contract for docs/api/firm/external-links.yaml; policy validation also runs in the service.
export const FirmExternalLinkInput = z.strictObject({
  section: z.enum(['IRS_TAX', 'FUNDING_FINANCE', 'PLANNING_RESEARCH']),
  title: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(160),
  description: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(1000),
  url: z.url().min(1).max(2048).regex(new RegExp('^https://')),
  source: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  iconKey: z.string().max(1024).nullable(),
  sortOrder: z.number().int().min(0),
  active: z.boolean(),
  audience: z.enum(['BUSINESS', 'ALL']),
});
export type FirmExternalLinkInput = z.infer<typeof FirmExternalLinkInput>;

export const FirmExternalLinkPatch = z
  .strictObject({
    section: z.enum(['IRS_TAX', 'FUNDING_FINANCE', 'PLANNING_RESEARCH']).optional(),
    title: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(160)
      .optional(),
    description: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(1000)
      .optional(),
    url: z.url().min(1).max(2048).regex(new RegExp('^https://')).optional(),
    source: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(120)
      .optional(),
    iconKey: z.string().max(1024).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    audience: z.enum(['BUSINESS', 'ALL']).optional(),
  })
  .refine((value) => Object.keys(value).length >= 1, 'Supply at least 1 fields');
export type FirmExternalLinkPatch = z.infer<typeof FirmExternalLinkPatch>;

export const FirmExternalLink = z.strictObject({
  id: z.uuid(),
  section: z.enum(['IRS_TAX', 'FUNDING_FINANCE', 'PLANNING_RESEARCH']),
  title: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(160),
  description: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(1000),
  url: z.url().min(1).max(2048).regex(new RegExp('^https://')),
  source: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  iconKey: z.string().max(1024).nullable(),
  sortOrder: z.number().int().min(0),
  active: z.boolean(),
  audience: z.enum(['BUSINESS', 'ALL']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FirmExternalLink = z.infer<typeof FirmExternalLink>;

export const FirmPortalExternalLink = z.strictObject({
  id: z.uuid(),
  section: z.enum(['IRS_TAX', 'FUNDING_FINANCE', 'PLANNING_RESEARCH']),
  title: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(160),
  description: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(1000),
  url: z.url().min(1).max(2048).regex(new RegExp('^https://')),
  source: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  sortOrder: z.number().int().min(0),
  iconUrl: z.url().nullable(),
});
export type FirmPortalExternalLink = z.infer<typeof FirmPortalExternalLink>;

export const ListFirmExternalLinksResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmExternalLink)).max(200),
});
export type ListFirmExternalLinksResponse = z.infer<typeof ListFirmExternalLinksResponse>;

export const CreateFirmExternalLinkRequest = z.lazy(() => FirmExternalLinkInput);
export type CreateFirmExternalLinkRequest = z.infer<typeof CreateFirmExternalLinkRequest>;

export const CreateFirmExternalLinkResponse = z.lazy(() => FirmExternalLink);
export type CreateFirmExternalLinkResponse = z.infer<typeof CreateFirmExternalLinkResponse>;

export const UpdateFirmExternalLinkRequest = z.lazy(() => FirmExternalLinkPatch);
export type UpdateFirmExternalLinkRequest = z.infer<typeof UpdateFirmExternalLinkRequest>;

export const UpdateFirmExternalLinkResponse = z.lazy(() => FirmExternalLink);
export type UpdateFirmExternalLinkResponse = z.infer<typeof UpdateFirmExternalLinkResponse>;

export const ListPortalExternalLinksResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmPortalExternalLink)).max(200),
});
export type ListPortalExternalLinksResponse = z.infer<typeof ListPortalExternalLinksResponse>;
