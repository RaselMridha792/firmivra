import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { FirmSlug } from '@firmivra/types';
import { deriveKey, Sealer, type PoolSecrets } from '../../auth/sealed.js';
import { parsePng } from './images.js';
import type {
  CodeHasher,
  EsignCodeKind,
  IssuedToken,
  LinkTokens,
  SignatureImageCheck,
  SignatureImageResult,
  SignerCookie,
  SignerCookieOptions,
  SignerSession,
} from './engine.types.js';

// Signer security (R18 step 5). Nothing here logs: tokens, codes and cookies never reach a log.

// ---------- Signature PNGs ----------

/** A signature or initials image: at most 200 KB and 1600x600 pixels. */
export const SIGNATURE_LIMITS = { maxBytes: 200 * 1024, maxWidth: 1600, maxHeight: 600 } as const;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A real PNG, checked the whole way by parsePng (CRCs, IHDR fields, image data that inflates to
 * exactly its size), within SIGNATURE_LIMITS.
 */
export class PngSignatureCheck implements SignatureImageCheck {
  check(png: Uint8Array): SignatureImageResult {
    if (png.byteLength > SIGNATURE_LIMITS.maxBytes) return { ok: false, reason: 'TOO_MANY_BYTES' };
    if (png.byteLength < 8 || PNG_MAGIC.some((b, i) => png[i] !== b)) return NOT_PNG;
    const parsed = parsePng(png, { strict: true });
    if (!parsed) return NOT_PNG;
    const { width, height } = parsed;
    if (width > SIGNATURE_LIMITS.maxWidth || height > SIGNATURE_LIMITS.maxHeight) {
      return { ok: false, reason: 'TOO_MANY_PIXELS' };
    }
    return { ok: true, width, height };
  }
}
const NOT_PNG = { ok: false, reason: 'NOT_PNG' } as const;

// ---------- Link tokens ----------

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** 32 random bytes, base64url (43 characters); only the hex SHA-256 is stored. */
export class RandomLinkTokens implements LinkTokens {
  issue(): IssuedToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  }

  hash(token: string): string {
    return sha256(token);
  }
}

// ---------- Codes ----------

/** HKDF label of the key that hashes Firm Sign codes; a new label (v2) voids every open code. */
export const ESIGN_CODE_KEY_LABEL = 'fv-esign-code-v1';
/** With AUTH_MODE=local every code is this, as for client sign-up. */
export const LOCAL_ESIGN_CODE = '000000';
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** HMAC-SHA256 of recipient, kind and code, under a key derived from the clients pool's secret. */
export class HmacCodeHasher implements CodeHasher {
  private readonly key: Uint8Array;

  constructor(
    secrets: PoolSecrets,
    private readonly localMode: boolean,
  ) {
    const secret = secrets.CLIENT;
    if (!secret) throw new Error('No key for Firm Sign codes');
    this.key = deriveKey(secret, 'CLIENT', ESIGN_CODE_KEY_LABEL);
  }

  generate(): string {
    return this.localMode ? LOCAL_ESIGN_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  hash(recipientId: string, kind: EsignCodeKind, code: string): string {
    return createHmac('sha256', this.key)
      .update(`${recipientId}\n${kind}\n${code}`, 'utf8')
      .digest('hex');
  }

  verify(recipientId: string, kind: EsignCodeKind, code: string, storedHash: string): boolean {
    if (!HEX_SHA256.test(storedHash)) return false;
    const actual = Buffer.from(this.hash(recipientId, kind, code), 'hex');
    return timingSafeEqual(actual, Buffer.from(storedHash, 'hex'));
  }
}

// ---------- The signer cookie ----------

/** HKDF label of the signer cookie's key. */
export const SIGNER_COOKIE_LABEL = 'fv-esign-signer-v1';

const Sealed = z.object({
  pool: z.literal('CLIENT'),
  slug: z.string(),
  businessId: z.uuid(),
  requestId: z.uuid(),
  recipientId: z.uuid(),
  tokenVersion: z.number().int().min(0),
  purpose: z.enum(['SIGN', 'COPY']),
  emailCodePassed: z.boolean(),
  accessCodePassed: z.boolean(),
  consentVersionId: z.uuid().nullable(),
});

/**
 * fv_sign_{slug}: the signer's session after opening their link, sealed (JWE) with the clients
 * pool's key and bound to its slug, so it never opens on another firm's signing routes.
 * HttpOnly, SameSite=Strict (set by a same-site call after the signing page loads).
 */
export class SealedSignerCookie implements SignerCookie {
  private readonly sealer: Sealer<z.infer<typeof Sealed>>;

  constructor(
    secrets: PoolSecrets,
    private readonly secure: boolean,
  ) {
    this.sealer = new Sealer(SIGNER_COOKIE_LABEL, Sealed, secrets);
  }

  name(slug: string): string {
    return `fv_sign_${checkSlug(slug)}`;
  }

  options(slug: string, ttlSeconds: number): SignerCookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: `/api/v1/portal/${checkSlug(slug)}/sign`,
      maxAge: ttlSeconds * 1000,
    };
  }

  seal(session: SignerSession, ttlSeconds: number): Promise<string> {
    checkSlug(session.slug);
    return this.sealer.seal({ pool: 'CLIENT', ...session }, ttlSeconds);
  }

  async open(slug: string, value: string): Promise<SignerSession | undefined> {
    const opened = await this.sealer.open(value, 'CLIENT');
    if (!opened || opened.value.slug !== slug) return undefined;
    const { pool: _pool, ...session } = opened.value;
    return session;
  }
}

/** The slug as routes see it (FirmSlug, already lower case); anything else is a bug. */
function checkSlug(slug: string): string {
  if (FirmSlug.safeParse(slug).data !== slug) throw new Error('Not a firm slug');
  return slug;
}
