import type { TxClient } from '@firmivra/db';
import { errors, isPoolBusy, isRetryable } from './errors.js';

// Locks of the appointment services. Advisory locks are only ever tried
// (pg_try_advisory_xact_lock), never waited for, so no request holds a pooled connection while it
// waits: a busy key throws LockBusy, the transaction rolls back, and retryWhenBusy starts it
// again a moment later (outside any transaction); still busy after BUSY_WAIT_MS, the answer is
// 429 RATE_LIMITED, like the rate limit. Row locks (FOR UPDATE) are taken first, before any
// advisory lock, so nothing waits on a row while holding a calendar key.
//
// What each key protects. The exclusion constraints stop double booking on their own, so
// bookings never need each other's locks (shared). The gap they leave is blocked time: a new
// block checks the appointments and a new appointment's trigger checks the blocks, and two such
// transactions at once would each miss the other. So:
// - a booking or a new time for staff member S holds the firm's key and S's key, shared;
// - blocked time for S holds S's key, exclusive; a whole-firm block holds the firm's key,
//   exclusive.

/** Someone holds the lock now: the caller's transaction is tried again (retryWhenBusy). */
export class LockBusy extends Error {
  constructor() {
    super('A calendar lock is busy');
  }
}

/** The calendar keys: the firm's, or one staff member's. Exported for tests. */
export const calendarLockKey = (businessId: string, userId?: string | null) =>
  userId ? `appointments:${businessId}:${userId}` : `appointments:${businessId}`;

/** One change of a member's working hours at a time (a replace must not merge two weeks). */
export const workingHoursLockKey = (businessId: string, userId: string) =>
  `working_hours:${businessId}:${userId}`;

/** One name check of a firm's appointment types at a time (names are unique ignoring case). */
export const typeNamesLockKey = (businessId: string) => `appointment_type_names:${businessId}`;

/** Takes the advisory lock for this transaction if it is free; else throws LockBusy. */
export async function tryLock(
  tx: TxClient,
  key: string,
  mode: 'shared' | 'exclusive' = 'exclusive',
): Promise<void> {
  const [row] =
    mode === 'shared'
      ? await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock_shared(hashtextextended(${key}, 0)) AS ok`
      : await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
  if (row?.ok !== true) throw new LockBusy();
}

/** Before a booking or a new time for `staffUserId`. */
export async function lockForBooking(
  tx: TxClient,
  businessId: string,
  staffUserId: string,
): Promise<void> {
  await tryLock(tx, calendarLockKey(businessId), 'shared');
  await tryLock(tx, calendarLockKey(businessId, staffUserId), 'shared');
}

/** Before new blocked time for `userId`, or the whole firm when it is null. */
export async function lockForBlock(
  tx: TxClient,
  businessId: string,
  userId: string | null,
): Promise<void> {
  await tryLock(tx, calendarLockKey(businessId, userId), 'exclusive');
}

/**
 * Locks one appointment's row for a change. A second change at the same time waits here, then
 * reads what the first one wrote (so a cancel and a completion never both pass the status check).
 * Row-level security keeps it to this firm; with `clientId` (the portal), only that client's
 * appointment is locked. An unknown id locks nothing.
 */
export async function lockAppointment(
  tx: TxClient,
  businessId: string,
  appointmentId: string,
  clientId?: string,
): Promise<void> {
  if (clientId) {
    await tx.$queryRaw`
      SELECT id FROM appointments
      WHERE business_id = ${businessId}::uuid AND id = ${appointmentId}::uuid
        AND client_id = ${clientId}::uuid
      FOR UPDATE`;
    return;
  }
  await tx.$queryRaw`
    SELECT id FROM appointments
    WHERE business_id = ${businessId}::uuid AND id = ${appointmentId}::uuid
    FOR UPDATE`;
}

/** How long a change keeps trying a busy calendar lock before it answers 429. */
export const BUSY_WAIT_MS = 2_000;

/**
 * Runs `work` (one whole transaction) and starts it again while a calendar lock is busy, or after
 * the database aborted it as a deadlock or serialization failure, with a short random pause
 * between tries (no transaction is open during the pause). Still busy after `waitMs`: 429
 * RATE_LIMITED with the calendar's own message. No connection free in the pool is not the
 * calendar's: it goes to the global filter, which answers 503 SERVICE_BUSY with Retry-After, as
 * on every other route (#102 review).
 */
export async function retryWhenBusy<T>(work: () => Promise<T>, waitMs = BUSY_WAIT_MS): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      if (isPoolBusy(error)) throw error;
      if (!(error instanceof LockBusy) && !isRetryable(error)) throw error;
      if (Date.now() >= deadline) throw errors.busy();
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40));
    }
  }
}
