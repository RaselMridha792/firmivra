import { z } from 'zod';

// Audit log viewer (R12): the firm's own audit log, read-only, newest first.
// Firm route: /api/v1/business/audit-log, Owner only (403 FORBIDDEN for Admin and Staff).
// Super Admin route: /api/v1/admin/firms/{businessId}/audit-log, only with an active support
// grant for that firm (R8); until R8 it answers 403 SUPPORT_GRANT_REQUIRED. Never another firm's.
// Metadata is what the action recorded: ids and hashes, never passwords, codes, tokens, SSNs or
// document content (CLAUDE.md rule 4).
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const DAY_MS = 24 * 60 * 60_000;

export const AuditActorKind = z.enum(['STAFF', 'CLIENT', 'PLATFORM']);
export type AuditActorKind = z.infer<typeof AuditActorKind>;

export const AuditEntry = z.object({
  id: z.uuid(),
  at: DateTime,
  /** For example "client_account.approved", "appointment.rescheduled". */
  action: z.string(),
  /** Who did it, or null for the system and signed-out requests. */
  actor: z.object({ userId: z.uuid(), name: z.string(), kind: AuditActorKind }).nullable(),
  entity: z.object({ type: z.string(), id: z.string().nullable() }),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * Filters: a date range (at most 366 days; the last 30 by default), an action or its prefix
 * ("appointment." for every appointment action), the person, and the record.
 */
export const AuditLogQuery = z
  .strictObject({
    from: DateTime.optional(),
    to: DateTime.optional(),
    action: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]+)*\.?$/, 'Use an action like "client.created" or "client."')
      .max(80)
      .optional(),
    actorUserId: z.uuid().optional(),
    entityType: z
      .string()
      .regex(/^[a-z_]+$/)
      .max(40)
      .optional(),
    entityId: z.string().max(100).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .refine(
    (q) =>
      !q.from ||
      !q.to ||
      (Date.parse(q.to) >= Date.parse(q.from) &&
        Date.parse(q.to) - Date.parse(q.from) <= 366 * DAY_MS),
    'Use a range of at most 366 days',
  );
export type AuditLogQuery = z.input<typeof AuditLogQuery>;

export const AuditLogPage = z.object({
  items: z.array(AuditEntry).max(100),
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof AuditLogPage>;

export const AuditLogErrorCode = z.enum([
  /** 403: a Super Admin needs an active support grant for this firm (R8). */
  'SUPPORT_GRANT_REQUIRED',
]);
export type AuditLogErrorCode = z.infer<typeof AuditLogErrorCode>;
