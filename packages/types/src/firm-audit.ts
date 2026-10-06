import { z } from 'zod';

// Shared contract for docs/api/firm/audit.yaml; policy validation also runs in the service.
export const FirmAuditEvent = z.strictObject({
  id: z.uuid(),
  actorUserId: z.uuid().nullable(),
  action: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100),
  entityType: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100),
  entityId: z.string().max(200).nullable(),
  metadata: z.object({}).catchall(z.unknown()),
  requestId: z.string().max(100).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type FirmAuditEvent = z.infer<typeof FirmAuditEvent>;

export const ListFirmAuditLogsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  actorUserId: z.uuid().optional(),
});
export type ListFirmAuditLogsQuery = z.infer<typeof ListFirmAuditLogsQuery>;

export const ListFirmAuditLogsResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAuditEvent)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListFirmAuditLogsResponse = z.infer<typeof ListFirmAuditLogsResponse>;

export const ListSupportAuditLogsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  actorUserId: z.uuid().optional(),
});
export type ListSupportAuditLogsQuery = z.infer<typeof ListSupportAuditLogsQuery>;

export const ListSupportAuditLogsResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAuditEvent)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListSupportAuditLogsResponse = z.infer<typeof ListSupportAuditLogsResponse>;
