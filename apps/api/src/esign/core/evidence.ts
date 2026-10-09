import { createHash } from 'node:crypto';
import { isVisibleSignatureText, signatureNameKey } from '@firmivra/types';
import { canonicalIp as canonicalIpOrUnknown } from '../../common/network.js';

// Signature evidence shared by intake signing (R14) and Firm Sign (R13-api owns this folder once
// it merges). Pure functions: the same input gives the same bytes and the same hash.

/** Control, format (zero-width, bidi) and line or paragraph separator characters (user agents). */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/**
 * True when a signed name holds a character a reader can't see: the contract's one-line rule,
 * so the joiners, soft hyphen and direction marks that real names use pass.
 */
export const hasHiddenCharacters = (value: string): boolean => !isVisibleSignatureText(value);

/** NFC, runs of whitespace as one space, trimmed (what is stored and hashed). */
export const normalizeSignedText = (value: string): string =>
  value.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** A typed signature matches the printed name: NFC, collapsed whitespace and case folded. */
export const signatureMatches = (typed: string, printed: string): boolean =>
  signatureNameKey(typed) === signatureNameKey(printed);

/**
 * Canonical JSON: object keys sorted by code point, no whitespace, strings in NFC, `undefined`
 * fields dropped. Dates as ISO strings. Refuses values JSON can't hold exactly.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: not a finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: cannot encode ${typeof value}`);
  }
}

/** Hex SHA-256 of text (UTF-8) or bytes. */
export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Hex SHA-256 of a value's canonical JSON. */
export const evidenceSha256 = (value: unknown): string => sha256Hex(canonicalJson(value));

/** The viewer's IP in one spelling (IPv4-mapped as IPv4, IPv6 expanded), or null if not an IP. */
export function canonicalIp(ip: string | undefined | null): string | null {
  const canonical = canonicalIpOrUnknown(ip ?? undefined);
  return canonical === 'unknown' ? null : canonical;
}

/** A user agent as stored: hidden characters dropped, at most 512 characters. */
export function storedUserAgent(userAgent: string | undefined | null): string | null {
  const cleaned = (userAgent ?? '').replace(new RegExp(HIDDEN_CHARACTERS, 'gu'), '').trim();
  return cleaned ? cleaned.slice(0, 512) : null;
}
