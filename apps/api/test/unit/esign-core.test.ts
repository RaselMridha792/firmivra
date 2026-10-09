import { describe, expect, it } from 'vitest';
import {
  canonicalIp,
  canonicalJson,
  evidenceSha256,
  hasHiddenCharacters,
  normalizeSignedText,
  sha256Hex,
  signatureMatches,
  storedUserAgent,
} from '../../src/esign/core/evidence.js';

describe('esign core', () => {
  it('canonical JSON sorts keys, drops undefined and normalises strings', () => {
    const composed = 'José';
    const decomposed = 'José';
    expect(canonicalJson({ b: 1, a: [true, null, decomposed], c: undefined })).toBe(
      `{"a":[true,null,"${composed}"],"b":1}`,
    );
    expect(canonicalJson({ at: new Date('2026-10-09T09:00:00Z') })).toBe(
      '{"at":"2026-10-09T09:00:00.000Z"}',
    );
    expect(evidenceSha256({ x: 1, y: 2 })).toBe(evidenceSha256({ y: 2, x: 1 }));
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    expect(() => canonicalJson({ f: () => 1 })).toThrow();
  });

  it('hashes UTF-8 text', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches typed signatures by NFC, spaces and case; finds hidden characters', () => {
    expect(signatureMatches('  sam   SAMPLE ', 'Sam Sample')).toBe(true);
    expect(signatureMatches('José Ruiz', 'josé ruiz')).toBe(true);
    expect(signatureMatches('Sam Sampl', 'Sam Sample')).toBe(false);
    expect(normalizeSignedText('  Sam \t Sample ')).toBe('Sam Sample');
    for (const hidden of ['\u200b', '\u202e', '\u0007', '\u2028', '\ud800', '\u3164']) {
      expect(hasHiddenCharacters(`Sam${hidden}Sample`)).toBe(true);
    }
    // Real names use these.
    for (const kept of ['\u200c', '\u00ad', '\u200e']) {
      expect(hasHiddenCharacters(`Sam${kept}Sample`)).toBe(false);
    }
    expect(hasHiddenCharacters('Sam Sample')).toBe(false);
  });

  it('stores IPs in one spelling and user agents without hidden characters', () => {
    expect(canonicalIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(canonicalIp('2001:db8::1')).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(canonicalIp('not an ip')).toBeNull();
    expect(canonicalIp(undefined)).toBeNull();
    expect(storedUserAgent('Browser\u0000/1.0')).toBe('Browser/1.0');
    expect(storedUserAgent('x'.repeat(600))).toHaveLength(512);
    expect(storedUserAgent('  ')).toBeNull();
  });
});
