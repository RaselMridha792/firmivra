import { z } from 'zod';

// Shared contract for docs/api/firm/applications.yaml; policy validation also runs in the service.
export const FirmApplicationSummary = z.strictObject({
  id: z.uuid(),
  status: z.enum(['PENDING_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DECLINED']),
  legalName: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(200),
  dbaName: z.string().max(200).nullable(),
  contactName: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(200),
  contactEmail: z.email().min(1).max(254),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FirmApplicationSummary = z.infer<typeof FirmApplicationSummary>;

export const FirmApplicationDetail = z.strictObject({
  id: z.uuid(),
  status: z.enum(['PENDING_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DECLINED']),
  legalName: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(200),
  dbaName: z.string().max(200).nullable(),
  contactName: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(200),
  contactEmail: z.email().min(1).max(254),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  contactPhone: z.string().max(40).nullable(),
  internalNotes: z.string().max(4000).nullable(),
  decisionReason: z.string().max(4000).nullable(),
  reviewedByUserId: z.uuid().nullable(),
  reviewedAt: z.iso.datetime({ offset: true }).nullable(),
  businessId: z.uuid().nullable(),
  form: z.strictObject({
    website: z.url().max(2048).nullable(),
    addressLine1: z.string().max(200).nullable(),
    addressLine2: z.string().max(200).nullable(),
    city: z.string().max(120).nullable(),
    state: z.string().max(120).nullable(),
    postalCode: z.string().max(32).nullable(),
    country: z.string().max(2).nullable(),
  }),
});
export type FirmApplicationDetail = z.infer<typeof FirmApplicationDetail>;

export const FirmApplicationHistory = z.strictObject({
  id: z.uuid(),
  fromStatus: z.enum(['PENDING_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DECLINED']).nullable(),
  toStatus: z.enum(['PENDING_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DECLINED']),
  actorUserId: z.uuid().nullable(),
  reason: z.string().max(4000).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type FirmApplicationHistory = z.infer<typeof FirmApplicationHistory>;

export const ListAdminApplicationsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  status: z.enum(['PENDING_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DECLINED']).optional(),
  search: z.string().max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type ListAdminApplicationsQuery = z.infer<typeof ListAdminApplicationsQuery>;

export const ListAdminApplicationsResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmApplicationSummary)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListAdminApplicationsResponse = z.infer<typeof ListAdminApplicationsResponse>;

export const GetAdminApplicationResponse = z.lazy(() => FirmApplicationDetail);
export type GetAdminApplicationResponse = z.infer<typeof GetAdminApplicationResponse>;

export const ListAdminApplicationHistoryQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListAdminApplicationHistoryQuery = z.infer<typeof ListAdminApplicationHistoryQuery>;

export const ListAdminApplicationHistoryResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmApplicationHistory)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListAdminApplicationHistoryResponse = z.infer<
  typeof ListAdminApplicationHistoryResponse
>;
