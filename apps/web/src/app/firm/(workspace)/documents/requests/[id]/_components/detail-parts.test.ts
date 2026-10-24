import { describe, expect, it } from 'vitest';
import { activityLook, dueText, packetActions } from './detail-parts';

describe('packetActions', () => {
  it('lets a draft be edited and sent, an open request be reminded and reviewed, a closed one nothing', () => {
    expect(packetActions('DRAFT')).toMatchObject({
      send: true,
      editDraft: true,
      remind: false,
      review: false,
      cancel: true,
    });
    expect(packetActions('SUBMITTED')).toMatchObject({
      send: false,
      editDraft: false,
      remind: true,
      complete: true,
      review: true,
      changeDates: true,
    });
    expect(Object.values(packetActions('COMPLETED')).some(Boolean)).toBe(false);
    expect(Object.values(packetActions('CANCELLED')).some(Boolean)).toBe(false);
  });
});

it('words the due date against today', () => {
  expect(dueText('2026-10-28', '2026-10-25')).toBe('Due in 3 days');
  expect(dueText('2026-10-25', '2026-10-25')).toBe('Due today');
  expect(dueText('2026-10-24', '2026-10-25')).toBe('1 day overdue');
  expect(dueText(null, '2026-10-25')).toBe('No due date');
});

it('groups the activity kinds for their icons', () => {
  expect(activityLook('REQUEST_SENT')).toBe('sent');
  expect(activityLook('UPLOADED')).toBe('received');
  expect(activityLook('SHARED')).toBe('other');
});
