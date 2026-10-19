// Super Admin broadcast rules (R56 on R0's B6): who an audience reaches on each channel, the
// recipient count, a send's outcome, and the file library's keys.
import { describe, expect, it } from 'vitest';
import {
  type AudiencePerson,
  mediaKey,
  outcomeFromCounts,
  peopleIn,
  reachOf,
} from '../../src/admin-communications/broadcast.rules.js';

const person = (p: Partial<AudiencePerson>): AudiencePerson => ({
  type: 'FIRM',
  businessId: null,
  businessName: null,
  userId: null,
  salesContactId: null,
  name: 'Sample',
  email: null,
  phone: null,
  ...p,
});

describe('reachOf', () => {
  const owner = person({
    type: 'FIRM',
    userId: 'u1',
    email: 'Owner@Firm.example.test',
    phone: '+15125550147',
  });
  const lead = person({
    type: 'LEAD',
    salesContactId: 'l1',
    email: 'lead@example.test',
    phone: '555-0147',
  });
  const mate = person({ type: 'TEAM', userId: 'u2', email: 'owner@firm.example.test' });

  it('reaches email by a valid address, once per address, lowercased', () => {
    const r = reachOf([owner, lead, mate], ['EMAIL']);
    expect(r.map((x) => x.address)).toEqual(['owner@firm.example.test', 'lead@example.test']);
  });

  it('reaches SMS only with an E.164 number and in-app only the team', () => {
    expect(reachOf([owner, lead, mate], ['SMS']).map((x) => x.address)).toEqual(['+15125550147']);
    expect(reachOf([owner, lead, mate], ['IN_APP']).map((x) => x.address)).toEqual(['u2']);
  });

  it('counts distinct people across channels', () => {
    const r = reachOf([owner, lead, mate], ['EMAIL', 'SMS', 'IN_APP']);
    expect(r).toHaveLength(4);
    expect(peopleIn(r)).toBe(3);
    expect(reachOf([person({ email: 'not-an-email' })], ['EMAIL'])).toEqual([]);
  });
});

describe('outcomes and keys', () => {
  it('is sent, partly sent or failed by the counts', () => {
    expect(outcomeFromCounts(3, 0)).toBe('SENT');
    expect(outcomeFromCounts(2, 1)).toBe('PARTIALLY_SENT');
    expect(outcomeFromCounts(0, 2)).toBe('FAILED');
  });

  it('keeps library keys under the platform prefix with safe names', () => {
    const id = '0199c3a0-0000-7000-8000-000000000001';
    expect(mediaKey(id, 'Price list (2026).pdf')).toBe(
      `platform/communications/${id}/Price_list_2026_.pdf`,
    );
    expect(mediaKey(id, '..hidden')).toBe(`platform/communications/${id}/_hidden`);
    expect(mediaKey(id, '###')).toBe(`platform/communications/${id}/_`);
    expect(mediaKey(id, '')).toBe(`platform/communications/${id}/file`);
  });
});
