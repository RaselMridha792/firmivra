// Unit tests for R18 step 5, signer security: signature PNG checks (real PNG, 200 KB, 1600x600),
// link tokens (only the SHA-256 kept), the code HMAC (bound to the recipient, constant-time
// compare) and the sealed fv_sign_{slug} cookie (wrong slug, expired, tampered).
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { EsignEngineModule } from '../../src/esign/engine/engine.module.js';
import {
  CODE_HASHER,
  LINK_TOKENS,
  SIGNATURE_IMAGE_CHECK,
  SIGNER_COOKIE,
  type SignerSession,
} from '../../src/esign/engine/engine.types.js';
import {
  HmacCodeHasher,
  LOCAL_ESIGN_CODE,
  PngSignatureCheck,
  RandomLinkTokens,
  SealedSignerCookie,
} from '../../src/esign/engine/signer-security.js';
import { JPG_4X2, png } from './esign-engine-fixtures.js';

const secrets = { CLIENT: 'fake-client-secret', STAFF: 'fake-staff-secret' };

describe('PngSignatureCheck', () => {
  const check = new PngSignatureCheck();

  it('takes a real PNG within the limits', () => {
    expect(check.check(png(1600, 600))).toEqual({ ok: true, width: 1600, height: 600 });
    expect(check.check(png(40, 20))).toEqual({ ok: true, width: 40, height: 20 });
  });

  it('refuses other files and broken PNGs', () => {
    const good = png(40, 20);
    const tampered = good.slice();
    tampered[40] = tampered[40]! ^ 0xff; // inside IDAT: its CRC no longer matches
    const cut = good.slice(0, good.length - 12); // no IEND
    const trailing = new Uint8Array([...good, 0]);
    for (const bytes of [JPG_4X2, tampered, cut, trailing, new Uint8Array(), good.slice(0, 8)]) {
      expect(check.check(bytes)).toEqual({ ok: false, reason: 'NOT_PNG' });
    }
  });

  it('refuses images over 1600x600 and files over 200 KB', () => {
    expect(check.check(png(1601, 10))).toEqual({ ok: false, reason: 'TOO_BIG' });
    expect(check.check(png(10, 601))).toEqual({ ok: false, reason: 'TOO_BIG' });
    const noisy = png(400, 200, { noise: true });
    expect(noisy.byteLength).toBeGreaterThan(200 * 1024);
    expect(check.check(noisy)).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });
});

describe('RandomLinkTokens', () => {
  const tokens = new RandomLinkTokens();

  it('issues 32-byte base64url tokens and keeps only their SHA-256', () => {
    const { token, hash } = tokens.issue();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(tokens.hash(token)).toBe(hash);
    expect(tokens.issue().token).not.toBe(token);
  });
});

describe('HmacCodeHasher', () => {
  const codes = new HmacCodeHasher(secrets, false);
  const recipient = randomUUID();

  it('generates 6-digit codes, 000000 in local mode', () => {
    for (let i = 0; i < 20; i++) expect(codes.generate()).toMatch(/^\d{6}$/);
    expect(new HmacCodeHasher(secrets, true).generate()).toBe(LOCAL_ESIGN_CODE);
  });

  it('verifies the right code for the right recipient only', () => {
    const stored = codes.hash(recipient, '123456');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(codes.verify(recipient, '123456', stored)).toBe(true);
    expect(codes.verify(recipient, '123457', stored)).toBe(false);
    expect(codes.verify(randomUUID(), '123456', stored)).toBe(false);
    expect(codes.verify(recipient, '123456', 'not-a-hash')).toBe(false);
    expect(codes.verify(recipient, '123456', stored.toUpperCase())).toBe(false);
  });

  it('uses its own key: another secret or the sign-up label gives another hash', () => {
    const other = new HmacCodeHasher({ CLIENT: 'another-fake-secret' }, false);
    expect(other.hash(recipient, '123456')).not.toBe(codes.hash(recipient, '123456'));
    expect(() => new HmacCodeHasher({ STAFF: 'x' }, false)).toThrow();
  });
});

describe('SealedSignerCookie', () => {
  afterEach(() => vi.useRealTimers());
  const cookie = new SealedSignerCookie(secrets, true);
  const session: SignerSession = {
    slug: 'lvp',
    businessId: randomUUID(),
    requestId: randomUUID(),
    recipientId: randomUUID(),
    tokenVersion: 2,
    authPassed: false,
  };

  it('names and scopes the cookie per firm', () => {
    expect(cookie.name('lvp')).toBe('fv_sign_lvp');
    expect(cookie.options('lvp', 1800)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/portal/lvp/sign',
      maxAge: 1_800_000,
    });
    expect(() => cookie.name('../x')).toThrow();
    expect(() => cookie.options('LVP', 1)).toThrow();
  });

  it('opens under its own slug only', async () => {
    const sealed = await cookie.seal(session, 600);
    expect(await cookie.open('lvp', sealed)).toEqual(session);
    expect(await cookie.open('other-firm', sealed)).toBeUndefined();
  });

  it('refuses a tampered, expired or foreign cookie', async () => {
    const sealed = await cookie.seal(session, 600);
    const parts = sealed.split('.');
    const tag = parts[4]!;
    parts[4] = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    expect(await cookie.open('lvp', parts.join('.'))).toBeUndefined();
    expect(await cookie.open('lvp', 'garbage')).toBeUndefined();

    const foreign = new SealedSignerCookie({ CLIENT: 'another-fake-secret' }, true);
    expect(await foreign.open('lvp', sealed)).toBeUndefined();

    vi.useFakeTimers({ now: Date.now() + 601_000 });
    expect(await cookie.open('lvp', sealed)).toBeUndefined();
  });
});

describe('EsignEngineModule', () => {
  it('provides the signer security services', async () => {
    process.env.S3_DOCUMENTS_BUCKET ??= 'fake-bucket';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(loadEnv()), EsignEngineModule],
    }).compile();
    expect(moduleRef.get(SIGNATURE_IMAGE_CHECK)).toBeInstanceOf(PngSignatureCheck);
    expect(moduleRef.get(LINK_TOKENS)).toBeInstanceOf(RandomLinkTokens);
    expect(moduleRef.get(CODE_HASHER)).toBeInstanceOf(HmacCodeHasher);
    expect(moduleRef.get(SIGNER_COOKIE)).toBeInstanceOf(SealedSignerCookie);
    await moduleRef.close();
  });
});
