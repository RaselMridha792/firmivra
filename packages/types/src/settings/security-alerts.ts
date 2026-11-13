import { z } from 'zod';

// Settings > Security & Access, Security Alerts (Octavia's Overview guide of Oct 18, items 6 and
// 19): the alerts the Overview's Security Alerts card counts, listed. Nothing is "resolved": an
// alert is open while it is inside the window, and the Settings badge goes when none are left.
// Owner and Admin only. No email, name or address: a sign-in alert says what happened and where.

const DateTime = z.iso.datetime({ offset: true });

/**
 * LOCKOUT: an account locked after repeated failed sign-ins; FAILED_SIGN_INS: 3 or more failed
 * sign-ins on one account within an hour that did not end in a lock; MFA_RESET: a member's
 * two-factor sign-in was reset in Staff Management.
 */
export const SecurityAlertKind = z.enum(['LOCKOUT', 'FAILED_SIGN_INS', 'MFA_RESET']);
export type SecurityAlertKind = z.infer<typeof SecurityAlertKind>;

export const SecurityAlertItem = z.object({
  /** The newest audit entry behind the alert. */
  id: z.uuid(),
  kind: SecurityAlertKind,
  /** When it last happened. */
  at: DateTime,
  /** Where the sign-in was tried: the firm's staff sign-in or its client portal. */
  pool: z.enum(['STAFF', 'CLIENT']).nullable(),
  /** FAILED_SIGN_INS: how many failures in that hour. */
  attempts: z.number().int().positive().nullable(),
  /** LOCKOUT: when the lock ends. */
  lockedUntil: DateTime.nullable(),
});
export type SecurityAlertItem = z.infer<typeof SecurityAlertItem>;

/** GET /business/settings/security-alerts. Newest first; `count` is the Overview's number. */
export const SecurityAlerts = z.object({
  count: z.number().int().nonnegative(),
  /** The window the alerts are counted over (7). */
  windowDays: z.number().int().positive(),
  items: z.array(SecurityAlertItem).max(200),
});
export type SecurityAlerts = z.infer<typeof SecurityAlerts>;
