import type { RequestPacketRow } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { initials, requestActivity, timeAgo } from './requests-parts';

const row = (n: number, view: RequestPacketRow['view'], extra: Partial<RequestPacketRow> = {}) =>
  ({
    id: `0199d2b0-7b00-7000-8000-${String(n).padStart(12, '0')}`,
    reference: `DR-${n}`,
    title: `Request ${n}`,
    client: { id: '0199b6a1-0000-7000-8000-000000000001', name: 'Jamie Sample' },
    service: { id: '0199d2b0-7f00-7000-8000-000000000001', title: 'Personal Tax Intake' },
    recipient: { kind: 'CLIENT', userId: null, name: 'Jamie Sample' },
    status: 'OPEN',
    view,
    items: { total: 4, required: 4, received: 0 },
    dueOn: null,
    expiresAt: null,
    assignedTo: null,
    sentAt: null,
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...extra,
  }) satisfies RequestPacketRow;

describe('requests dashboard parts', () => {
  it("builds Recent Activity from the requests' own dates, newest first", () => {
    const events = requestActivity([
      row(1, 'OUTSTANDING', { sentAt: '2026-10-24T08:00:00.000Z' }),
      row(2, 'COMPLETED', { updatedAt: '2026-10-23T09:00:00.000Z' }),
      row(3, 'OVERDUE', { dueOn: '2026-10-22' }),
      row(4, 'PARTIALLY_RECEIVED', { updatedAt: '2026-10-24T05:00:00.000Z' }),
    ]);
    expect(events.map((e) => [e.kind, e.text])).toEqual([
      ['sent', 'Document request sent to Jamie Sample'],
      ['uploaded', 'Jamie Sample uploaded a document'],
      ['completed', 'Request completed by Jamie Sample'],
      ['overdue', 'Request overdue (Jamie Sample)'],
    ]);
    expect(requestActivity([])).toEqual([]);
  });

  it('says how long ago, and the initials of a name', () => {
    const now = Date.parse('2026-10-24T12:00:00.000Z');
    expect(timeAgo('2026-10-24T10:00:00.000Z', now)).toBe('2 hours ago');
    expect(timeAgo('2026-10-23T12:00:00.000Z', now)).toBe('1 day ago');
    expect(timeAgo('2026-10-24T12:00:00.000Z', now)).toBe('just now');
    expect(initials('Acme Widgets LLC (fake)')).toBe('AW');
  });
});
