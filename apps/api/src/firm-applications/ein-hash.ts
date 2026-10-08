import { createHmac, hkdfSync } from 'node:crypto';

/**
 * The key of an application's EIN hash (`firm_applications.ein_hash`, the duplicate-EIN check):
 * EIN_HASH_KEY, 64 hex characters (32 bytes), from R1's secret
 * `firmivra/<env>/firm-applications/ein-hash-key`. Read here, by R4's own loader, not by the API's
 * config: a missing or malformed key stops only submit (503), never the rest of the API. Never
 * rotated: a new key stops every stored hash from matching.
 */
export type EinHashKey = { ok: true; key: Buffer } | { ok: false; problem: string };

/** Nest injection token of the loaded key (tests replace it with their own). */
export const EIN_HASH_KEY = Symbol('EIN_HASH_KEY');

/** The problem names the setting, never its value. */
export function loadEinHashKey(raw: Record<string, string | undefined> = process.env): EinHashKey {
  const value = raw.EIN_HASH_KEY?.trim() ?? '';
  if (value === '') return { ok: false, problem: 'EIN_HASH_KEY is not set' };
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    return { ok: false, problem: 'EIN_HASH_KEY must be 64 hex characters (32 bytes)' };
  }
  const key = Buffer.from(value, 'hex');
  if (key.every((byte) => byte === key[0])) {
    return { ok: false, problem: 'EIN_HASH_KEY must not repeat one byte (such as all zeros)' };
  }
  return { ok: true, key };
}

/** HMAC-SHA256 of the EIN's 9 digits (dashes and spaces dropped): 32 bytes. */
export function einHash(key: Buffer, ein: string): Buffer {
  const digits = ein.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(digits)) throw new Error('An EIN has 9 digits');
  return createHmac('sha256', key).update(digits).digest();
}

/**
 * Turns an applicant's email into the pseudonymous key the submit limits count by (audit rows
 * never hold the email), with a key derived from the EIN-hash key for this use only.
 */
export function emailHasher(key: Buffer): (email: string) => string {
  const derived = Buffer.from(hkdfSync('sha256', key, '', 'fv-firm-application-email-v1', 32));
  return (email) => createHmac('sha256', derived).update(email.toLowerCase()).digest('hex');
}
