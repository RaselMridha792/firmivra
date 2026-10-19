// R55: Company Profile & Branding helpers: brand image sniffing, keys, public addresses, contrast.
import { describe, expect, it } from 'vitest';
import {
  brandAssetOfPath,
  brandAssetUrl,
  imageTypeOfKey,
  sniffImage,
} from '../../src/settings/brand-assets.service.js';
import { contrast } from '../../src/settings/branding.service.js';

describe('brand images', () => {
  it('knows PNG, JPEG, WebP and ICO by their bytes, never SVG', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    ).toBe('image/webp');
    expect(sniffImage(Buffer.from([0, 0, 1, 0, 1]))).toBe('image/x-icon');
    expect(sniffImage(Buffer.from('<svg/>'))).toBeNull();
  });

  it('maps kinds to public paths and keys to types', () => {
    expect(brandAssetOfPath('login-background')).toBe('LOGIN_BACKGROUND');
    expect(brandAssetOfPath('logo')).toBeNull();
    expect(imageTypeOfKey('tenant/x/branding/favicon/a.ico')).toBe('image/x-icon');
    expect(
      brandAssetUrl('https://portal.example.test/', 'lvp', 'EMAIL_LOGO', 'tenant/x/b/abc.png'),
    ).toBe('https://portal.example.test/api/v1/portal/lvp/branding/email-logo?v=abc');
    expect(brandAssetUrl('https://p.test', 'lvp', 'FAVICON', null)).toBeNull();
  });
});

describe('contrast', () => {
  it('is the WCAG ratio', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrast('#273444', '#f8fafc')).toBeGreaterThan(4.5);
    expect(contrast('#273444', '#333333')).toBeLessThan(4.5);
  });
});
