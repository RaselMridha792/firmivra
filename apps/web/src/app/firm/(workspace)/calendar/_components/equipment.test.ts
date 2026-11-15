import { ApiRequestError } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { equipmentChoices, equipmentClashes, equipmentFits } from './equipment';

// Appointments Review 2 (A2): the Schedule form's Equipment choices and a held item's 409.
const main = '0199c0b0-0f10-7000-8000-000000000001';
const riverside = '0199c0b0-0f10-7000-8000-000000000002';
const projector = { id: '0199c0b0-0f30-7000-8000-000000000001', name: 'Projector', officeId: main };
const pad = { id: '0199c0b0-0f30-7000-8000-000000000002', name: 'Signature pad', officeId: null };

describe('equipment on Schedule Appointment', () => {
  it("offers an office's item only in person there, and an any-office item always", () => {
    expect(equipmentFits(projector, 'IN_PERSON', main)).toBe(true);
    expect(equipmentFits(projector, 'IN_PERSON', riverside)).toBe(false);
    expect(equipmentFits(projector, 'VIDEO', main)).toBe(false);
    expect(equipmentFits(pad, 'PHONE', '')).toBe(true);
    expect(equipmentChoices([projector, pad], [], 'VIDEO', '')).toEqual([
      { value: pad.id, label: 'Signature pad' },
    ]);
  });

  it('keeps an item the appointment holds that was archived since, marked', () => {
    const old = { id: '0199c0b0-0f30-7000-8000-000000000009', name: 'Old camera' };
    expect(
      equipmentChoices([pad], [old, { id: pad.id, name: pad.name }], 'IN_PERSON', main),
    ).toEqual([
      { value: pad.id, label: 'Signature pad' },
      { value: old.id, label: 'Old camera (archived)' },
    ]);
  });

  it("reads a held item's names from a 409, and nothing from any other error", () => {
    const result = {
      ok: false,
      conflicts: [
        {
          kind: 'EQUIPMENT',
          staff: null,
          startsAt: '2026-10-15T12:00:00.000Z',
          endsAt: '2026-10-15T12:30:00.000Z',
          message: 'Signature pad is already booked at this time',
        },
        {
          kind: 'ROOM',
          staff: null,
          startsAt: '2026-10-15T12:00:00.000Z',
          endsAt: '2026-10-15T12:30:00.000Z',
          message: 'This room is already booked at this time',
        },
      ],
      alternatives: [],
      canOverride: false,
    };
    const conflict = new ApiRequestError(
      409,
      'SCHEDULING_CONFLICT',
      'This time conflicts.',
      undefined,
      undefined,
      undefined,
      result,
    );
    expect(equipmentClashes(conflict)).toEqual(['Signature pad is already booked at this time']);
    expect(equipmentClashes(new ApiRequestError(409, 'SAVE_CONFLICT', 'Stale'))).toEqual([]);
    expect(equipmentClashes(new Error('offline'))).toEqual([]);
  });
});
