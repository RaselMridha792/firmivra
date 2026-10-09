// Unit tests for R3 sign-up pieces: the code sender stand-in, phone masking, Cognito attributes,
// and the sign-ups queue's linking rule and paging cursor (step 4).
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  type CognitoClient,
  CognitoIdentityProvider,
} from '../../src/auth/identity/cognito-identity.provider.js';
import { LogClientCodeSender } from '../../src/client-auth/client-code-sender.js';
import { linkable } from '../../src/client-auth/client-records.js';
import { decodeCursor, encodeCursor } from '../../src/client-auth/client-sign-ups.service.js';
import {
  atLeast,
  canonicalIp,
  maskPhone,
  networkOf,
} from '../../src/client-auth/sign-up.service.js';
import { VerificationCodesService } from '../../src/client-auth/verification-codes.service.js';
import { loadEnv } from '../../src/config/env.js';

describe('LogClientCodeSender (until R6)', () => {
  const businessId = '0190a000-0000-7000-8000-000000000001';
  const message = { to: 'jane@example.com', code: '482913', businessId, businessName: 'LVP' };

  it('logs codes only in local mode', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    await new LogClientCodeSender(true, logger).emailCode(message);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('482913'));
  });

  it('never logs a code or an address anywhere else (hard rule 4)', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const sender = new LogClientCodeSender(false, logger);
    await sender.emailCode(message);
    await sender.smsCode({ ...message, to: '+17705550199' });
    await sender.alreadyRegistered({
      to: 'jane@example.com',
      businessId,
      businessName: 'LVP',
      signInUrl: 'https://portal.example/lvp/sign-in',
    });
    await sender.signUpApproved({
      to: 'jane@example.com',
      businessId,
      businessName: 'LVP',
      name: 'Jane',
      signInUrl: 'https://portal.example/lvp/sign-in',
    });
    await sender.signUpDeclined({
      to: 'jane@example.com',
      businessId,
      businessName: 'LVP',
      name: 'Jane',
    });
    const logged = JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain('482913');
    expect(logged).not.toContain('jane@example.com');
    expect(logged).not.toContain('5550199');
    expect(logger.warn).toHaveBeenCalledTimes(5);
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('linkable: which client record approve may link a login to (#37)', () => {
  it('needs the verified email, both lower-cased, and no primary portal login', () => {
    const email = 'jane@example.com';
    expect(linkable(email, { email: 'jane@example.com', primaryLogins: 0, archivedAt: null })).toBe(
      true,
    );
    expect(
      linkable('Jane@Example.com', {
        email: 'JANE@example.COM',
        primaryLogins: 0,
        archivedAt: null,
      }),
    ).toBe(true);
    expect(linkable(email, { email: 'jane@example.com', primaryLogins: 1, archivedAt: null })).toBe(
      false,
    );
    expect(linkable(email, { email: 'jane@example.org', primaryLogins: 0, archivedAt: null })).toBe(
      false,
    );
    expect(
      linkable(email, { email: 'jane_@example.com', primaryLogins: 0, archivedAt: null }),
    ).toBe(false);
    expect(linkable(email, { email: null, primaryLogins: 0, archivedAt: null })).toBe(false);
    // An archived record is restored first (#72 review).
    const archivedAt = new Date();
    expect(linkable(email, { email, primaryLogins: 0, archivedAt })).toBe(false);
  });
});

describe('sign-ups queue cursor', () => {
  it('round-trips the last row, and refuses anything else with 400', () => {
    const row = { createdAt: new Date('2026-10-07T09:03:00.000Z'), id: crypto.randomUUID() };
    expect(decodeCursor(encodeCursor(row))).toEqual({ t: row.createdAt, id: row.id });
    for (const bad of ['', 'not-a-cursor', Buffer.from('{"t":1}').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(BadRequestException);
    }
  });
});

describe('atLeast: sign-up answers in AWS take a fixed minimum time (#51 review)', () => {
  it('waits out the minimum, also when the work fails', async () => {
    const started = Date.now();
    await expect(atLeast(120, () => Promise.resolve('done'))).resolves.toBe('done');
    expect(Date.now() - started).toBeGreaterThanOrEqual(115);
    const failed = Date.now();
    await expect(atLeast(120, () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(Date.now() - failed).toBeGreaterThanOrEqual(115);
  });
});

describe('VerificationCodesService.match (#51 review)', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOCAL_AUTH_SECRET: 'unit-test-secret-unit-test-secret-1234',
    DATABASE_URL_APP: 'postgresql://unused',
    APP_BASE_URL: 'http://app.localhost:3000',
    PORTAL_BASE_URL: 'http://portal.localhost:3000',
    ADMIN_BASE_URL: 'http://admin.localhost:3000',
  });
  const owner = { businessId: 'b1', clientAccountId: 'a1', attemptUserId: 'u1' };

  it('takes an attempt with one conditional update before comparing; an expired code takes none', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = {
      forBusiness: () => ({
        verificationCode: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'c1', target: 'jane@example.com', codeHash: 'f'.repeat(64) }),
          updateMany,
        },
      }),
    };
    const codes = new VerificationCodesService(db as never, env);
    await expect(codes.match(owner, 'EMAIL', 'jane@example.com', '000000')).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'c1',
        attempts: { lt: 5 },
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) as unknown },
      },
      data: { attempts: { increment: 1 } },
    });
  });

  it('never compares a code meant for another address', async () => {
    const updateMany = vi.fn();
    const db = {
      forBusiness: () => ({
        verificationCode: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'c1', target: 'old@example.com', codeHash: 'f'.repeat(64) }),
          updateMany,
        },
      }),
    };
    const codes = new VerificationCodesService(db as never, env);
    await expect(codes.match(owner, 'EMAIL', 'new@example.com', '000000')).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('canonicalIp and networkOf: one form per address for the limits (#70 review)', () => {
  it('reads IPv4-mapped addresses as IPv4, and writes IPv6 out in full', () => {
    expect(canonicalIp('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(canonicalIp('::FFFF:198.51.100.7')).toBe('198.51.100.7');
    expect(canonicalIp('2001:DB8:42::1')).toBe('2001:0db8:0042:0000:0000:0000:0000:0001');
    expect(canonicalIp('fe80::1%eth0')).toBe('fe80:0000:0000:0000:0000:0000:0000:0001');
    expect(canonicalIp('::')).toBe('0000:0000:0000:0000:0000:0000:0000:0000');
    expect(canonicalIp('64:ff9b::192.0.2.33')).toBe('0064:ff9b:0000:0000:0000:0000:c000:0221');
  });

  it('puts every written form of a network in one bucket, and anything else in "unknown"', () => {
    expect(networkOf('198.51.100.7')).toBe('198.51.100.0/24');
    expect(networkOf('::ffff:198.51.100.200')).toBe('198.51.100.0/24');
    expect(networkOf('2001:db8:42::1')).toBe(networkOf('2001:0db8:0042:ffff::9'));
    expect(networkOf('2001:db8:42::1')).toBe('2001:0db8:0042::/48');
    expect(networkOf('2001:db8:43::1')).not.toBe(networkOf('2001:db8:42::1'));
    for (const odd of [undefined, '', 'not-an-ip', '1.2.3', '300.1.1.1']) {
      expect([odd, networkOf(odd)]).toEqual([odd, 'unknown']);
    }
  });
});

describe('maskPhone', () => {
  it('shows only the area code and the last four digits', () => {
    expect(maskPhone('+17705550123')).toBe('(770) ***-0123');
    expect(maskPhone('+442071234567')).toBe('+44 *** 4567');
  });
});

describe('CognitoIdentityProvider: client logins', () => {
  const pool = { userPoolId: 'us-east-1_clients', clientId: 'c', clientSecret: 's' };

  function fake(handlers: Record<string, () => unknown>) {
    const sent: { command: string; input: Record<string, unknown> }[] = [];
    const send = vi.fn((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const command = cmd.constructor.name.replace(/Command$/, '');
      sent.push({ command, input: cmd.input });
      return Promise.resolve(handlers[command]?.());
    });
    const provider = new CognitoIdentityProvider({ send } as unknown as CognitoClient, {
      CLIENT: pool,
    });
    return { provider, sent };
  }

  it('creates a client login with the phone, and the email not yet verified', async () => {
    const { provider, sent } = fake({
      AdminCreateUser: () => ({ User: { Attributes: [{ Name: 'sub', Value: 'client-sub' }] } }),
    });
    await expect(
      provider.createUser('CLIENT', 'jane@example.com', {
        phone: '+17705550199',
        emailVerified: false,
      }),
    ).resolves.toBe('client-sub');
    expect(sent[0]?.input['UserAttributes']).toEqual([
      { Name: 'email', Value: 'jane@example.com' },
      { Name: 'email_verified', Value: 'false' },
      { Name: 'phone_number', Value: '+17705550199' },
      { Name: 'phone_number_verified', Value: 'false' },
    ]);
    expect(sent[0]?.input['MessageAction']).toBe('SUPPRESS');
  });

  it('marks a contact verified, and a changed one unverified, on the username', async () => {
    const { provider, sent } = fake({
      ListUsers: () => ({ Users: [{ Username: 'client-user', Enabled: true }] }),
      AdminUpdateUserAttributes: () => ({}),
    });
    await provider.updateContact('CLIENT', 'client-sub', { emailVerified: true });
    await provider.updateContact('CLIENT', 'client-sub', { phone: '+14045550100' });
    const updates = sent.filter((s) => s.command === 'AdminUpdateUserAttributes');
    expect(updates.map((u) => u.input)).toEqual([
      {
        UserPoolId: pool.userPoolId,
        Username: 'client-user',
        UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
      },
      {
        UserPoolId: pool.userPoolId,
        Username: 'client-user',
        UserAttributes: [
          { Name: 'phone_number', Value: '+14045550100' },
          { Name: 'phone_number_verified', Value: 'false' },
        ],
      },
    ]);
  });
});
