import { describe, expect, it } from 'vitest';
import { dayAfter, dayOf, expiryOf, permissionText, sizeText } from './share-parts';

describe('share parts', () => {
  it('words the permissions, viewing always first', () => {
    expect(permissionText({ canDownload: false, canUpload: false, canSign: false })).toBe('View');
    expect(permissionText({ canDownload: true, canUpload: true, canSign: false })).toBe(
      'View · Download · Upload',
    );
  });

  it('turns a chosen day into the end of that day and back', () => {
    expect(dayAfter(14, new Date(2026, 9, 25))).toBe('2026-11-08');
    expect(dayOf(expiryOf('2026-11-08'))).toBe('2026-11-08');
    expect(expiryOf('')).toBeNull();
  });

  it('sizes files in KB or MB', () => {
    expect(sizeText(2_516_582)).toBe('2.4 MB');
    expect(sizeText(48_640)).toBe('48 KB');
  });
});
