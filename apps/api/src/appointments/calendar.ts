import { BadRequestException } from '@nestjs/common';
import type { FirmWorkingHours, FirmAppointmentType } from '@firmivra/types';
export const MINUTE = 60_000;
type Window = { startsAt: string; endsAt: string };
export const overlap = (a: number, b: number, c: number, d: number) => a < d && c < b;
export function validateRange(from: string, to: string, maxDays = 31) {
  const a = new Date(from).getTime(),
    b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > maxDays * 86400000)
    throw new BadRequestException({
      code: 'INVALID_RANGE',
      message: `Range must be positive and at most ${maxDays} days`,
    });
  return [a, b] as const;
}
export function validateHours(hours: FirmWorkingHours[]) {
  for (const row of hours)
    if (row.startMinute >= row.endMinute)
      throw new BadRequestException({
        code: 'INVALID_WORKING_HOURS',
        message: 'Working hours must have positive duration',
      });
  for (let i = 0; i < hours.length; i++)
    for (let j = i + 1; j < hours.length; j++)
      if (
        hours[i]!.weekday === hours[j]!.weekday &&
        overlap(
          hours[i]!.startMinute,
          hours[i]!.endMinute,
          hours[j]!.startMinute,
          hours[j]!.endMinute,
        )
      )
        throw new BadRequestException({
          code: 'OVERLAPPING_WORKING_HOURS',
          message: 'Working hours must not overlap',
        });
}
export function localClock(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return (instant: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    return {
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!),
      minute: Number(parts.hour) * 60 + Number(parts.minute),
    };
  };
}
export function insideHours(
  start: number,
  end: number,
  hours: FirmWorkingHours[],
  timezone: string,
) {
  const clock = localClock(timezone);
  for (let instant = Math.floor(start / MINUTE) * MINUTE; instant < end; instant += MINUTE) {
    const local = clock(instant);
    if (
      !hours.some(
        (row) =>
          row.weekday === local.weekday &&
          row.startMinute <= local.minute &&
          local.minute < row.endMinute,
      )
    )
      return false;
  }
  return end > start;
}
/** Scan actual UTC minutes: DST gaps never create slots and folds retain both real instants. */
export function availableSlots(input: {
  from: string;
  to: string;
  timezone: string;
  type: Pick<FirmAppointmentType, 'durationMinutes' | 'bufferBeforeMinutes' | 'bufferAfterMinutes'>;
  hours: FirmWorkingHours[];
  blocked: Window[];
  occupied: Window[];
  now?: number;
}) {
  const [from, to] = validateRange(input.from, input.to),
    clock = localClock(input.timezone),
    duration = input.type.durationMinutes * MINUTE,
    before = input.type.bufferBeforeMinutes * MINUTE,
    after = input.type.bufferAfterMinutes * MINUTE;
  const base = Math.floor((from - before) / MINUTE) * MINUTE,
    end = Math.ceil((to + after) / MINUTE) * MINUTE;
  const prefix = [0];
  for (let t = base; t < end; t += MINUTE) {
    const local = clock(t),
      valid = input.hours.some(
        (row) =>
          row.weekday === local.weekday &&
          row.startMinute <= local.minute &&
          local.minute < row.endMinute,
      );
    prefix.push(prefix.at(-1)! + (valid ? 0 : 1));
  }
  const busy = [...input.blocked, ...input.occupied].map(
      (row) => [new Date(row.startsAt).getTime(), new Date(row.endsAt).getTime()] as const,
    ),
    slots: Window[] = [];
  for (let t = Math.ceil(from / MINUTE) * MINUTE; t + duration <= to; t += MINUTE) {
    if (t <= (input.now ?? Date.now())) continue;
    const local = clock(t);
    if (
      !input.hours.some(
        (row) =>
          row.weekday === local.weekday &&
          (local.minute - row.startMinute) % input.type.durationMinutes === 0,
      )
    )
      continue;
    const a = t - before,
      b = t + duration + after,
      i = (a - base) / MINUTE,
      j = (b - base) / MINUTE;
    if (prefix[j] !== prefix[i] || busy.some(([c, d]) => overlap(a, b, c, d))) continue;
    if (slots.length === 1000)
      return { timezone: input.timezone, slots, nextFrom: new Date(t).toISOString() };
    slots.push({
      startsAt: new Date(t).toISOString(),
      endsAt: new Date(t + duration).toISOString(),
    });
  }
  return { timezone: input.timezone, slots, nextFrom: null };
}
