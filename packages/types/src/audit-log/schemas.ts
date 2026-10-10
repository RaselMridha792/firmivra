import { z } from 'zod';

// Audit log viewer (R12): the firm's own audit log, read-only, newest first.
// Firm route: /api/v1/business/audit-log, Owner and Admin (the roles matrix; 403 FORBIDDEN for
// Staff). Super Admin route: /api/v1/admin/firms/{businessId}/audit-log, only with an active
// support grant for that firm (R8): without one it is 403 SUPPORT_GRANT_REQUIRED, and a grant
// being revoked at that moment is 409 CONFLICT with `retryAfter: 2` (Retry-After: 2). Each read
// writes `support.viewed` to both logs. Never another firm's.
// - A Super Admin's action in the firm through a support grant is written to both logs: the
//   firm's, where it shows as "Firmivra Support" (no user id, no IP), and the platform's, with
//   the person.
// - Reading this log is logged too: the first page of each read writes `audit_log.viewed` with
//   the filters (never the rows), as client reads write `client.viewed` and `clients.listed`.
// Metadata is what the action recorded: ids and hashes, never passwords, codes, tokens, SSNs or
// document content (CLAUDE.md rule 4); `{}` when the action recorded none.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const DAY_MS = 24 * 60 * 60_000;
/** One line of at most `max` characters, without control characters. */
const oneLine = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[^\p{Cc}]+$/u, 'Remove the special characters');

export const AuditActorKind = z.enum(['STAFF', 'CLIENT', 'PLATFORM']);
export type AuditActorKind = z.infer<typeof AuditActorKind>;

/** Who did it: a person of the firm or a client, or Firmivra Support (never the person). */
export const AuditActor = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['STAFF', 'CLIENT']), userId: z.uuid(), name: z.string() }),
  /** A Super Admin through a support grant: never their id or name. */
  z.object({ kind: z.literal('PLATFORM'), userId: z.null(), name: z.literal('Firmivra Support') }),
]);
export type AuditActor = z.infer<typeof AuditActor>;

export const AuditEntry = z
  .object({
    id: z.uuid(),
    at: DateTime,
    /** For example "client_account.approved", "appointment.rescheduled". */
    action: z.string(),
    /** Null for the system and signed-out requests. */
    actor: AuditActor.nullable(),
    entity: z.object({ type: z.string(), id: z.string().nullable() }),
    metadata: z.record(z.string(), z.unknown()),
    /** The request's IP; always null for Firmivra Support. */
    ip: z.string().nullable(),
    requestId: z.string().nullable(),
  })
  .refine((e) => e.actor?.kind !== 'PLATFORM' || e.ip === null, {
    message: 'A Firmivra Support row has no IP',
    path: ['ip'],
  });
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * Filters: a date range, both ends or neither (then the last 30 days), at most 366 days, inclusive
 * at both ends, so a screen sending the end of a day gets that day's last rows; an action or its
 * prefix ("appointment." for every appointment action); the person; the record.
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
    entityId: oneLine(100).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: 'Give both from and to, or neither',
    path: ['to'],
  })
  .refine(
    (q) =>
      !q.from ||
      !q.to ||
      (Date.parse(q.to) >= Date.parse(q.from) &&
        Date.parse(q.to) - Date.parse(q.from) <= 366 * DAY_MS),
    { message: 'Use a range of at most 366 days', path: ['to'] },
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
