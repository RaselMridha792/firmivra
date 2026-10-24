import { describe, expect, it } from 'vitest';
import { remindersFromType } from './reminder-defaults';

// Schedule Appointment starts from the chosen type's default reminders (Rasel, Oct 24).
const fallback = {
  EMAIL: { on: true, amount: 1, unit: 'DAYS' as const },
  SMS: { on: true, amount: 1, unit: 'DAYS' as const },
  PORTAL: { on: true, amount: 1, unit: 'DAYS' as const },
};
const all = { EMAIL: true, SMS: true, PORTAL: true };

describe('remindersFromType', () => {
  it("turns each channel on with the type's reminder, and off without one", () => {
    const { rows, extra, unavailable } = remindersFromType(
      [
        { channel: 'EMAIL', amount: 2, unit: 'DAYS' },
        { channel: 'PORTAL', amount: 2, unit: 'HOURS' },
      ],
      all,
      fallback,
    );
    expect(rows).toEqual({
      EMAIL: { on: true, amount: 2, unit: 'DAYS' },
      SMS: { on: false, amount: 1, unit: 'DAYS' },
      PORTAL: { on: true, amount: 2, unit: 'HOURS' },
    });
    expect([extra, unavailable]).toEqual([[], []]);
  });

  it('keeps the one sent first per channel; the others are extra', () => {
    const { rows, extra } = remindersFromType(
      [
        { channel: 'EMAIL', amount: 2, unit: 'HOURS' },
        { channel: 'EMAIL', amount: 1, unit: 'WEEKS' },
        { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
      ],
      all,
      fallback,
    );
    expect(rows.EMAIL).toEqual({ on: true, amount: 1, unit: 'WEEKS' });
    expect(extra).toEqual([
      { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
      { channel: 'EMAIL', amount: 2, unit: 'HOURS' },
    ]);
  });

  it("leaves a channel the firm can't send off, and says so", () => {
    const { rows, unavailable } = remindersFromType(
      [{ channel: 'SMS', amount: 1, unit: 'DAYS' }],
      { ...all, SMS: false },
      fallback,
    );
    expect(rows.SMS.on).toBe(false);
    expect(unavailable).toEqual(['SMS']);
  });

  it('turns every channel off for a type without reminders', () => {
    const { rows } = remindersFromType([], all, fallback);
    expect([rows.EMAIL.on, rows.SMS.on, rows.PORTAL.on]).toEqual([false, false, false]);
  });
});
