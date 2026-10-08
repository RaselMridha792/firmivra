// Unit: the EIN-hash key's loader (R4's own settings, fails closed) and the keyed hashes submit
// writes. Keys are random per run; EINs are synthetic (they start with 00).
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { einHash, emailHasher, loadEinHashKey } from '../../src/firm-applications/ein-hash.js';

const hex = randomBytes(32).toString('hex');
const key = Buffer.from(hex, 'hex');

describe('loadEinHashKey', () => {
  it('reads 64 hex characters as 32 bytes, in either case', () => {
    expect(loadEinHashKey({ EIN_HASH_KEY: hex })).toEqual({ ok: true, key });
    expect(loadEinHashKey({ EIN_HASH_KEY: ` ${hex.toUpperCase()}\n` })).toEqual({ ok: true, key });
  });

  it.each([
    ['missing', {}, 'EIN_HASH_KEY is not set'],
    ['empty (`EIN_HASH_KEY=` in .env)', { EIN_HASH_KEY: '' }, 'EIN_HASH_KEY is not set'],
    ['too short', { EIN_HASH_KEY: hex.slice(2) }, 'EIN_HASH_KEY must be 64 hex characters'],
    ['base64', { EIN_HASH_KEY: key.toString('base64') }, 'EIN_HASH_KEY must be 64 hex characters'],
    ['not hex', { EIN_HASH_KEY: `${hex.slice(1)}g` }, 'EIN_HASH_KEY must be 64 hex characters'],
    ['all zeros', { EIN_HASH_KEY: '0'.repeat(64) }, 'EIN_HASH_KEY must not repeat one byte'],
  ])('refuses a key that is %s, naming the setting and never the value', (_, raw, problem) => {
    const value: string | undefined = (raw as { EIN_HASH_KEY?: string }).EIN_HASH_KEY;
    const loaded = loadEinHashKey(raw);
    expect(loaded).toEqual({ ok: false, problem: expect.stringContaining(problem) as string });
    if (!loaded.ok && value) expect(loaded.problem).not.toContain(value);
  });
});

describe('einHash', () => {
  it('is HMAC-SHA256 of the 9 digits with the key: 32 bytes', () => {
    const hash = einHash(key, '001234567');
    expect(hash).toEqual(createHmac('sha256', key).update('001234567').digest());
    expect(hash).toHaveLength(32);
  });

  it('ignores dashes and spaces, and differs by EIN and by key', () => {
    expect(einHash(key, '00-1234567')).toEqual(einHash(key, ' 001 234 567 '));
    expect(einHash(key, '001234568')).not.toEqual(einHash(key, '001234567'));
    expect(einHash(randomBytes(32), '001234567')).not.toEqual(einHash(key, '001234567'));
  });

  it('refuses anything but 9 digits', () => {
    for (const ein of ['', '00123456', '0012345678', '00-12345a7']) {
      expect(() => einHash(key, ein)).toThrow('An EIN has 9 digits');
    }
  });
});

describe('emailHasher', () => {
  it('gives one hex key per address whatever its case, never the address or a plain HMAC', () => {
    const hashed = emailHasher(key);
    const one = hashed('casey@sample.example.test');
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed('Casey@Sample.Example.Test')).toBe(one);
    expect(hashed('drew@sample.example.test')).not.toBe(one);
    // A key of its own, derived from the EIN-hash key.
    expect(one).not.toBe(
      createHmac('sha256', key).update('casey@sample.example.test').digest('hex'),
    );
  });
});
