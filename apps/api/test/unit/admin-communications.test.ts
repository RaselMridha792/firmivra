// Super Admin Communications rules (R56 on R0's B6): merge fields, destinations, what each
// message state allows, the outcome of a send, error codes the database takes, and the list order.
import { describe, expect, it } from 'vitest';
import {
  contactValues,
  destinationFor,
  errorCodeOf,
  fillMergeFields,
  inFuture,
  isUnread,
  mergeFieldsIn,
  messageRefusal,
  orderConversations,
  outcomeOf,
  sampleValues,
} from '../../src/admin-communications/comm.rules.js';

describe('merge fields', () => {
  it('lists the fields a subject and body use, once, spaces allowed', () => {
    expect(
      mergeFieldsIn(
        'Hi {{ contact.first_name }}',
        'From {{sender.name}} at {{firm.name}}, {{contact.first_name}}',
      ),
    ).toEqual(['contact.first_name', 'sender.name', 'firm.name']);
    expect(mergeFieldsIn(null, 'No fields, {single} braces')).toEqual([]);
  });

  it('fills what it has and reports what it had no value for', () => {
    const values = contactValues({
      name: '  Jordan  Sample ',
      email: null,
      firmName: null,
      senderName: 'Octavia',
    });
    expect(values['contact.first_name']).toBe('Jordan');
    const r = fillMergeFields(
      'Hi {{contact.first_name}} of {{firm.name}} ({{contact.email}})',
      values,
    );
    expect(r.text).toBe('Hi Jordan of  ()');
    expect(r.missing).toEqual(['firm.name', 'contact.email']);
  });

  it('has a sample for every field', () => {
    for (const v of Object.values(sampleValues())) expect(v).toBeTruthy();
  });
});

describe('destinations', () => {
  it('uses the email for email and only an E.164 number for SMS', () => {
    expect(destinationFor('EMAIL', { email: ' a@example.test ', phone: null })).toBe(
      'a@example.test',
    );
    expect(destinationFor('EMAIL', { email: null, phone: '+15125550147' })).toBeNull();
    expect(destinationFor('SMS', { email: null, phone: '+1 (512) 555-0147' })).toBe('+15125550147');
    expect(destinationFor('SMS', { email: null, phone: '512-555-0147' })).toBeNull();
  });
});

describe('message states', () => {
  it('edits, sends and schedules only drafts and scheduled messages', () => {
    for (const a of ['EDIT', 'SEND', 'SCHEDULE'] as const) {
      expect(messageRefusal(a, 'DRAFT')).toBeNull();
      expect(messageRefusal(a, 'SCHEDULED')).toBeNull();
      expect(messageRefusal(a, 'SENT')).toBe('NOT_EDITABLE');
    }
  });

  it('cancels scheduled, retries failed or partial, deletes drafts', () => {
    expect(messageRefusal('CANCEL', 'SCHEDULED')).toBeNull();
    expect(messageRefusal('CANCEL', 'DRAFT')).toBe('NOT_SCHEDULED');
    expect(messageRefusal('RETRY', 'FAILED')).toBeNull();
    expect(messageRefusal('RETRY', 'PARTIALLY_SENT')).toBeNull();
    expect(messageRefusal('RETRY', 'SENT')).toBe('NOT_RETRYABLE');
    expect(messageRefusal('DELETE', 'DRAFT')).toBeNull();
    expect(messageRefusal('DELETE', 'SCHEDULED')).toBe('NOT_DRAFT');
  });

  it('sums a send: all, some or none of the recipients', () => {
    expect(outcomeOf(['SENT', 'SENT'])).toBe('SENT');
    expect(outcomeOf(['SENT', 'FAILED'])).toBe('PARTIALLY_SENT');
    expect(outcomeOf(['FAILED'])).toBe('FAILED');
  });

  it('writes error codes the database accepts', () => {
    expect(errorCodeOf('InvalidRecipient')).toBe('invalid_recipient');
    expect(errorCodeOf('SES: Throttling!')).toBe('ses_throttling_');
    expect(errorCodeOf(undefined)).toBe('send_failed');
    expect(errorCodeOf('42')).toBe('send_failed');
    for (const r of ['InvalidRecipient', 'SES: Throttling!', 'x'.repeat(90)])
      expect(errorCodeOf(r)).toMatch(/^[a-z][a-z0-9_.]{0,59}$/);
  });

  it('schedules only in the future', () => {
    const now = new Date('2026-10-19T12:00:00.000Z');
    expect(inFuture('2026-10-19T12:05:00.000Z', now)).toBe(true);
    expect(inFuture('2026-10-19T11:59:00.000Z', now)).toBe(false);
  });
});

describe('the list', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 19, h));
  const rows = [
    { id: 'a', lastMessageAt: at(9), createdAt: at(1), unread: false },
    { id: 'b', lastMessageAt: at(11), createdAt: at(1), unread: false },
    { id: 'c', lastMessageAt: null, createdAt: at(10), unread: false },
    { id: 'd', lastMessageAt: at(8), createdAt: at(1), unread: true },
  ];

  it('is unread when a message came after my read mark', () => {
    expect(isUnread(at(9), undefined)).toBe(true);
    expect(isUnread(at(9), at(10))).toBe(false);
    expect(isUnread(at(11), at(10))).toBe(true);
    expect(isUnread(null, undefined)).toBe(false);
  });

  it('orders newest, oldest, or unread first', () => {
    expect(orderConversations(rows, 'NEWEST').map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(orderConversations(rows, 'OLDEST').map((r) => r.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(orderConversations(rows, 'UNREAD_FIRST').map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});
