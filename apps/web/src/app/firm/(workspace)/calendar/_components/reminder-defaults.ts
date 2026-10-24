import type { AppointmentReminder, ReminderChannel, ReminderUnit } from '@firmivra/types';

/** One channel's row on Schedule Appointment's Client Reminders card. */
export interface ChannelReminder {
  on: boolean;
  amount: number;
  unit: ReminderUnit;
}

const UNIT_MINUTES: Record<ReminderUnit, number> = {
  MINUTES: 1,
  HOURS: 60,
  DAYS: 1_440,
  WEEKS: 10_080,
};
const CHANNELS: ReminderChannel[] = ['EMAIL', 'SMS', 'PORTAL'];
const minutes = (r: { amount: number; unit: ReminderUnit }) => r.amount * UNIT_MINUTES[r.unit];

/**
 * The card's rows from an appointment type's default reminders (Rasel, Oct 24: Schedule
 * Appointment starts from the chosen type's reminders, still editable). The card keeps one row
 * per channel (its design), so each channel takes the type's reminder sent first (the longest
 * before); the type's other reminders of that channel are `extra`. A channel the type has none
 * for is off; one the firm can't send (SMS or Portal off) stays off, and its reminders are
 * `unavailable`.
 */
export function remindersFromType(
  defaults: readonly AppointmentReminder[],
  available: Record<ReminderChannel, boolean>,
  fallback: Record<ReminderChannel, ChannelReminder>,
): {
  rows: Record<ReminderChannel, ChannelReminder>;
  extra: AppointmentReminder[];
  unavailable: ReminderChannel[];
} {
  const rows = { ...fallback };
  const extra: AppointmentReminder[] = [];
  const unavailable: ReminderChannel[] = [];
  for (const channel of CHANNELS) {
    const mine = defaults
      .filter((r) => r.channel === channel)
      .sort((a, b) => minutes(b) - minutes(a));
    const [first, ...rest] = mine;
    if (!first) {
      rows[channel] = { ...fallback[channel], on: false };
    } else if (!available[channel]) {
      rows[channel] = { ...fallback[channel], on: false };
      unavailable.push(channel);
    } else {
      rows[channel] = { on: true, amount: first.amount, unit: first.unit };
      extra.push(...rest);
    }
  }
  return { rows, extra, unavailable };
}
