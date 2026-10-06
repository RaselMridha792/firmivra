import { describe, expect, it } from 'vitest';
import {
  LegalVersionNumber,
  PublishLegalDocumentRequest,
  SetupStep,
  UpdateFirmSettingsRequest,
} from '../../src/index.js';

const ok = (input: unknown) => UpdateFirmSettingsRequest.safeParse(input).success;

describe('settings input contracts', () => {
  it('refuses identity fields, unknown fields and an empty change', () => {
    for (const input of [
      { businessId: '0199b6a0-0000-7000-8000-000000000001' },
      { slug: 'other-firm' },
      { legalName: 'Renamed LLC' },
      { status: 'ACTIVE' },
      { logoKey: 'tenant/other/logo.png' },
      { enabledModules: ['documents'] },
      {},
      { name: undefined },
    ]) {
      expect(ok(input)).toBe(false);
    }
  });

  it('trims text and turns an empty field into null, which clears it', () => {
    expect(
      UpdateFirmSettingsRequest.parse({
        name: '  LVP Accounting & Taxes ',
        contactPhone: '   ',
        portalHeader: '',
        welcomeMessage: null,
      }),
    ).toEqual({
      name: 'LVP Accounting & Taxes',
      contactPhone: null,
      portalHeader: null,
      welcomeMessage: null,
    });
    expect(ok({ name: '   ' })).toBe(false);
    expect(ok({ portalName: 'x'.repeat(121) })).toBe(false);
    expect(ok({ welcomeMessage: 'x'.repeat(2000) })).toBe(true);
  });

  it('normalises email, colours and country, and checks the time zone', () => {
    expect(
      UpdateFirmSettingsRequest.parse({
        contactEmail: ' Office@LVP.Test ',
        primaryColor: '#1D4ED8',
        country: 'us',
        timezone: 'America/Chicago',
      }),
    ).toEqual({
      contactEmail: 'office@lvp.test',
      primaryColor: '#1d4ed8',
      country: 'US',
      timezone: 'America/Chicago',
    });
    expect(ok({ contactEmail: 'not an email' })).toBe(false);
    expect(ok({ accentColor: 'red' })).toBe(false);
    expect(ok({ country: 'USA' })).toBe(false);
    expect(ok({ timezone: 'Bad/Zone' })).toBe(false);
    expect(ok({ timezone: null })).toBe(false);
    expect(ok({ country: '' })).toBe(false);
  });

  it('accepts only https web addresses on a real domain', () => {
    expect(ok({ website: 'https://lvp.example.com/about' })).toBe(true);
    expect(ok({ website: '' })).toBe(true);
    for (const website of ['http://lvp.example.com', 'javascript:alert(1)', 'https://localhost']) {
      expect(ok({ website })).toBe(false);
    }
  });

  it('checks wizard steps, legal versions and legal text', () => {
    expect(SetupStep.options).toEqual(['branding', 'businessDetails', 'team', 'clientPortal']);
    expect(SetupStep.safeParse('finish').success).toBe(false);
    expect(LegalVersionNumber.safeParse(0).success).toBe(false);
    expect(LegalVersionNumber.safeParse(1.5).success).toBe(false);
    expect(PublishLegalDocumentRequest.safeParse({ body: ' \n ' }).success).toBe(false);
    expect(PublishLegalDocumentRequest.safeParse({ body: 'x'.repeat(100_001) }).success).toBe(
      false,
    );
    expect(PublishLegalDocumentRequest.parse({ body: '# Terms\n' }).body).toBe('# Terms\n');
  });
});
