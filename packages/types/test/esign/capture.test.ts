import { describe, expect, it } from 'vitest';
import { SignatureCaptureInput, SignatureMethod, signatureNameKey } from '../../src/index.js';

const capture = (printedName: string, typedSignature: string, method: string = 'TYPED') =>
  SignatureCaptureInput.safeParse({ printedName, method, typedSignature });

describe('signature capture', () => {
  it('takes SignatureMethod from the database enums, with all three values', () => {
    expect(SignatureMethod.options).toEqual(['TYPED', 'DRAWN', 'UPLOADED']);
  });

  it('matches the typed signature to the printed name after NFC, spaces and case', () => {
    expect(capture('Lena Lead', 'Lena Lead').success).toBe(true);
    expect(capture('  Lena   Lead ', 'lena lead').success).toBe(true);
    // \u00e9 as one code point and as e + combining accent.
    expect(capture('Ren\u00e9 Roe', 'Rene\u0301 roe').success).toBe(true);
    expect(signatureNameKey('A\u00a0 B')).toBe('a b');
  });

  it('refuses a different name, an empty one, or hidden characters', () => {
    const mismatch = capture('Lena Lead', 'Lena Leed');
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.path).toEqual(['typedSignature']);
    expect(capture('   ', '   ').success).toBe(false);
    // Zero-width space, bidi override, bell, line separator, lone surrogate, tag character.
    for (const hidden of ['\u200b', '\u202e', '\u0007', '\u2028', '\ud800', '\u{e0041}']) {
      expect(capture(`Lena${hidden} Lead`, `Lena${hidden} Lead`).success).toBe(false);
    }
    // A name of blank-looking fillers only.
    expect(capture('\u3164\u3164', '\u3164\u3164').success).toBe(false);
    expect(capture('x'.repeat(201), 'x'.repeat(201)).success).toBe(false);
  });

  it('keeps the joiners, soft hyphen and direction marks real names use, and trims first', () => {
    for (const name of ['Mehr\u200cdad Roe', 'Ana\u00adMaria Roe', 'Sam\u200e Roe']) {
      expect(capture(name, name).success).toBe(true);
    }
    expect(capture(` ${'x'.repeat(200)} `, 'x'.repeat(200)).success).toBe(true);
  });

  it('is typed only for now, and refuses unknown fields', () => {
    expect(capture('Lena Lead', 'Lena Lead', 'DRAWN').success).toBe(false);
    expect(
      SignatureCaptureInput.safeParse({
        printedName: 'A B',
        method: 'TYPED',
        typedSignature: 'A B',
        imageKey: 'x',
      }).success,
    ).toBe(false);
  });
});
