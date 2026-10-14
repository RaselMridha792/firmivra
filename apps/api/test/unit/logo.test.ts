// The logo's type and size checks (from the bytes, never the name), its public address and its
// place in emails.
import { describe, expect, it, vi } from 'vitest';
import { LOGO_LIMITS, logoFileProblem } from '@firmivra/types';
import { BrandingSource } from '../../src/notify/branding.js';
import {
  checkLogo,
  logoExtension,
  logoTypeOfKey,
  logoUrl,
  sniffLogoType,
} from '../../src/settings/logo-checks.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Uint8Array.from([...Buffer.from('RIFF'), 1, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);

describe('sniffLogoType and checkLogo', () => {
  it('knows PNG, JPEG and WebP by their bytes', () => {
    expect(sniffLogoType(PNG)).toBe('image/png');
    expect(sniffLogoType(JPEG)).toBe('image/jpeg');
    expect(sniffLogoType(WEBP)).toBe('image/webp');
  });

  it('refuses SVG, GIF, text and an empty file whatever they are called', () => {
    for (const bytes of [
      Buffer.from('<svg/>'),
      Buffer.from('GIF89a'),
      Buffer.from('hi'),
      new Uint8Array(),
    ]) {
      expect(sniffLogoType(bytes)).toBeNull();
      expect(checkLogo('image/png', bytes)).toBe('UPLOAD_MISMATCH');
    }
    // RIFF without WEBP (a WAV, say) is not a WebP.
    expect(sniffLogoType(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
  });

  it('accepts a file only as the type it says it is', () => {
    expect(checkLogo('image/png', PNG)).toBeNull();
    expect(checkLogo('image/jpeg', PNG)).toBe('UPLOAD_MISMATCH');
    expect(checkLogo('image/webp', JPEG)).toBe('UPLOAD_MISMATCH');
  });

  it('allows 2 MB exactly and refuses one byte more', () => {
    const file = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(PNG);
      return bytes;
    };
    expect(checkLogo('image/png', file(LOGO_LIMITS.maxBytes))).toBeNull();
    expect(checkLogo('image/png', file(LOGO_LIMITS.maxBytes + 1))).toBe('LOGO_TOO_BIG');
  });
});

describe('logoFileProblem (the screens check before sending)', () => {
  it('names the wrong type first, then the size', () => {
    expect(logoFileProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(logoFileProblem({ type: 'image/webp', size: LOGO_LIMITS.maxBytes })).toBeNull();
    expect(logoFileProblem({ type: 'image/svg+xml', size: 10 })).toBe('LOGO_WRONG_TYPE');
    expect(logoFileProblem({ type: '', size: 10 })).toBe('LOGO_WRONG_TYPE');
    expect(logoFileProblem({ type: 'image/jpeg', size: LOGO_LIMITS.maxBytes + 1 })).toBe(
      'LOGO_TOO_BIG',
    );
  });
});

describe('the public address', () => {
  it('is on the portal host and null without a logo', () => {
    const key = 'tenant/b1/logo/0b5e.png';
    expect(logoUrl('https://portal.firmivra.com/', 'lvp', key)).toBe(
      'https://portal.firmivra.com/api/v1/portal/lvp/logo?v=0b5e',
    );
    expect(logoUrl('https://portal.firmivra.com', 'lvp', key, 'light')).toBe(
      'https://portal.firmivra.com/api/v1/portal/lvp/logo?variant=light&v=0b5e',
    );
    expect(logoUrl('https://portal.firmivra.com', 'lvp', null)).toBeNull();
    expect(logoTypeOfKey(key)).toBe('image/png');
    expect(logoTypeOfKey(`x/y.${logoExtension('image/jpeg')}`)).toBe('image/jpeg');
    expect(logoTypeOfKey(`x/y.${logoExtension('image/webp')}`)).toBe('image/webp');
  });
});

describe('emails', () => {
  const load = (portalOrigin: string | undefined, logoKey: string | null) => {
    const forBusiness = vi.fn(() => ({
      business: { findUnique: () => Promise.resolve({ name: 'LVP', slug: 'lvp' }) },
      businessSettings: {
        findUnique: () =>
          Promise.resolve({
            brandColor: null,
            accentColor: null,
            timezone: null,
            logoLightKey: logoKey,
          }),
      },
    }));
    return new BrandingSource({ forBusiness } as never, portalOrigin).load(
      '6f1c1f3e-0000-4000-8000-000000000001',
    );
  };

  it("carry the firm's lasting address of the logo for light backgrounds, or none", async () => {
    const key = 'tenant/b1/logo/0b5e.webp';
    expect((await load('https://portal.firmivra.com', key)).logoUrl).toBe(
      'https://portal.firmivra.com/api/v1/portal/lvp/logo?variant=light&v=0b5e',
    );
    expect((await load('https://portal.firmivra.com', null)).logoUrl).toBeNull();
    expect((await load(undefined, key)).logoUrl).toBeNull();
  });
});
