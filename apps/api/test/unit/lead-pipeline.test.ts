// Unit tests for the Leads pipeline's own logic (R57): phone numbers for texts, the row's derived
// fields (overdue, last contact, priority) and the activity labels, which never carry a note's text.
import { describe, expect, it } from 'vitest';
import {
  activityLabel,
  CLOSED_STATUSES,
  PIPELINE_STATUSES,
  type RowData,
  toE164,
  toRow,
} from '../../src/leads/pipeline.shared.js';

const base = {
  id: '0196a000-0000-7000-8000-000000000001',
  number: 10024,
  firstName: 'Pat',
  lastName: 'Sample',
  businessName: null,
  email: 'pat@example.test',
  phone: null,
  source: 'REFERRAL',
  sourceDetail: null,
  priority: null,
  status: 'SUBMITTED',
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-01T10:00:00Z'),
  archivedAt: null,
  nextActionType: null,
  nextActionAt: null,
  nextActionNote: null,
  preferredContactMethods: ['TEXT', 'PHONE'],
  service: { id: '0196a000-0000-7000-8000-0000000000a1', name: 'Annual Tax' },
  services: [],
  tags: [{ tag: { name: 'Hot' } }],
  assignedMember: null,
  activities: [],
} as unknown as RowData;

describe('toE164', () => {
  it.each([
    ['(555) 010-0100', '+15550100100'],
    ['555-010-0100', '+15550100100'],
    ['1 555 010 0100', '+15550100100'],
    ['+44 20 7946 0958', '+442079460958'],
    ['12345', null],
    ['+123', null],
    ['', null],
    [null, null],
  ])('%s -> %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });
});

describe('toRow', () => {
  const now = new Date('2026-10-10T00:00:00Z');

  it('numbers the lead, maps contact methods and shows an unset priority as Warm', () => {
    expect(toRow(base, now)).toMatchObject({
      number: 'LD-10024',
      priority: 'WARM',
      preferredContact: ['SMS', 'PHONE'],
      services: [{ name: 'Annual Tax' }],
      tags: ['Hot'],
      lastContact: null,
      nextAction: null,
      campaign: null,
    });
  });

  it('marks a next action overdue once it is past, never a close-lead action', () => {
    const due = new Date('2026-10-09T00:00:00Z');
    const row = (type: string, at: Date) =>
      toRow({ ...base, nextActionType: type, nextActionAt: at } as RowData, now).nextAction;
    expect(row('CALL', due)?.overdue).toBe(true);
    expect(row('CALL', new Date('2026-10-11T00:00:00Z'))?.overdue).toBe(false);
    expect(row('CLOSE_LEAD', due)?.overdue).toBe(false);
  });

  it('takes the last contact from the newest contact activity', () => {
    const at = new Date('2026-10-05T09:00:00Z');
    const last = (kind: string) =>
      toRow({ ...base, activities: [{ kind, occurredAt: at }] } as unknown as RowData, now)
        .lastContact;
    expect(last('EMAIL_SENT')).toEqual({ at: at.toISOString(), channel: 'EMAIL' });
    expect(last('SMS_SENT')?.channel).toBe('SMS');
    expect(last('CALL')?.channel).toBe('CALL');
    expect(last('MEETING')?.channel).toBe('APPOINTMENT');
  });
});

describe('activityLabel', () => {
  const act = (kind: string, extra: object = {}) =>
    ({
      id: 'x',
      kind,
      occurredAt: new Date(),
      summary: null,
      status: null,
      metadata: {},
      actor: null,
      ...extra,
    }) as never;

  it('reads like the design and keeps a note out of the label', () => {
    expect(activityLabel(act('CREATED'), 'FACEBOOK_AD')).toBe('Lead created from Facebook Ad');
    expect(activityLabel(act('STATUS_CHANGED', { status: 'DECLINED' }), 'OTHER')).toBe(
      'Status changed to Not Qualified',
    );
    expect(activityLabel(act('ASSIGNED', { metadata: { assigned: false } }), 'OTHER')).toBe(
      'Lead unassigned',
    );
    expect(activityLabel(act('EMAIL_SENT', { summary: 'Welcome' }), 'OTHER')).toBe(
      'Email sent: Welcome',
    );
    expect(activityLabel(act('NOTE', { summary: 'private words' }), 'OTHER')).toBe('Note added');
  });
});

describe('statuses', () => {
  it('has no draft or expired, and closes converted, not qualified and lost leads', () => {
    expect(PIPELINE_STATUSES).not.toContain('DRAFT');
    expect(PIPELINE_STATUSES).not.toContain('EXPIRED');
    expect(CLOSED_STATUSES).toEqual(['CONVERTED', 'DECLINED', 'LOST']);
  });
});
