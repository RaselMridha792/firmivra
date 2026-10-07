import { BadRequestException } from '@nestjs/common';

// Opaque keyset cursors for the R12 lists (tasks, workspaces, reports). A cursor is the last row's
// sort key, base64url-encoded; anything that does not decode to exactly that is 400, like R10's.
// Times and days must be ones Postgres can compare (years 0001 to 9999), so a forged cursor is
// 400 and never reaches the database as an out-of-range value.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALENDAR_DAY = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const badCursor = () =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The cursor is not valid' });

const encode = (...parts: string[]) => Buffer.from(parts.join('|')).toString('base64url');
const decode = (cursor: string) => Buffer.from(cursor, 'base64url').toString('utf8').split('|');

function uuid(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw badCursor();
  return value.toLowerCase();
}

/** An instant exactly as `toISOString()` writes it (so a cursor has one spelling). */
function instant(value: string | undefined): Date {
  if (!value || !INSTANT.test(value)) throw badCursor();
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== value) throw badCursor();
  return at;
}

/** A real calendar day, `YYYY-MM-DD`. */
function calendarDay(value: string | undefined): string {
  if (!value || !CALENDAR_DAY.test(value)) throw badCursor();
  const at = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== value) throw badCursor();
  return value;
}

/** A position in a list ordered by a timestamp, newest first, then by id (descending). */
export interface TimeCursor {
  at: Date;
  id: string;
}

export const encodeTimeCursor = (row: TimeCursor): string =>
  encode('t', row.at.toISOString(), row.id);

export function decodeTimeCursor(cursor: string): TimeCursor {
  const [tag, at, id, ...rest] = decode(cursor);
  if (tag !== 't' || rest.length > 0) throw badCursor();
  return { at: instant(at), id: uuid(id) };
}

/**
 * A position in the tasks list: open tasks first, by due date (no date last) then id; then the
 * closed ones (DONE, CANCELLED) by their last change, newest first, then id (descending).
 */
export type TaskCursor =
  { open: true; dueOn: string | null; id: string } | { open: false; at: Date; id: string };

export function encodeTaskCursor(cursor: TaskCursor): string {
  return cursor.open
    ? encode('o', cursor.dueOn ?? '', cursor.id)
    : encode('c', cursor.at.toISOString(), cursor.id);
}

export function decodeTaskCursor(cursor: string): TaskCursor {
  const [tag, key, id, ...rest] = decode(cursor);
  if (rest.length > 0) throw badCursor();
  if (tag === 'o') return { open: true, dueOn: key ? calendarDay(key) : null, id: uuid(id) };
  if (tag === 'c') return { open: false, at: instant(key), id: uuid(id) };
  throw badCursor();
}
