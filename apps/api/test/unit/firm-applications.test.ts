import { describe, expect, it } from 'vitest';
import { FirmId } from '@firmivra/types';
import {
  firmIdFor,
  ownerInviteStatus,
  slugBase,
  startOfMonthIn,
} from '../../src/firm-applications/firm-applications.service.js';

describe('startOfMonthIn: "this month" on the counts, in US Eastern time', () => {
  it('starts at midnight on the 1st in New York, summer and winter', () => {
    expect(startOfMonthIn('America/New_York', new Date('2026-10-15T12:00:00Z')).toISOString()).toBe(
      '2026-10-01T04:00:00.000Z',
    );
    expect(startOfMonthIn('America/New_York', new Date('2026-01-15T12:00:00Z')).toISOString()).toBe(
      '2026-01-01T05:00:00.000Z',
    );
  });

  it("uses New York's date, not UTC's, near midnight", () => {
    // 1 Nov 02:00 UTC is still 31 Oct in New York.
    expect(startOfMonthIn('America/New_York', new Date('2026-11-01T02:00:00Z')).toISOString()).toBe(
      '2026-10-01T04:00:00.000Z',
    );
  });
});

describe('slugBase: the portal address approve suggests', () => {
  it('turns the legal name into lower-case words with single hyphens', () => {
    expect(slugBase('Sample Tax & Partners, LLC')).toBe('sample-tax-partners-llc');
    expect(slugBase('  --Ünïcode Only--  ')).toBe('n-code-only');
    expect(slugBase('&&&')).toBe('firm');
  });

  it('cuts long names before trimming, so it never ends in a hyphen', () => {
    const slug = slugBase(`Example ${'x'.repeat(47)} & Partners`);
    expect(slug.length).toBeLessThanOrEqual(56);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('firmIdFor: the id of the firm an application creates', () => {
  const app = '0199b6a2-0000-7000-8000-000000000001';

  it('is the same on every attempt, and differs per application', () => {
    expect(firmIdFor(app)).toBe(firmIdFor(app));
    expect(firmIdFor(app.toUpperCase())).toBe(firmIdFor(app));
    expect(firmIdFor('0199b6a2-0000-7000-8000-000000000002')).not.toBe(firmIdFor(app));
    expect(firmIdFor(app)).not.toBe(app);
  });

  it('is a version 8 UUID that the contract accepts', () => {
    const id = firmIdFor(app);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(FirmId.safeParse(id).success).toBe(true);
  });
});

describe('ownerInviteStatus: the owner link on the review page', () => {
  const now = new Date('2026-10-08T12:00:00Z');

  it('is SENT until it expires, then EXPIRED; ACCEPTED once the owner joined', () => {
    expect(ownerInviteStatus('2026-10-15T12:00:00.000Z', null, now)).toBe('SENT');
    expect(ownerInviteStatus('2026-10-08T12:00:00.000Z', null, now)).toBe('EXPIRED');
    expect(ownerInviteStatus('2026-10-01T12:00:00.000Z', new Date('2026-10-02'), now)).toBe(
      'ACCEPTED',
    );
  });
});
