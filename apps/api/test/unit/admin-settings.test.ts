// Super Admin System Settings (R55): the sections' mapping (the database's keys kept, the page's
// beside them), the default sets' older shape, and the brand image check.
import { describe, expect, it } from 'vitest';
import { imageMatches } from '../../src/admin-settings/admin-branding.service.js';
import {
  firmDefaultsOf,
  userDefaultsOf,
} from '../../src/admin-settings/admin-operations.service.js';
import {
  brandingOf,
  brandingValue,
  changedFields,
  emailOf,
  generalOf,
  generalValue,
} from '../../src/admin-settings/settings.mappers.js';

const SEEDED_GENERAL = {
  platformName: 'Firmivra',
  defaultTimeZone: 'America/New_York',
  defaultLocale: 'en-US',
  defaultCurrency: 'USD',
  dateFormat: 'MM/DD/YYYY',
  supportEmail: null,
  supportPhone: null,
};

describe('sections', () => {
  it("reads the migration's General with defaults for the page's own fields, and writes them beside", () => {
    const g = generalOf(SEEDED_GENERAL);
    expect(g).toMatchObject({
      platformName: 'Firmivra',
      timeFormat: '12H',
      preferences: { betaFeatures: false },
    });
    const next = generalValue(
      { ...SEEDED_GENERAL, legacyKey: 1 },
      { ...g, tagline: 'Fake tagline' },
    );
    expect(next).toMatchObject({
      legacyKey: 1,
      defaultTimeZone: 'America/New_York',
      tagline: 'Fake tagline',
    });
    expect(generalOf(next)).toEqual({ ...g, tagline: 'Fake tagline' });
  });

  it("keeps Branding's checked keys the database's", () => {
    const seeded = {
      primaryAccent: null,
      secondaryAccent: null,
      appearance: 'SYSTEM',
      allowUserAppearance: true,
    };
    const b = brandingOf(seeded);
    const next = brandingValue(seeded, {
      ...b,
      colors: { ...b.colors, primary: '#0066FF', sidebar: '#0B2A52' },
    });
    expect(next).toMatchObject({
      primaryAccent: '#0066FF',
      colors: { sidebar: '#0B2A52' },
      appearance: 'SYSTEM',
    });
    expect(brandingOf(next).colors).toMatchObject({ primary: '#0066FF', sidebar: '#0B2A52' });
    expect(brandingOf({ primaryAccent: 'red' }).colors.primary).toBeNull();
  });

  it("reads the migration's Email", () => {
    expect(
      emailOf({
        fromName: 'Firmivra',
        fromEmail: null,
        channels: { email: true, sms: true, inApp: true, push: false },
        maxRetries: 3,
      }),
    ).toMatchObject({
      fromName: 'Firmivra',
      channels: { push: false },
      maxRetries: 3,
      recipients: { billing: 'SUPER_ADMINS' },
    });
  });

  it('lists changed fields, with values only for short plain ones', () => {
    expect(
      changedFields({ a: 1, b: 'x', c: 'same' }, { a: 2, b: 'y'.repeat(50), c: 'same', d: true }),
    ).toEqual({
      a: { from: 1, to: 2 },
      b: { changed: true },
      d: { from: null, to: true },
    });
  });
});

describe('default sets', () => {
  it('reads the seeded version 1 (regional, notifications, features {})', () => {
    expect(
      firmDefaultsOf({
        regional: { timeZone: 'America/Chicago', locale: null },
        notifications: { email: true, sms: false, inApp: true },
        features: {},
      }),
    ).toMatchObject({
      timeZone: 'America/Chicago',
      features: [],
      trialDays: 14,
      notifications: { sms: false },
    });
    expect(
      userDefaultsOf({ regional: { timeZone: null, locale: 'en-US' }, appearance: null }),
    ).toMatchObject({
      role: 'STAFF',
      locale: 'en-US',
      appearance: null,
    });
  });
});

describe('brand images', () => {
  it('checks the image signature against the declared type', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(imageMatches('image/png', png)).toBe(true);
    expect(imageMatches('image/jpeg', png)).toBe(false);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    expect(imageMatches('image/webp', webp)).toBe(true);
    expect(
      imageMatches(
        'image/webp',
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]),
      ),
    ).toBe(false);
    expect(imageMatches('image/x-icon', Buffer.from([0, 0, 1, 0, 1]))).toBe(true);
  });
});
