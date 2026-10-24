import { describe, expect, it } from 'vitest';
import { clockLabel, officeHoursLines, phoneLabel, telHref } from './firm-contact';

const day = (weekday: number, opensAt = '09:00', closesAt = '18:00') => ({
  weekday,
  opensAt,
  closesAt,
});

describe('officeHoursLines', () => {
  it('groups consecutive days with the same hours, Monday first, and closes the rest', () => {
    expect(officeHoursLines([1, 2, 3, 4, 5].map((d) => day(d)))).toEqual([
      { days: 'Monday - Friday', hours: '9:00 AM - 6:00 PM' },
      { days: 'Saturday - Sunday', hours: 'Closed' },
    ]);
  });

  it('keeps a day with other hours, or two intervals, on its own line', () => {
    expect(
      officeHoursLines([
        day(1),
        day(2, '08:30', '12:00'),
        day(2, '13:00', '17:00'),
        day(3),
        day(6, '10:00', '14:00'),
        day(0, '10:00', '14:00'),
      ]),
    ).toEqual([
      { days: 'Monday', hours: '9:00 AM - 6:00 PM' },
      { days: 'Tuesday', hours: '8:30 AM - 12:00 PM, 1:00 PM - 5:00 PM' },
      { days: 'Wednesday', hours: '9:00 AM - 6:00 PM' },
      { days: 'Thursday - Friday', hours: 'Closed' },
      { days: 'Saturday - Sunday', hours: '10:00 AM - 2:00 PM' },
    ]);
  });

  it('shows nothing for an office without hours', () => {
    expect(officeHoursLines([])).toEqual([]);
  });
});

describe('clockLabel, phoneLabel and telHref', () => {
  it('reads a 24-hour time as a clock, and shows and dials a phone number', () => {
    expect(['00:00', '09:05', '12:00', '23:30'].map(clockLabel)).toEqual([
      '12:00 AM',
      '9:05 AM',
      '12:00 PM',
      '11:30 PM',
    ]);
    expect(telHref('(770) 555-0134')).toBe('tel:7705550134');
    expect(telHref('+1 770 555 0134')).toBe('tel:+17705550134');
    expect(phoneLabel('+17705550134')).toBe('(770) 555-0134');
    expect(phoneLabel('+442071234567')).toBe('+442071234567');
    expect(phoneLabel('(770) 555-0134')).toBe('(770) 555-0134');
  });
});
