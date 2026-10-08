import { describe, expect, it } from 'vitest';
import {
  likeEscape,
  ownerNameOk,
  slugBase,
  startOfMonthIn,
} from '../../src/firm-applications/firm-applications.service.js';

describe('likeEscape: search terms and compared names are plain text', () => {
  it('makes LIKE wildcards and the escape character plain', () => {
    expect(likeEscape('100%')).toBe('100\\%');
    expect(likeEscape('Tax_Group')).toBe('Tax\\_Group');
    expect(likeEscape('back\\slash')).toBe('back\\\\slash');
    expect(likeEscape('%_\\')).toBe('\\%\\_\\\\');
    expect(likeEscape('plain')).toBe('plain');
  });
});

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

describe('ownerNameOk: what the owner invite takes (R0 invites_name)', () => {
  it('takes up to 120 characters, counted as the database counts them', () => {
    expect(ownerNameOk('Casey Example')).toBe(true);
    expect(ownerNameOk('L'.repeat(120))).toBe(true);
    expect(ownerNameOk('L'.repeat(121))).toBe(false);
    // 120 code points, 240 UTF-16 units: char_length is 120.
    expect(ownerNameOk('😀'.repeat(120))).toBe(true);
  });

  it('refuses a blank name and control characters', () => {
    expect(ownerNameOk('   ')).toBe(false);
    expect(ownerNameOk('Casey\tExample')).toBe(false);
    expect(ownerNameOk('Casey\nExample')).toBe(false);
    expect(ownerNameOk('Casey\u0085Example')).toBe(false);
  });
});
