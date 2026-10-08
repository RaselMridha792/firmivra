import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { databaseErrorCode } from '@firmivra/db';
import type { AppointmentErrorCode } from '@firmivra/types';

const conflict = (
  code: AppointmentErrorCode | 'CLIENT_ARCHIVED' | 'CUTOFF_NOT_SUPPORTED',
  message: string,
) => new ConflictException({ code, message });

/** The errors of the appointment routes (codes in packages/types/src/appointments). */
export const errors = {
  notFound: () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' }),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' }),
  slotTaken: () => conflict('SLOT_TAKEN', 'Someone else just took this time. Pick another.'),
  slotUnavailable: () => conflict('SLOT_UNAVAILABLE', 'This time is not available'),
  windowClosed: () =>
    conflict(
      'CHANGE_WINDOW_CLOSED',
      'It is too late to change this online. Please contact the firm.',
    ),
  closed: () => conflict('APPOINTMENT_CLOSED', 'This appointment can no longer change'),
  typeArchived: () => conflict('TYPE_ARCHIVED', 'This appointment type is archived'),
  blocksAppointment: () =>
    conflict('BLOCKS_APPOINTMENT', 'An appointment is scheduled in this time. Move it first.'),
  blockLimit: () =>
    conflict('BLOCK_LIMIT', 'This calendar has too many blocks. Delete some first.'),
  duplicateName: () =>
    conflict('DUPLICATE_NAME', 'An appointment type with this name already exists'),
  /** R10's code: nothing new is booked for an archived client (restore the client first). */
  clientArchived: () => conflict('CLIENT_ARCHIVED', 'Restore the client first'),
  /** The same in the portal, worded for the client. */
  clientArchivedPortal: () =>
    conflict('CLIENT_ARCHIVED', 'Please contact the firm to book an appointment.'),
  /**
   * appointment_types.cancel_cutoff_hours is not in the schema yet (asked of R0): until it is,
   * every type has the 24-hour window and any other value is refused.
   */
  cutoffNotSupported: () =>
    conflict(
      'CUTOFF_NOT_SUPPORTED',
      'For now every appointment type has a 24-hour change window: send 24 or leave it out.',
    ),
  /**
   * A calendar lock stayed busy (another change of the same calendar held it for 2 s): answered
   * like the rate limit (429 RATE_LIMITED) with a message of its own. A database with no
   * connection free is the global filter's 503 SERVICE_BUSY instead.
   */
  busy: () =>
    new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'This calendar is busy with another change. Try again in a moment.',
        // The global filter sends it as Retry-After.
        retryAfter: 2,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
};

/** The database's own message behind a Prisma error (the pg adapter keeps it), or ''. */
function databaseMessage(error: unknown): string {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta
    ?.driverAdapterError?.cause as { originalMessage?: unknown; message?: unknown } | undefined;
  const message = cause?.originalMessage ?? cause?.message;
  return typeof message === 'string' ? message : '';
}

/**
 * Whether the database refused a time because it is taken: the exclusion constraints that stop
 * double booking of a staff member or a client (23P01), or the appointments trigger's check
 * against blocked time (check_violation with its message). R0's rules in
 * packages/db/prisma/migrations/*_r0_appointments.
 */
export function isSlotConflict(error: unknown): boolean {
  const code = databaseErrorCode(error);
  if (code === '23P01') return true;
  return code === '23514' && databaseMessage(error).includes('overlaps blocked time');
}

/** Whether the staff member's exclusion constraint refused the time (not the client's). */
export function isStaffConflict(error: unknown): boolean {
  return (
    databaseErrorCode(error) === '23P01' &&
    databaseMessage(error).includes('appointments_no_double_booking_staff')
  );
}

/** Whether a unique index refused the write (Prisma P2002, or the raw SQLSTATE). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    (error as { code?: unknown } | null)?.code === 'P2002' || databaseErrorCode(error) === '23505'
  );
}

/**
 * Prisma could not get a connection from the pool (P2024) or start the transaction in time
 * (P2028): the database is busy, not broken.
 */
export function isPoolBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2024' || code === 'P2028';
}

/**
 * The database gave up on the transaction and it is safe to run it again: a deadlock (40P01) or
 * a serialization failure (40001); Prisma names both P2034. Two bookings that insert conflicting
 * rows at the same moment can deadlock in the exclusion constraints' checks (PostgreSQL aborts
 * one of them); run again, the loser meets the winner's row and answers 409 SLOT_TAKEN.
 */
export function isRetryable(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === 'P2034') return true;
  const code = databaseErrorCode(error);
  return code === '40P01' || code === '40001';
}
